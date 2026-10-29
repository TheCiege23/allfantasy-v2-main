import { formatDistance } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/** Convert wall-clock date + time in an IANA zone to UTC. */
export function toUtc(localDateStr: string, localTimeStr: string, tz: string): Date {
  return fromZonedTime(new Date(`${localDateStr}T${localTimeStr}`), tz)
}

/** Default league timezone — matches the `League.timezone` / `LeagueSettings.timezone` schema default. */
export const DEFAULT_LEAGUE_TIMEZONE = 'America/New_York'

function resolveZone(tz: string | null | undefined): string {
  return tz && isValidIanaTimeZone(tz) ? tz : DEFAULT_LEAGUE_TIMEZONE
}

/**
 * Wall-clock `YYYY-MM-DD` + `HH:MM` in an IANA zone → the UTC instant it names, independent of the
 * host's own timezone. DST is resolved by the zone rules (date-fns-tz). Malformed input → null.
 * An invalid or missing zone falls back to America/New_York.
 */
export function wallClockToUtc(date: string, time: string, tz: string | null | undefined): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  if (h! > 23 || mi! > 59) return null
  // Reject impossible calendar dates (2026-13-40, 2026-02-31) rather than letting them roll over.
  const cal = new Date(Date.UTC(y!, m! - 1, d!))
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== m! - 1 || cal.getUTCDate() !== d) return null
  // A string (not a host-local Date) so the host's own DST gaps cannot shift the wall-clock first.
  const out = fromZonedTime(`${date}T${time}:00`, resolveZone(tz))
  return Number.isNaN(out.getTime()) ? null : out
}

/** UTC instant → wall-clock `{ date: YYYY-MM-DD, time: HH:MM }` in an IANA zone. Unparseable → null. */
export function utcToWallClock(
  instant: string | Date,
  tz: string | null | undefined,
): { date: string; time: string } | null {
  const d = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(d.getTime())) return null
  const zone = resolveZone(tz)
  return { date: formatInTimeZone(d, zone, 'yyyy-MM-dd'), time: formatInTimeZone(d, zone, 'HH:mm') }
}

/** Short zone name at an instant ("EDT", "EST", "PDT"; "GMT+1" where no abbreviation exists). */
export function timeZoneShortName(tz: string | null | undefined, at: Date = new Date()): string {
  const zone = resolveZone(tz)
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')
    return part?.value ?? zone
  } catch {
    return zone
  }
}

export function formatInTz(utcDate: Date, tz: string): string {
  return formatInTimeZone(utcDate, tz, 'MMM d, yyyy h:mm a zzz')
}

export function formatDistanceUtc(utcDate: Date, base: Date = new Date()): string {
  return formatDistance(utcDate, base, { addSuffix: true })
}

export const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'America/Toronto', label: 'Eastern Canada (ET)' },
  { value: 'America/Vancouver', label: 'Pacific Canada (PT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central Europe (CET)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
] as const

export function isValidIanaTimeZone(tz: string): boolean {
  try {
    const supported =
      typeof Intl !== 'undefined' &&
      'supportedValuesOf' in Intl &&
      typeof (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf ===
        'function'
        ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
        : null
    if (supported?.includes(tz)) return true
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}
