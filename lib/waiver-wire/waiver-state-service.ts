/**
 * Persisted league waiver snapshot for UI (priority order, FAAB caps, scheduling hints).
 */

import { prisma } from '@/lib/prisma'
import { computeNextWaiverRunAtUtc } from './next-waiver-run'
import type { NextRunInput } from './next-waiver-run'
import { getEffectiveLeagueWaiverSettings } from './settings-service'
import { localProcessingDayIndices, readDailyWaiverScheduleFromSettings } from '@/lib/waivers/dailyWaiverSchedule'
import { nextLocalWaiverClear, readLocalWaiverClear } from '@/lib/waivers/leagueLocalWaiverClock'

/** The league row bits that decide its clock: a league-time clear (`af_waiver_clear_local`) and its zone. */
export type LeagueWaiverClockSource = { settings?: unknown; timezone?: string | null } | null | undefined

/**
 * The next automated run. A league with a league-time clear (lib/waivers/leagueLocalWaiverClock.ts)
 * clears at that local wall-clock time all year — daylight saving included — and that wins over the
 * UTC engine fields. Every other league keeps the UTC schedule it always had.
 */
export function nextLeagueWaiverRunAt(now: Date, schedule: NextRunInput, league: LeagueWaiverClockSource): string | null {
  // An enabled per-day schedule is already in league time (its processHour is local): read it as such,
  // so it no longer drifts an hour at each daylight-saving change.
  const daily = readDailyWaiverScheduleFromSettings(league?.settings)
  if (daily?.enabled) {
    const days = localProcessingDayIndices(daily)
    if (days.length === 0) return null
    return nextLocalWaiverClear({ days, hour: daily.processHour, minute: 0 }, league?.timezone, now)?.toISOString() ?? null
  }
  const local = readLocalWaiverClear(league?.settings)
  if (local) return nextLocalWaiverClear(local, league?.timezone, now)?.toISOString() ?? null
  return computeNextWaiverRunAtUtc(now, schedule)
}

export async function upsertLeagueWaiverStateAfterRun(
  leagueId: string,
  input: {
    schedule: NextRunInput
    priorityOrder: Array<{ rosterId: string; waiverPriority: number | null; faabRemaining: number | null }>
    /** The league's clock (settings + timezone). Omitted: the UTC schedule alone. */
    league?: LeagueWaiverClockSource
  }
): Promise<void> {
  const now = new Date()
  const dailyScheduleEnabled = Boolean(readDailyWaiverScheduleFromSettings(input.league?.settings)?.enabled)
  const nextRunAtIso = nextRunAtForSchedule(now, { ...input.schedule, dailyScheduleEnabled }, input.league)
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
  league?: LeagueWaiverClockSource,
): string | null {
  if (input.dailyScheduleEnabled && Array.isArray(input.processingDays) && input.processingDays.length === 0) {
    return null
  }
  return nextLeagueWaiverRunAt(now, input, league)
}

/**
 * Recomputes `LeagueWaiverState.nextRunAt` from the league's current effective waiver settings —
 * called when the commissioner changes the daily schedule, so the cron does not keep the run time
 * computed under the old schedule until the next run happens.
 */
export async function refreshLeagueWaiverNextRunAt(
  leagueId: string,
  now: Date = new Date(),
  /** Schedule from this moment instead of now: the first run after a drop hold ends. */
  notBefore?: Date | null,
  /**
   * Also stamp `lastRunAt = now`: today's run cleared with nothing it could award (every claim waits on
   * a drop hold). A "Waivers to FA" day opens free agency once its run has cleared (hasTodaysWaiverRunCleared),
   * and without the stamp that day never opened while a held claim sat pending.
   */
  opts?: { markRan?: boolean },
): Promise<Date | null> {
  const [eff, league] = await Promise.all([
    getEffectiveLeagueWaiverSettings(leagueId),
    (prisma as any).league.findUnique({ where: { id: leagueId }, select: { settings: true, timezone: true } }),
  ])
  const schedule = readDailyWaiverScheduleFromSettings(league?.settings)
  const from = notBefore && notBefore.getTime() > now.getTime() ? notBefore : now
  const iso = nextRunAtForSchedule(from, {
    processingDayOfWeek: eff.processingDayOfWeek,
    processingTimeUtc: eff.processingTimeUtc,
    processingDays: eff.processingDays,
    dailyScheduleEnabled: Boolean(schedule?.enabled),
  }, league)
  const nextRunAt = iso ? new Date(iso) : null
  await (prisma as any).leagueWaiverState.upsert({
    where: { leagueId },
    create: { leagueId, nextRunAt, processingLocked: false, ...(opts?.markRan ? { lastRunAt: now } : {}) },
    update: { nextRunAt, ...(opts?.markRan ? { lastRunAt: now } : {}) },
  })
  return nextRunAt
}
