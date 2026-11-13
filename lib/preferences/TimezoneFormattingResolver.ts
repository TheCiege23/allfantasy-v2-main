/**
 * Format dates/times in the user's preferred timezone.
 * Use for game times, league deadlines, schedule data across Sports App, Bracket, Legacy.
 */

import { isValidTimezone, DEFAULT_TIMEZONE } from "./TimezonePreferenceService"

type TimezoneIana = string

type FormattingLocale = "en-US" | "es-MX"

function resolveLocale(localeOrLanguage?: string | null): FormattingLocale {
  return localeOrLanguage === "es" || localeOrLanguage === "es-MX" ? "es-MX" : "en-US"
}

/**
 * Format a Date or ISO string in the given IANA timezone.
 * Uses Intl.DateTimeFormat with timeZone.
 */
export function formatInTimezone(
  date: Date | string | number,
  timezone: TimezoneIana | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "short",
    timeStyle: "short",
    hour12: true,
  },
  localeOrLanguage?: string | null
): string {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE
  const locale = resolveLocale(localeOrLanguage)
  const d = typeof date === "object" && "getTime" in date ? date : new Date(date)
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: tz }).format(d)
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: DEFAULT_TIMEZONE }).format(d)
  }
}

/**
 * Format time only in the user's timezone.
 */
export function formatTimeInTimezone(
  date: Date | string | number,
  timezone: TimezoneIana | null | undefined,
  localeOrLanguage?: string | null
): string {
  return formatInTimezone(date, timezone, { timeStyle: "short", hour12: true }, localeOrLanguage)
}

/**
 * Format date only in the user's timezone.
 */
export function formatDateInTimezone(
  date: Date | string | number,
  timezone: TimezoneIana | null | undefined,
  localeOrLanguage?: string | null
): string {
  return formatInTimezone(date, timezone, { dateStyle: "short" }, localeOrLanguage)
}
