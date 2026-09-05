/**
 * When a manager usually makes their moves — read from the timestamps of the
 * moves they have actually made, and nothing else.
 *
 * The Player Finder's "trade window" wants "usually on Sun 10a–12p" beside a
 * manager's name. No platform we import from exposes presence, and nothing in
 * this app records when a user is on a page (`engagement_events` is written
 * once a day from five niche screens — measured empty in production on
 * 2026-09-05). What we DO hold is every processed Sleeper transaction with the
 * provider's own epoch-millisecond `created` stamp, refreshed daily. That is a
 * real record of when each manager acts, so that is what the window is.
 *
 * ⚠ THE CLAIM IS "MOVES", NOT "IS ONLINE". A window says when this manager has
 * historically pulled the trigger on waivers, adds, drops and trades — which is
 * the moment a pitch is most likely to be read. It is not a claim that they
 * are looking at the app right now; nothing we hold could back that.
 *
 * Pure: no clock, no I/O, no module state. The zone is the LEAGUE's zone
 * (`League.timezone`, default America/New_York), so the same window renders the
 * same string on the server and on every viewer's phone — a window computed in
 * the viewer's local zone would hydrate differently from how it was rendered.
 */

export type Daypart = 'morning' | 'midday' | 'afternoon' | 'evening' | 'late'

export type ActivityWindow = {
  /** 0 = Sunday … 6 = Saturday, in the league's zone. */
  weekday: number
  /** Start hour (0–23) of the block, league zone. */
  startHour: number
  /** End hour, exclusive (1–24). A `late` block that crosses midnight ends at 24. */
  endHour: number
  /** Which part of the day the block sits in. */
  daypart: Daypart
  /**
   * `window` when a two-hour block holds at least half of the daypart's moves;
   * `daypart` when the moves are spread across it ("Tue evenings").
   */
  precision: 'window' | 'daypart'
  /** Share of every move that fell in the winning weekday + daypart. */
  share: number
  /** Moves the window was read from. */
  sample: number
  /** Short zone label for the string — "ET", "PT", or the IANA short name. */
  zone: string
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Hour bands. `late` wraps midnight: 22, 23, 0, 1, 2, 3, 4. A move at 00:30 is a
 * late-night move on the calendar day it fell on — the weekday comes from the
 * zoned date, not from "the evening before".
 */
const DAYPARTS: Record<Daypart, number[]> = {
  morning: [5, 6, 7, 8, 9, 10],
  midday: [11, 12, 13],
  afternoon: [14, 15, 16],
  evening: [17, 18, 19, 20, 21],
  late: [22, 23, 0, 1, 2, 3, 4],
}

export const DEFAULT_TIME_ZONE = 'America/New_York'

/** At least this many moves before a window is stated at all. */
export const MIN_SAMPLE = 6
/** The winning weekday must hold at least this share of the moves (uniform would be ~0.14). */
export const MIN_SHARE = 0.3
/** …and at least this many of them. Two moves on a Monday are not a habit. */
export const MIN_WEEKDAY_MOVES = 4

function daypartOf(hour: number): Daypart {
  for (const [name, hours] of Object.entries(DAYPARTS) as Array<[Daypart, number[]]>) {
    if (hours.includes(hour)) return name
  }
  return 'late'
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function formatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hour12: false })
  } catch {
    // An unknown IANA name (a bad import, a typo in league settings) must not
    // take the panel down; the league default is the honest fallback.
    return new Intl.DateTimeFormat('en-US', { timeZone: DEFAULT_TIME_ZONE, weekday: 'short', hour: 'numeric', hour12: false })
  }
}

/** Weekday and hour of an instant in the given zone. */
export function localParts(at: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = formatter(timeZone).formatToParts(at)
  let weekday = 0
  let hour = 0
  for (const p of parts) {
    if (p.type === 'weekday') weekday = WEEKDAY_INDEX[p.value] ?? 0
    // Some engines print midnight as "24" under hour12:false.
    if (p.type === 'hour') hour = Number.parseInt(p.value, 10) % 24
  }
  return { weekday, hour: Number.isFinite(hour) ? hour : 0 }
}

