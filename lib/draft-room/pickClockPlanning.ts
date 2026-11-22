/**
 * Planning around a long pick clock.
 *
 * ⚠ "SLOW DRAFT" IS NOT A DRAFT TYPE. A snake, linear or auction room is "slow" only because the
 * commissioner set a long pick clock. So nothing here keys on a mode: every helper takes the
 * clock length (and the commissioner's quiet hours, when set) and the room adds planning detail
 * once the clock is long enough that people stop sitting in the room.
 */

/** From this pick clock up, show the due time, the "you're up around…" estimate and alerts. */
export const LONG_PICK_CLOCK_SECONDS = 10 * 60

export function isLongPickClock(timerSeconds: number | null | undefined): boolean {
  return typeof timerSeconds === 'number' && Number.isFinite(timerSeconds) && timerSeconds >= LONG_PICK_CLOCK_SECONDS
}

export type QuietWindow = { start: string; end: string; timezone: string }

/** "22:00" → 1320. Null for anything that is not HH:MM. */
export function parseClockMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

export function normalizeQuietWindow(raw: unknown): QuietWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const start = typeof r.start === 'string' ? r.start : null
  const end = typeof r.end === 'string' ? r.end : null
  const timezone = typeof r.timezone === 'string' && r.timezone.trim() ? r.timezone.trim() : null
  if (parseClockMinutes(start) == null || parseClockMinutes(end) == null || !timezone) return null
  if (parseClockMinutes(start) === parseClockMinutes(end)) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return null
  }
  return { start: start!, end: end!, timezone }
}

/** Minutes since midnight of `date` in `timeZone`. */
export function minuteOfDayInZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** Whether a minute-of-day falls inside a window that may wrap past midnight (22:00–08:00). */
export function isMinuteInWindow(minute: number, startMinute: number, endMinute: number): boolean {
  return startMinute < endMinute ? minute >= startMinute && minute < endMinute : minute >= startMinute || minute < endMinute
}

export function isInQuietWindow(date: Date, window: QuietWindow): boolean {
  const start = parseClockMinutes(window.start)
  const end = parseClockMinutes(window.end)
  if (start == null || end == null) return false
  return isMinuteInWindow(minuteOfDayInZone(date, window.timezone), start, end)
}

/**
 * Typical seconds per pick, from when recent picks were made: the median gap between the last
 * picks, never more than the clock (a gap that spans quiet hours or a pause is not pace).
 * With fewer than three gaps, half the clock.
 */
export function estimatePickPaceSeconds(pickTimesMs: number[], timerSeconds: number): number {
  const sorted = pickTimesMs.filter((t) => Number.isFinite(t)).sort((a, b) => a - b).slice(-11)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = (sorted[i] - sorted[i - 1]) / 1000
    if (gap > 0) gaps.push(Math.min(gap, timerSeconds))
  }
  if (gaps.length < 3) return Math.max(30, Math.round(timerSeconds / 2))
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
  return Math.max(30, Math.round(median))
}

/**
 * When the viewer is likely up: `picksAway × pace` of RUNNING clock from now, with quiet hours
 * skipped (the clock is frozen then, so no picks happen). Walks in five-minute steps; capped at
 * 21 days so a bad input cannot spin.
 */
export function estimateNextPickAt(input: {
  nowMs: number
  picksAway: number
  paceSeconds: number
  quietWindow?: QuietWindow | null
}): Date {
  const { nowMs, picksAway, paceSeconds, quietWindow } = input
  return advanceActiveClock(nowMs, Math.max(0, picksAway) * Math.max(0, paceSeconds), quietWindow ?? null, 5 * 60)
}

/** `seconds` of running clock from `fromMs`, skipping quiet minutes, walked in `stepSeconds` steps. */
function advanceActiveClock(fromMs: number, seconds: number, quietWindow: QuietWindow | null, stepSeconds: number): Date {
  let remaining = seconds
  if (!quietWindow) return new Date(fromMs + remaining * 1000)
  const cap = fromMs + 21 * 24 * 3600 * 1000
  let t = fromMs
  while (remaining > 0 && t < cap) {
    if (!isInQuietWindow(new Date(t), quietWindow)) remaining -= stepSeconds
    t += stepSeconds * 1000
  }
  return new Date(Math.min(t + Math.min(0, remaining) * 1000, cap))
}

