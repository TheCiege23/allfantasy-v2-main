import { LOCK_ZONE } from './lineupLock'

/**
 * When the injury feed said it — "reported Sat 7:58p ET", or "reported Sat"
 * when the row carries a day and no time.
 *
 * ⚠ THE FEED'S `date` IS TWO THINGS. Measured on production 2026-09-06 over
 * the last 7 days of NFL rows: 1,626 of 2,165 carry a time of day and 539 are
 * midnight UTC — a date-only value from a provider that has no time. Printing
 * "8:00p ET" for those would put a time on a report that never had one, so a
 * midnight-UTC value prints its UTC weekday only.
 *
 * Client-safe: Intl only, zone pinned so server and browser agree.
 */

export function reportedLabel(iso: string | null | undefined, nowIso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  const fmt = (opts: Intl.DateTimeFormatOptions, zone: string) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: zone }).formatToParts(d)
    } catch {
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).formatToParts(d)
    }
  }
  const get = (parts: Intl.DateTimeFormatPart[], t: Intl.DateTimeFormatPart['type']) => parts.find((p) => p.type === t)?.value ?? ''

  /*
   * ⚠ A WEEKDAY ALONE IS AMBIGUOUS ONCE IT IS A WEEK OLD. On Sunday morning
   * 2026-09-27 the list read "reported Sun 6:47p ET" for a report from the
   * PREVIOUS Sunday — a time that had not happened yet that day. From six days
   * back the month/day is added: "reported Sun 9/20 6:47p ET".
   */
  const ageMs = nowIso ? new Date(nowIso).getTime() - d.getTime() : NaN
  const withDate = Number.isFinite(ageMs) && ageMs >= 6 * 24 * 60 * 60 * 1000

  if (dateOnly) {
    const parts = fmt({ weekday: 'short', month: 'numeric', day: 'numeric' }, 'UTC')
    const day = withDate ? ` ${get(parts, 'month')}/${get(parts, 'day')}` : ''
    return `reported ${get(parts, 'weekday')}${day}`
  }

  const parts = fmt({ weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }, LOCK_ZONE)
  const ampm = get(parts, 'dayPeriod').toLowerCase().startsWith('p') ? 'p' : 'a'
  const day = withDate ? ` ${get(parts, 'month')}/${get(parts, 'day')}` : ''
  const when = `${get(parts, 'weekday')}${day} ${get(parts, 'hour')}:${get(parts, 'minute')}${ampm} ET`

  // Inside the last hour on a game day, minutes matter more than the clock.
  if (nowIso) {
    const ms = new Date(nowIso).getTime() - d.getTime()
    if (Number.isFinite(ms) && ms >= 0 && ms < 60 * 60 * 1000) {
      const mins = Math.max(1, Math.floor(ms / 60_000))
      return `reported ${mins} min ago`
    }
  }
  return `reported ${when}`
}
