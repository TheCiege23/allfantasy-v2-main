/**
 * When a league's waivers next run, from a stored or observed schedule — pure, so the countdown
 * components (league screen, cross-league board) and their tests share one rule.
 *
 * A schedule is a wall-clock time in a named timezone, weekly or daily:
 *
 * - `UTC` for a schedule the importer stored (`LeagueWaiverSettings.processingTimeUtc`). That
 *   column is definitionally UTC and `League.timezone` cannot localise it (every production
 *   league carries the schema default — see `waivers.ts`).
 * - `America/Los_Angeles` for a Sleeper schedule OBSERVED from when the league's claims actually
 *   processed (lib/waivers/observedWaiverSchedule.ts). Kept in Pacific wall-clock time because a
 *   fixed UTC hour is wrong for half the year: US daylight saving moves a Pacific 3:00 AM from
 *   10:00 UTC to 11:00 UTC in November, and a UTC schedule would count down to the wrong hour.
 *
 * ⚠ THE VIEWER'S TIMEZONE IS THE ONLY ONE TO DISPLAY IN. Whatever zone the schedule is kept in,
 * the next run is an instant, and the clock formats that instant in the reader's own zone.
 */

export type WaiverSchedule = {
  /** 0–6, Sunday = 0, in `timeZone`. Null means it runs every day. */
  dayOfWeek: number | null
  /** "HH:MM", wall-clock in `timeZone`. */
  time: string
  /** IANA zone the day and time are kept in. */
  timeZone: string
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ZONE_LABEL: Record<string, string> = { UTC: 'UTC', 'America/Los_Angeles': 'Pacific', 'America/New_York': 'Eastern' }

/** "09:00" / "9:00" / "09:00:00" → [9, 0]; null for anything else. */
function parseHm(time: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? [h, min] : null
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    })
    formatters.set(timeZone, f)
  }
  return f
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** The wall-clock reading of an instant in a zone. Exported for the observer. */
export function zonedParts(ms: number, timeZone: string): { y: number; m: number; d: number; h: number; mi: number; dow: number } {
  const out: Record<string, string> = {}
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) out[p.type] = p.value
  return { y: Number(out.year), m: Number(out.month), d: Number(out.day), h: Number(out.hour), mi: Number(out.minute), dow: WEEKDAY[out.weekday] ?? 0 }
}

/** The instant a wall-clock reading in `timeZone` names. Two passes settle a DST edge. */
function zonedToMs(y: number, m: number, d: number, h: number, mi: number, timeZone: string): number {
  const wall = Date.UTC(y, m - 1, d, h, mi)
  let t = wall
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(t, timeZone)
    const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - t
    t = wall - offset
  }
  return t
}

/** The next run strictly after `nowMs`, as epoch ms. Null for an unreadable schedule. */
export function nextWaiverRunMs(schedule: WaiverSchedule, nowMs: number): number | null {
  const hm = parseHm(schedule.time)
  if (!hm) return null
  if (schedule.dayOfWeek != null && (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6)) return null
  let today: ReturnType<typeof zonedParts>
  try {
    today = zonedParts(nowMs, schedule.timeZone)
  } catch {
    return null // an unknown zone
  }
  for (let i = 0; i <= 8; i++) {
    /* Calendar arithmetic on the zone's local date — Date.UTC normalises day overflow. */
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d + i))
    if (schedule.dayOfWeek != null && date.getUTCDay() !== schedule.dayOfWeek) continue
    const at = zonedToMs(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hm[0], hm[1], schedule.timeZone)
    if (at > nowMs) return at
  }
  return null
}

/** "Wednesday 09:00 UTC", "Daily 03:00 Pacific" — the label before the viewer's own time is known. */
export function scheduleLabel(schedule: WaiverSchedule): string {
  const day = schedule.dayOfWeek == null ? 'Daily' : (DAY[schedule.dayOfWeek] ?? 'Unknown day')
  return `${day} ${schedule.time} ${ZONE_LABEL[schedule.timeZone] ?? schedule.timeZone}`
}

/** "in 14h 05m", "in 3d 2h", "in 12m" — coarse on purpose; the exact time sits beside it. */
export function countdownText(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `in ${h}h ${String(mins % 60).padStart(2, '0')}m`
  return `in ${Math.floor(h / 24)}d ${h % 24}h`
}
