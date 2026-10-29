/**
 * A trade deadline with a day and a time (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1: "Trade deadline:
 * week + day + time"). The commissioner picks the moment trades close — "Saturday, Nov 21, 11:59 PM",
 * in the league's timezone — next to the deadline week the league already had.
 *
 *   week only       unchanged: the deadline week itself is open, trades close from the next week
 *   time only       trades close at that moment
 *   both            whichever comes first
 *
 * Stored as an instant in `League.settings.trade_deadline_at` (ISO); the week stays
 * `League.tradeDeadlineWeek`.
 *
 * ⚠ WHY A DATE AND NOT "SATURDAY OF WEEK 11". A weekday inside a fantasy week needs the calendar dates
 * of that week, and for a native league nothing records them: the week number moves when the roller
 * sees every matchup final, which runs hours to a day after the last game. Placing "Saturday" in the
 * seven days containing NOW reads the next Saturday during that lag, and trades reopen for the hours
 * between Monday night and the roll — exactly when a deadline matters. A date the commissioner picked
 * cannot drift.
 *
 * Pure.
 */

import { timeZoneShortName, utcToWallClock, wallClockToUtc } from '@/lib/timezone'

export const TRADE_DEADLINE_AT_KEY = 'trade_deadline_at'

/** The close instant, or null when none is set (or the stored value is unreadable). */
export function readDeadlineAt(settings: unknown): Date | null {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const raw = s[TRADE_DEADLINE_AT_KEY]
  if (typeof raw !== 'string' || !raw.trim()) return null
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? null : at
}

export type DeadlineAtInput = { ok: true; value: string | null } | { ok: false; error: string }

/** Validate a stored value from a settings save: an ISO instant, or null/'' to clear it. */
export function parseDeadlineAtInput(value: unknown): DeadlineAtInput {
  if (value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'The trade deadline time must be a date and time.' }
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return { ok: false, error: 'The trade deadline time must be a date and time.' }
  return { ok: true, value: at.toISOString() }
}

/**
 * Has the deadline passed? `currentWeek` is the server's in-season week, or null when no week applies
 * (no season, offseason) — then only an explicit close time can close trades, and only while a season
 * is in progress, which the caller decides by passing `inSeason`.
 */
export function deadlinePassed(input: {
  inSeason: boolean
  currentWeek: number | null
  deadlineWeek: number | null
  deadlineAt: Date | null
  now: Date
}): { passed: boolean; by: 'week' | 'time' | null } {
  if (!input.inSeason) return { passed: false, by: null }
  if (input.deadlineAt && input.now.getTime() >= input.deadlineAt.getTime()) return { passed: true, by: 'time' }
  if (input.deadlineWeek != null && input.currentWeek != null && input.currentWeek > input.deadlineWeek) return { passed: true, by: 'week' }
  return { passed: false, by: null }
}

/** "Sat, Nov 21, 11:59 PM EST" in the league's timezone. */
export function describeDeadlineAt(at: Date, timezone: string | null | undefined): string {
  const local = utcToWallClock(at, timezone)
  if (!local) return at.toISOString()
  const day = new Date(`${local.date}T00:00:00.000Z`)
  const dayText = day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const [h, m] = local.time.split(':').map(Number)
  const clock = `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`
  return `${dayText}, ${clock} ${timeZoneShortName(timezone, at)}`
}

/** The refusal text, naming whichever limit closed trades. */
export function deadlinePassedMessage(input: { by: 'week' | 'time' | null; deadlineWeek: number | null; deadlineAt: Date | null; timezone: string | null | undefined }): string {
  if (input.by === 'time' && input.deadlineAt) return `The trade deadline passed on ${describeDeadlineAt(input.deadlineAt, input.timezone)}.`
  return `Trade deadline passed after Week ${input.deadlineWeek ?? '?'}.`
}

/** The `<input type="datetime-local">` value for an instant, in the league's timezone. */
export function toLocalInput(at: Date | null, timezone: string | null | undefined): string {
  if (!at) return ''
  const local = utcToWallClock(at, timezone)
  return local ? `${local.date}T${local.time}` : ''
}

/** A `datetime-local` value, read as wall-clock time in the league's timezone, to an ISO instant. */
export function fromLocalInput(value: string, timezone: string | null | undefined): string | null {
  const [date, time] = value.split('T')
  if (!date || !time) return null
  return wallClockToUtc(date, time.slice(0, 5), timezone)?.toISOString() ?? null
}
