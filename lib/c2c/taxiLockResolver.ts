/**
 * C2C taxi-lock mode resolution. Commissioners pick a high-level mode and
 * the resolver computes a concrete lock timestamp from sport schedule data.
 * No new Prisma fields — the mode lives in League.settings.c2cTaxiLockMode.
 */

import { prisma } from '@/lib/prisma'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'

export type TaxiLockMode = 'preseason' | 'start_of_season' | 'no_limit'

const TAXI_LOCK_MODES: readonly TaxiLockMode[] = [
  'preseason',
  'start_of_season',
  'no_limit',
] as const

export function isTaxiLockMode(x: unknown): x is TaxiLockMode {
  return typeof x === 'string' && (TAXI_LOCK_MODES as readonly string[]).includes(x)
}

interface ResolvedTaxiLock {
  mode: TaxiLockMode
  /** null when mode === 'no_limit'; otherwise the concrete lock timestamp. */
  lockedAt: Date | null
  /** true when now is past lockedAt (always false for 'no_limit'). */
  isLocked: boolean
}

/**
 * Derive a concrete preseason or start-of-season timestamp from the sport
 * profile. Falls back to the explicit `taxiLockDeadline` column when the
 * commissioner saved a custom date.
 */
export async function resolveTaxiLock(leagueId: string): Promise<ResolvedTaxiLock> {
  const [league, c2c] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true, settings: true, season: true },
    }),
    prisma.c2CLeague.findUnique({
      where: { leagueId },
      select: { taxiLockDeadline: true },
    }),
  ])

  const modeRaw = (league?.settings as Record<string, unknown> | null)?.c2cTaxiLockMode
  const mode: TaxiLockMode = isTaxiLockMode(modeRaw) ? modeRaw : 'no_limit'

  if (mode === 'no_limit') {
    return { mode, lockedAt: null, isLocked: false }
  }

  // Explicit custom date wins when set.
  if (c2c?.taxiLockDeadline) {
    return {
      mode,
      lockedAt: c2c.taxiLockDeadline,
      isLocked: c2c.taxiLockDeadline.getTime() <= Date.now(),
    }
  }

  const profile = league?.sport ? getGuillotineSportConfig(league.sport) : undefined
  const now = new Date()
  // Best-effort sport-aware derivation without new schedule imports:
  //   start_of_season → first primary game day of the current week
  //   preseason       → 7 days before start_of_season
  if (!profile) {
    return { mode, lockedAt: null, isLocked: false }
  }
  const startDay = profile.primaryGameDays[0] ?? 0
  const start = new Date(now)
  const delta = (startDay - start.getUTCDay() + 7) % 7
  start.setUTCDate(start.getUTCDate() + delta)
  start.setUTCHours(12, 0, 0, 0)
  const locked = mode === 'preseason' ? new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000) : start
  return { mode, lockedAt: locked, isLocked: locked.getTime() <= now.getTime() }
}