/**
 * When the pick on the clock is really due. The server FREEZES the clock for quiet hours
 * (DraftTimerService: remaining seconds are held, then resume), so a timer that would run past the
 * start of quiet hours is due that much after they end — a 4-hour clock started at 8 PM with
 * quiet hours 10 PM–8 AM is due at 10 AM, not midnight. Minute steps: this is a deadline.
 */
export function effectiveDueAt(nowMs: number, timerEndMs: number, quietWindow: QuietWindow | null | undefined): Date {
  const remaining = Math.max(0, Math.round((timerEndMs - nowMs) / 1000))
  if (!quietWindow) return new Date(timerEndMs)
  return advanceActiveClock(nowMs, remaining, quietWindow, 60)
}

/** Whether the stretch between two instants contains any quiet minutes. */
export function crossesQuietWindow(fromMs: number, toMs: number, window: QuietWindow): boolean {
  for (let t = fromMs; t <= toMs; t += 5 * 60 * 1000) {
    if (isInQuietWindow(new Date(t), window)) return true
  }
  return false
}

/** The next time `minuteOfDay` comes round in `timeZone`, at or after `fromMs`. */
export function nextOccurrenceOfMinute(fromMs: number, minuteOfDay: number, timeZone: string): Date {
  const now = minuteOfDayInZone(new Date(fromMs), timeZone)
  const delta = (minuteOfDay - now + 1440) % 1440
  return new Date(Math.floor(fromMs / 60000) * 60000 + delta * 60000)
}

/** "6:31 PM" in the viewer's own time zone (or `timeZone`). */
export function formatClockTime(date: Date, locale = 'en-US', timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(date)
}

/** "ET" for America/New_York; falls back to the zone id. */
export function shortZoneName(timeZone: string, at: Date, locale = 'en-US'): string {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value
    if (!part) return timeZone
    // "EST"/"EDT" read as noise to most people; the generic "ET" is what a league says.
    const generic: Record<string, string> = { EST: 'ET', EDT: 'ET', CST: 'CT', CDT: 'CT', MST: 'MT', MDT: 'MT', PST: 'PT', PDT: 'PT' }
    return generic[part] ?? part
  } catch {
    return timeZone
  }
}

/** "10 PM" / "10:30 PM" for a HH:MM wall time. */
export function formatWallMinutes(minute: number, locale = 'en-US'): string {
  const d = new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60))
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', timeZone: 'UTC', ...(minute % 60 ? { minute: '2-digit' } : {}) }
  return new Intl.DateTimeFormat(locale, opts).format(d)
}

export type EtaDay = 'today' | 'tomorrow' | 'later'

/** Rounds to ten minutes and says which local day it falls on relative to `now`. */
export function describeEta(eta: Date, now: Date, locale = 'en-US', timeZone?: string): { day: EtaDay; weekday: string; time: string } {
  const rounded = new Date(Math.round(eta.getTime() / 600000) * 600000)
  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(d)
  const today = dayKey(now)
  const tomorrow = dayKey(new Date(now.getTime() + 24 * 3600 * 1000))
  const key = dayKey(rounded)
  const day: EtaDay = key === today ? 'today' : key === tomorrow ? 'tomorrow' : 'later'
  return {
    day,
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', ...(timeZone ? { timeZone } : {}) }).format(rounded),
    time: formatClockTime(rounded, locale, timeZone),
  }
}

/** Board label of the viewer's next pick: current overall + picks away → "2.9". */
export function nextPickLabel(currentOverall: number, picksAway: number, teamCount: number): string | null {
  if (!Number.isFinite(currentOverall) || !Number.isFinite(picksAway) || teamCount < 1) return null
  const overall = currentOverall + picksAway
  return `${Math.ceil(overall / teamCount)}.${((overall - 1) % teamCount) + 1}`
}
