import { isOutDesignation } from './injuryStatus'
import { LOCK_ZONE } from './lineupLock'

/**
 * A pregame inactive: a player ruled OUT inside the window before his kickoff.
 *
 * ⚠ NO FEED WE HOLD PUBLISHES THE INACTIVE LIST AS SUCH. The NFL announces
 * inactives 90 minutes before kickoff, and every provider we read folds that
 * announcement into the same word it uses for a Friday ruling: "Out". What
 * tells the two apart is WHEN the designation landed. The injury report
 * closes on Friday (Saturday for a Monday game), so an Out that first appears
 * inside the last two hours before kickoff is the inactive list or a late
 * scratch — either way the manager's last chance to move him. Rolling
 * Insights refreshes its injury feed about an hour before each game
 * (contracts/rolling-insights/GAPS.md); Sleeper's live blob moves within
 * minutes and is folded every five (app/api/cron/alert-sweep). WHEN the
 * designation first landed is designationOnset.ts's job; this reads it.
 *
 * Only OUT qualifies. IR, PUP and a suspension are season-scale rulings, and
 * "Doubtful" is a forecast, not a scratch. A date-only report (midnight UTC,
 * see injuryReport.ts) cannot be placed inside a window and is never called
 * inactive. Pure and client-safe: Intl only, zone pinned.
 */

export const PREGAME_WINDOW_MINUTES = 120

export type PregameInactive = {
  /** ISO of when the Out designation landed. */
  announcedAt: string
  minutesBeforeKickoff: number
  /** "11:32a ET" */
  clock: string
}

/** "11:32a ET" — the time of day in the lock zone, no weekday: an inactive is always today's news. */
export function clockEt(iso: string, timeZone: string = LOCK_ZONE): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d)
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: LOCK_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d)
  }
  const get = (t: Intl.DateTimeFormatPart['type']) => parts.find((p) => p.type === t)?.value ?? ''
  const ampm = get('dayPeriod').toLowerCase().startsWith('p') ? 'p' : 'a'
  const zone = timeZone === LOCK_ZONE ? 'ET' : timeZone
  return `${get('hour')}:${get('minute')}${ampm} ${zone}`
}

export function pregameInactive(
  status: string | null | undefined,
  reportedAtIso: string | null | undefined,
  kickoffIso: string | null | undefined,
): PregameInactive | null {
  if (!isOutDesignation(status)) return null
  if (!reportedAtIso || !kickoffIso) return null
  const reported = new Date(reportedAtIso)
  const kickoff = new Date(kickoffIso)
  if (Number.isNaN(reported.getTime()) || Number.isNaN(kickoff.getTime())) return null
  // A date-only value has no time of day to place inside a window.
  if (reported.getUTCHours() === 0 && reported.getUTCMinutes() === 0 && reported.getUTCSeconds() === 0) return null
  const before = Math.round((kickoff.getTime() - reported.getTime()) / 60_000)
  if (before < 0 || before > PREGAME_WINDOW_MINUTES) return null
  return { announcedAt: reported.toISOString(), minutesBeforeKickoff: before, clock: clockEt(reported.toISOString()) }
}

/** "Declared inactive at 11:32a ET, 88 min before kickoff" */
export function inactiveSentence(p: PregameInactive): string {
  const when = p.minutesBeforeKickoff === 0 ? 'at kickoff' : `${p.minutesBeforeKickoff} min before kickoff`
  return `Declared inactive at ${p.clock}, ${when}`
}