/** "ET" for America/New_York, "PT" for Los Angeles, else the engine's short name. */
export function zoneLabel(timeZone: string, at: Date = new Date(0)): string {
  let short = ''
  try {
    short =
      new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    short = ''
  }
  const m = /^([ECMPAH])[SD]T$/.exec(short)
  if (m) return `${m[1]}T`
  return short || timeZone
}

export function activityWindow(
  times: ReadonlyArray<Date | number>,
  timeZone: string,
  opts: { minSample?: number; minShare?: number; minWeekdayMoves?: number } = {},
): ActivityWindow | null {
  const minSample = opts.minSample ?? MIN_SAMPLE
  const minShare = opts.minShare ?? MIN_SHARE
  const minWeekdayMoves = opts.minWeekdayMoves ?? MIN_WEEKDAY_MOVES
  const stamps = times.map((t) => (t instanceof Date ? t : new Date(t))).filter((d) => Number.isFinite(d.getTime()))
  if (stamps.length < minSample) return null

  // Moves per weekday, with the hour histogram of each weekday kept beside it.
  const days = new Map<number, { n: number; hours: number[] }>()
  for (const d of stamps) {
    const { weekday, hour } = localParts(d, timeZone)
    const day = days.get(weekday) ?? { n: 0, hours: new Array<number>(24).fill(0) }
    day.n += 1
    day.hours[hour] += 1
    days.set(weekday, day)
  }

  // The weekday first: the day they act on is the coarse habit.
  let weekday = -1
  let best: { n: number; hours: number[] } | null = null
  for (const [wd, day] of days) {
    if (!best || day.n > best.n) {
      best = day
      weekday = wd
    }
  }
  if (!best || weekday < 0) return null
  const share = best.n / stamps.length
  if (share < minShare || best.n < minWeekdayMoves) return null

  /*
   * Then the two consecutive hours on that day that hold the most moves,
   * allowed to straddle a daypart boundary — a manager who moves at 10:15 and
   * 11:40 is "Sun 10a–12p", not a morning person and a midday person.
   */
  let blockStart = 0
  let blockCount = -1
  for (let h = 0; h < 24; h += 1) {
    const n = best.hours[h] + best.hours[(h + 1) % 24]
    if (n > blockCount) {
      blockCount = n
      blockStart = h
    }
  }

  const base = {
    weekday,
    share: Math.round(share * 100) / 100,
    sample: stamps.length,
    zone: zoneLabel(timeZone, stamps[0]),
  }
  if (blockCount / best.n >= 0.5) {
    const endHour = (blockStart + 2) % 24 || 24
    return { ...base, daypart: daypartOf(blockStart), precision: 'window', startHour: blockStart, endHour }
  }

  // Spread across the day: the daypart that holds most of that weekday's moves.
  let daypart: Daypart = 'evening'
  let daypartCount = -1
  for (const [name, hours] of Object.entries(DAYPARTS) as Array<[Daypart, number[]]>) {
    const n = hours.reduce((acc, h) => acc + best!.hours[h], 0)
    if (n > daypartCount) {
      daypartCount = n
      daypart = name
    }
  }
  const order = DAYPARTS[daypart]
  const first = order[0]
  const last = order[order.length - 1]
  return { ...base, daypart, precision: 'daypart', startHour: first, endHour: last + 1 === 24 ? 24 : last + 1 }
}

/** 0 → "12a", 10 → "10a", 12 → "12p", 13 → "1p", 24 → "12a". */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

/**
 * The sentence fragment: "Sun 10a–12p ET" for a window, "Tue evenings ET" for a
 * daypart. Read as "usually moves on …".
 */
export function windowLabel(w: ActivityWindow): string {
  const day = WEEKDAYS[w.weekday] ?? 'Sun'
  if (w.precision === 'window') return `${day} ${hourLabel(w.startHour)}–${hourLabel(w.endHour)} ${w.zone}`
  const part = w.daypart === 'late' ? 'late nights' : w.daypart === 'midday' ? 'middays' : `${w.daypart}s`
  return `${day} ${part} ${w.zone}`
}

/**
 * Whether `now` falls inside the window's weekday + daypart in the league zone —
 * the difference between "pitch now" and "pitch Sunday morning".
 */
export function inWindow(w: ActivityWindow, now: Date, timeZone: string): boolean {
  const { weekday, hour } = localParts(now, timeZone)
  return weekday === w.weekday && daypartOf(hour) === w.daypart
}
