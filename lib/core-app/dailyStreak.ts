/**
 * The /core daily check-in streak (founder, 2026-10-08).
 *
 * A manager checks in by opening their /core home, once per calendar day. Consecutive days make a
 * streak; missing a day resets it. Days are US Eastern — the same clock the weekly routine and every
 * kickoff on /core already use (`DEFAULT_TIME_ZONE`) — so a check-in at 11pm Pacific counts for the
 * day a manager would call "today" during the NFL season's late window, not tomorrow.
 *
 * ⚠ ONLY A REAL VISIT CHECKS IN. The page records a check-in on the same condition the "since your
 * last visit" marker uses: the all-leagues home, not a prefetch, not a filtered scope. A link that
 * scrolls into view and gets prefetched must not keep someone's streak alive for them.
 *
 * Pure and client-safe: no prisma, no clock. The store (dailyStreakStore.ts) reads and writes.
 */

export const STREAK_TIME_ZONE = 'America/New_York'
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365] as const
/** Days kept on the record — enough for the week strip and a lapse check, nothing more. */
const KEEP_DAYS = 60

export type StreakRecord = {
  version: 1
  /** ET calendar days with a check-in, ascending, unique, at most KEEP_DAYS. */
  days: string[]
  /** Longest run ever recorded — survives the days list being trimmed. */
  best: number
}

export type StreakDay = {
  day: string
  /** Weekday index, 0 = Sunday — the view names it in the reader's language. */
  weekday: number
  checked: boolean
  isToday: boolean
}

export type StreakSummary = {
  current: number
  best: number
  checkedInToday: boolean
  /** This visit is the one that extended the streak — the view celebrates it once. */
  justExtended: boolean
  /** The last seven days, oldest first, ending today. */
  week: StreakDay[]
  /** The next milestone and how many more days reach it; null past the last one. */
  next: { at: number; left: number } | null
  /** The milestone this visit just reached, if it reached one. */
  reached: number | null
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>()

/** "2026-10-08" — the calendar day `at` falls on in `timeZone`. */
export function dayKey(at: Date, timeZone: string = STREAK_TIME_ZONE): string {
  let f = dayFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    dayFormatters.set(timeZone, f)
  }
  return f.format(at)
}

/** The day before / after a `YYYY-MM-DD` key, by calendar arithmetic (no time zone involved). */
export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d! + by))
  return t.toISOString().slice(0, 10)
}

function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
}

function isRecord(v: unknown): v is StreakRecord {
  const r = v as StreakRecord | null
  return Boolean(r && r.version === 1 && Array.isArray(r.days) && typeof r.best === 'number')
}

export function parseStreakRecord(v: unknown): StreakRecord | null {
  if (!isRecord(v)) return null
  const days = [...new Set(v.days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))))].sort()
  return { version: 1, days, best: Math.max(0, Math.floor(v.best)) }
}

/** Consecutive checked-in days ending at `end` (inclusive). */
function runEndingAt(days: Set<string>, end: string): number {
  let n = 0
  let d = end
  while (days.has(d)) {
    n++
    d = shiftDay(d, -1)
  }
  return n
}

/** Record today's check-in. Idempotent within a day. */
export function checkIn(prev: StreakRecord | null, today: string): StreakRecord {
  const days = [...new Set([...(prev?.days ?? []), today])].sort().slice(-KEEP_DAYS)
  const current = runEndingAt(new Set(days), today)
  return { version: 1, days, best: Math.max(prev?.best ?? 0, current) }
}

/**
 * What the card says. `before` is the record as it stood before this visit (null on a first ever
 * visit) — comparing it with `after` is how the card knows this visit extended the streak.
 */
export function summarizeStreak(before: StreakRecord | null, after: StreakRecord | null, today: string): StreakSummary {
  const days = new Set(after?.days ?? [])
  const checkedInToday = days.has(today)
  /*
   * Not yet checked in today (a filtered or prefetched view, which never records): the streak still
   * stands if yesterday was checked — it is at risk, not broken — so count back from yesterday.
   */
  const current = checkedInToday ? runEndingAt(days, today) : runEndingAt(days, shiftDay(today, -1))
  const hadToday = new Set(before?.days ?? []).has(today)
  const justExtended = checkedInToday && !hadToday
  const reached = justExtended && (STREAK_MILESTONES as readonly number[]).includes(current) ? current : null
  const nextAt = STREAK_MILESTONES.find((m) => m > current) ?? null
  return {
    current,
    best: Math.max(after?.best ?? 0, current),
    checkedInToday,
    justExtended,
    week: Array.from({ length: 7 }, (_, i) => {
      const day = shiftDay(today, i - 6)
      return { day, weekday: weekdayOf(day), checked: days.has(day), isToday: day === today }
    }),
    next: nextAt == null ? null : { at: nextAt, left: nextAt - current },
    reached,
  }
}
