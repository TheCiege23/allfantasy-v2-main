/**
 * Create League v2 — the device's timezone as the starting draft/league timezone.
 *
 * A fresh create used to start on America/New_York for everyone, so a manager in Chicago or
 * London had to notice and change it, or their draft time was read in Eastern time. The device
 * already knows its zone; the server accepts any valid IANA zone (`validateCreatePayload`), so the
 * wizard starts on the device's own.
 */
import { isValidIanaTimeZone } from '@/lib/timezone'
import { CREATE_LEAGUE_TIMEZONES, CREATE_LEAGUE_TIMEZONE_LABELS } from '@/lib/create-league-v2/simple-create'

/**
 * The device's IANA timezone, or null when the runtime cannot say or names one the server would
 * refuse. Only meaningful in the browser: on the server this is the host's zone, not the manager's.
 */
export function readDeviceTimezone(
  read: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | null {
  try {
    const timezone = read()?.trim()
    return timezone && isValidIanaTimeZone(timezone) ? timezone : null
  } catch {
    return null
  }
}

/**
 * The name shown for a timezone: the wizard's label ("Eastern Time (ET)"), or for a zone not on
 * the list the city plus its id ("Madrid (Europe/Madrid)") — never a bare IANA string alone.
 */
export function timezoneLabel(timezone: string): string {
  const known = CREATE_LEAGUE_TIMEZONE_LABELS[timezone]
  if (known) return known
  const city = timezone.split('/').at(-1)?.replaceAll('_', ' ')
  return city && city !== timezone ? `${city} (${timezone})` : timezone
}

/**
 * The timezone select's options: the standard list, with the current value first when it is not
 * on it — a device in Europe/London must still show as selected, not fall back to the first option.
 */
export function timezoneOptions(current: string, base: readonly string[] = CREATE_LEAGUE_TIMEZONES): string[] {
  const value = current.trim()
  return value && !base.includes(value) ? [value, ...base] : [...base]
}
