/**
 * Persisted league waiver snapshot for UI (priority order, FAAB caps, scheduling hints).
 */

import { prisma } from '@/lib/prisma'
import { computeNextWaiverRunAtUtc } from './next-waiver-run'
import type { NextRunInput } from './next-waiver-run'
import { getEffectiveLeagueWaiverSettings } from './settings-service'
import { readDailyWaiverScheduleFromSettings } from '@/lib/waivers/dailyWaiverSchedule'

export async function upsertLeagueWaiverStateAfterRun(
  leagueId: string,
  input: {
    schedule: NextRunInput
    priorityOrder: Array<{ rosterId: string; waiverPriority: number | null; faabRemaining: number | null }>
  }
): Promise<void> {
  const now = new Date()
  const nextRunAtIso = computeNextWaiverRunAtUtc(now, input.schedule)
  await (prisma as any).leagueWaiverState.upsert({
    where: { leagueId },
    create: {
      leagueId,
      lastRunAt: now,
      nextRunAt: nextRunAtIso ? new Date(nextRunAtIso) : null,
      currentPriorityOrder: input.priorityOrder as object,
      faabState: { snapshotAt: now.toISOString() },
      processingLocked: false,
    },
    update: {
      lastRunAt: now,
      nextRunAt: nextRunAtIso ? new Date(nextRunAtIso) : null,
      currentPriorityOrder: input.priorityOrder as object,
      updatedAt: now,
    },
  })
}

export async function getLeagueWaiverState(leagueId: string) {
  return (prisma as any).leagueWaiverState.findUnique({
    where: { leagueId },
  })
}

export async function setWaiverProcessingLocked(leagueId: string, locked: boolean): Promise<void> {
  await (prisma as any).leagueWaiverState.upsert({
    where: { leagueId },
    create: {
      leagueId,
      processingLocked: locked,
    },
    update: {
      processingLocked: locked,
    },
  })
}

/**
 * The next automated run after a schedule change. With an ENABLED daily schedule whose processing
 * days are empty (every day Free agents / Locked) there is no run, so null — the existing calculator
 * would otherwise fall back to `processingDayOfWeek` and schedule a run that must not happen.
 * Pure.
 */
export function nextRunAtForSchedule(
  now: Date,
  input: NextRunInput & { dailyScheduleEnabled: boolean },
): string | null {
  if (input.dailyScheduleEnabled && Array.isArray(input.processingDays) && input.processingDays.length === 0) {
    return null
  }
  return computeNextWaiverRunAtUtc(now, input)
}

/**
 * Recomputes `LeagueWaiverState.nextRunAt` from the league's current effective waiver settings —
 * called when the commissioner changes the daily schedule, so the cron does not keep the run time
 * computed under the old schedule until the next run happens.
 */
export async function refreshLeagueWaiverNextRunAt(leagueId: string, now: Date = new Date()): Promise<Date | null> {
  const [eff, league] = await Promise.all([
    getEffectiveLeagueWaiverSettings(leagueId),
    (prisma as any).league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
  ])
  const schedule = readDailyWaiverScheduleFromSettings(league?.settings)
  const iso = nextRunAtForSchedule(now, {
    processingDayOfWeek: eff.processingDayOfWeek,
    processingTimeUtc: eff.processingTimeUtc,
    processingDays: eff.processingDays,
    dailyScheduleEnabled: Boolean(schedule?.enabled),
  })
  const nextRunAt = iso ? new Date(iso) : null
  await (prisma as any).leagueWaiverState.upsert({
    where: { leagueId },
    create: { leagueId, nextRunAt, processingLocked: false },
    update: { nextRunAt },
  })
  return nextRunAt
}
