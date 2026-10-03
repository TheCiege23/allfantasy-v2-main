import { scheduleLabel, type WaiverSchedule } from './waiverRunClock'

/**
 * The small, sport-free facts every cross-league waiver row prints about its league — shared by
 * the NFL rows and the season-rate sections of `waiversBoard.ts`, so the two cannot describe the
 * same league two ways. Moved here verbatim from `waiversBoard.ts`; the NFL golden test
 * (`waivers-board-nfl-golden.test.ts`) pins that nothing it prints moved with them.
 */

const DAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Dynasty · Superflex" from what the league actually declares. */
export function formatOf(leagueType: string | null, scoringType: string | null): string | null {
  const parts = [leagueType, scoringType]
    .map((x) => (x ?? '').trim())
    .filter((x) => x.length > 0)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Whether a stored processing day/time can be trusted for this platform.
 *
 * 🛑 NOT FOR SLEEPER. The Sleeper mapper imports the waiver type and budget but not the schedule,
 * so `LeagueWaiverSettings` holds AllFantasy's bootstrap defaults there — a schedule nobody set.
 * The league screen (`waivers.ts`) already refused to print it; the cross-league board did not, so
 * the same league read "not imported" on one screen and a confident day and hour on the other.
 */
export function waiverScheduleIsImported(platform: string | null | undefined): boolean {
  return String(platform ?? '').trim().toLowerCase() !== 'sleeper'
}

/** "Wednesday 09:00 UTC", when the league publishes a processing day and time we actually imported. */
export function runsAtLabel(
  w: { processingDayOfWeek: number | null; processingTimeUtc: string | null } | null | undefined,
  platform: string | null | undefined,
): string | null {
  if (!waiverScheduleIsImported(platform)) return null
  return w && w.processingDayOfWeek != null && w.processingDayOfWeek >= 0 && w.processingDayOfWeek <= 6 && w.processingTimeUtc?.trim()
    ? `${DAY_LABEL[w.processingDayOfWeek]} ${w.processingTimeUtc.trim()} UTC`
    : null
}

/**
 * The schedule a waiver row shows: the stored one where the importer really imported it, else —
 * for a Sleeper league — the one OBSERVED from when its claims actually processed
 * (lib/waivers/observedWaiverSchedule.ts). Never a Sleeper bootstrap default.
 *
 * ⚠ STRUCTURED, NOT AN INSTANT. The board is served from a clock-free cache (see
 * `waiversBoardSummary.ts`); "the next run" depends on now, so the component derives it.
 */
export function rowWaiverSchedule(
  w: { processingDayOfWeek: number | null; processingTimeUtc: string | null } | null | undefined,
  platform: string | null | undefined,
  observed: { schedule: WaiverSchedule; agreeingRuns: number } | null | undefined,
): { label: string; schedule: WaiverSchedule } | null {
  const stored = runsAtLabel(w, platform)
  if (stored) {
    return { label: stored, schedule: { dayOfWeek: w!.processingDayOfWeek!, time: w!.processingTimeUtc!.trim(), timeZone: 'UTC' } }
  }
  if (observed && !waiverScheduleIsImported(platform)) {
    return { label: `${scheduleLabel(observed.schedule)} (seen over ${observed.agreeingRuns} runs)`, schedule: observed.schedule }
  }
  return null
}

/** FAAB left, only when the league runs FAAB. */
export function faabRemainingOf(
  w: { waiverType: string | null } | null | undefined,
  roster: { faabRemaining: number | null },
): number | null {
  return w && String(w.waiverType ?? '').toLowerCase() === 'faab' ? (roster.faabRemaining ?? null) : null
}
