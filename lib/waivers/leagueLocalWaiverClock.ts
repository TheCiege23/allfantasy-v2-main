/**
 * Waivers clear at a time in the LEAGUE'S time zone (owner, 2026-11-25: "make sure the time zones work
 * properly when set" → "Yes, league time").
 *
 * The engine schedules on one UTC weekday list + one UTC "HH:MM" (`LeagueWaiverSettings`). A fixed UTC
 * time drifts an hour of local clock time at every daylight-saving change, so a league set to clear at
 * Wednesday 12:00 AM Pacific would clear at 11 PM Tuesday for half the year. This module keeps the
 * commissioner's LOCAL clear time as the source of truth and derives the UTC engine fields from it AT A
 * GIVEN MOMENT, so re-deriving (at create, on save, and from the waiver cron each run) keeps the clear
 * on the same local wall-clock time all year.
 *
 * Pure and dependency-free.
 */

/** Settings key on `League.settings`: the league's waiver clear time in its own time zone. */
export const LEAGUE_LOCAL_WAIVER_CLEAR_KEY = 'af_waiver_clear_local' as const

export type LocalWaiverClear = {
  /** Local weekdays the waivers clear on, Sunday = 0. */
  days: number[]
  /** Local wall-clock hour, 0–23. */
  hour: number
  /** Local minute, 0–59. */
  minute: number
}

export function safeTimeZone(tz: string | null | undefined): string {
  const zone = String(tz ?? '').trim()
  if (!zone) return 'America/New_York'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0))
    return zone
  } catch {
    return 'America/New_York'
  }
}

/** Minutes the zone is ahead of UTC at `date` (Pacific in winter → −480). */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - date.getTime()) / 60000)
}

export function parseLocalWaiverClear(raw: unknown): LocalWaiverClear | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const days = Array.isArray(r.days) ? r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : []
  const hour = Number(r.hour)
  const minute = Number(r.minute ?? 0)
  if (days.length === 0 || !Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  return { days: [...new Set(days)].sort((a, b) => a - b), hour, minute }
}

export function readLocalWaiverClear(settings: unknown): LocalWaiverClear | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return parseLocalWaiverClear((settings as Record<string, unknown>)[LEAGUE_LOCAL_WAIVER_CLEAR_KEY])
}

/**
 * The engine's UTC fields for this local clear, using the zone's offset at `ref`. Re-run it near each
 * clear (the waiver cron does) and the UTC time follows daylight saving.
 */
export function engineScheduleFromLocalClear(
  local: LocalWaiverClear,
  timeZone: string | null | undefined,
  ref: Date = new Date(),
): { processingDays: number[]; processingDayOfWeek: number; processingTimeUtc: string } {
  const tz = safeTimeZone(timeZone)
  const offset = zoneOffsetMinutes(ref, tz)
  let utcMinutes = local.hour * 60 + local.minute - offset
  let dayShift = 0
  while (utcMinutes < 0) {
    utcMinutes += 1440
    dayShift -= 1
  }
  while (utcMinutes >= 1440) {
    utcMinutes -= 1440
    dayShift += 1
  }
  const days = [...new Set(local.days.map((d) => (((d + dayShift) % 7) + 7) % 7))].sort((a, b) => a - b)
  const hh = String(Math.floor(utcMinutes / 60)).padStart(2, '0')
  const mm = String(utcMinutes % 60).padStart(2, '0')
  return { processingDays: days, processingDayOfWeek: days[0]!, processingTimeUtc: `${hh}:${mm}` }
}

/**
 * The next clear strictly after `from`, as an instant. Each candidate day uses ITS OWN offset, so a
 * clear just after a daylight-saving change lands on the right local time.
 */
export function nextLocalWaiverClear(local: LocalWaiverClear, timeZone: string | null | undefined, from: Date): Date | null {
  const tz = safeTimeZone(timeZone)
  for (let add = 0; add <= 8; add += 1) {
    // Local calendar date `add` days after `from`'s local date.
    const probe = new Date(from.getTime() + add * 86_400_000)
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(probe)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
    if (!local.days.includes(weekday)) continue
    const wallAsUtc = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), local.hour, local.minute)
    // Two passes: the offset at the guessed instant, then at the corrected one (settles across a DST edge).
    let instant = wallAsUtc - zoneOffsetMinutes(new Date(wallAsUtc), tz) * 60_000
    instant = wallAsUtc - zoneOffsetMinutes(new Date(instant), tz) * 60_000
    if (instant > from.getTime()) return new Date(instant)
  }
  return null
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** "Wed 12:00 AM PT" / "Daily 3:00 AM ET" — the clear in the league's own zone, named by its short zone. */
export function formatLocalWaiverClear(local: LocalWaiverClear, timeZone: string | null | undefined, at: Date = new Date()): string {
  const tz = safeTimeZone(timeZone)
  const h12 = local.hour % 12 === 0 ? 12 : local.hour % 12
  const time = `${h12}:${String(local.minute).padStart(2, '0')} ${local.hour < 12 ? 'AM' : 'PM'}`
  const zoneName =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? tz
  // "PST"/"PDT" read as noise to most people; the generic letters do not change with the season.
  const zone = zoneName.replace(/^([A-Z])([SD])T$/, '$1T')
  const days = local.days.length === 7 ? 'Daily' : local.days.map((d) => DAY_SHORT[d]).join(', ')
  return `${days} ${time} ${zone}`
}

/**
 * The default clear for a new league, in its own zone: weekly sports Wednesday 3:00 AM (Sleeper's
 * "Wednesday (3 AM EST)", in the league's own clock), daily sports every day at 3:00 AM — after the
 * night's games, before the next day's. The commissioner can change either.
 */
export function defaultLocalWaiverClear(input: { dailyRuns: boolean }): LocalWaiverClear {
  return input.dailyRuns ? { days: [0, 1, 2, 3, 4, 5, 6], hour: 3, minute: 0 } : { days: [3], hour: 3, minute: 0 }
}
