/**
 * Daily waiver runs for the daily sports under Sleeper-style free agency (owner, 2026-10-27).
 *
 * In an NBA, NHL or MLB league whose commissioner chose "Waivers, then free agents"
 * (`free_agency_mode = 'after_run'`, after-run-free-agency.ts), claims clear EVERY day at the league's
 * processing time instead of on the sport's Mon / Wed / Fri default — Sleeper's own default there.
 * A player dropped onto waivers is then claimable at the first daily run after his hold, and an
 * unclaimed player becomes a free agent the morning after, not up to three days later.
 *
 * It is a SCHEDULE, read through `getEffectiveLeagueWaiverSettings`, not a second runner: the
 * existing `/api/cron/waivers` sweep (every 5 minutes) runs each league once its `nextRunAt` passes,
 * and `nextRunAt` is computed from these days. So the run is the same run as on any other day — the
 * commissioner's "Lock all roster moves" skips it and leaves every claim pending, exactly as before.
 *
 * Unchanged: every other sport, a daily sport in the standard free-agency mode, an FCFS league (no
 * run to schedule), a specialty variant, and a league with the commissioner's per-day schedule on
 * (lib/waivers/dailyWaiverSchedule.ts) — that schedule chooses each day itself and stays the way to
 * pick a pattern other than every day. The run time is the league's own (the sport default is
 * 12:00 UTC: 08:00 Eastern in summer, 07:00 in winter, before the day's first game).
 *
 * Pure.
 */

export const DAILY_WAIVER_RUN_SPORTS: readonly string[] = ['NBA', 'NHL', 'MLB']

/** Every weekday, Sunday = 0 — the form `computeNextWaiverRunAtUtc` reads. */
export const EVERY_DAY_PROCESSING_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6]

/** The processing days the league runs on, or null to keep its own. */
export function dailySportWaiverRunDays(input: {
  sport: string | null | undefined
  leagueVariant: string | null | undefined
  freeAgencyMode: string | null | undefined
  waiverType: string | null | undefined
  perDayScheduleEnabled: boolean
}): number[] | null {
  if (!DAILY_WAIVER_RUN_SPORTS.includes(String(input.sport ?? '').trim().toUpperCase())) return null
  if (input.leagueVariant) return null
  if (input.freeAgencyMode !== 'after_run') return null
  if (String(input.waiverType ?? '').trim().toLowerCase() === 'fcfs') return null
  if (input.perDayScheduleEnabled) return null
  return [...EVERY_DAY_PROCESSING_DAYS]
}
