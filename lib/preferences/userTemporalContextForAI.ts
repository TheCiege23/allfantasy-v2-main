/**
 * Ground-truth "now" for AI prompts: server time formatted in the user's profile timezone
 * (signup/settings). Models must use this for relative dates, day counts, and "today" — not
 * training-cutoff assumptions.
 */

import { DEFAULT_TIMEZONE, isValidTimezone } from '@/lib/preferences/TimezonePreferenceService'

type UserTemporalContextForAI = {
  userTimezone: string
  userLocalDateTime: string
  userLocalCalendarDate: string
  utcNowIso: string
  /** Single block to paste into system or deterministic context */
  promptLine: string
}

export function buildUserTemporalContextForAI(args: {
  timezone: string | null | undefined
  preferredLanguage?: string | null
  /** For tests only — production should omit so server clock is used */
  now?: Date
}): UserTemporalContextForAI {
  const now = args.now ?? new Date()
  const tz = isValidTimezone(args.timezone) ? args.timezone : DEFAULT_TIMEZONE
  const locale =
    args.preferredLanguage === 'es' || args.preferredLanguage === 'es-MX' ? 'es-MX' : 'en-US'

  let userLocalDateTime: string
  try {
    userLocalDateTime = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(now)
  } catch {
    userLocalDateTime = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(now)
  }

  let userLocalCalendarDate: string
  try {
    userLocalCalendarDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    userLocalCalendarDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  }

  const utcNowIso = now.toISOString()

  const promptLine = [
    'CURRENT TIME (authoritative — use for "today", day-of-week, and "how many days until" calculations; do not use a different assumed calendar date or year):',
    `User timezone (profile / signup): ${tz}`,
    `User local: ${userLocalDateTime}`,
    `User local calendar date in that zone (YYYY-MM-DD): ${userLocalCalendarDate}`,
    `UTC (ISO): ${utcNowIso}`,
  ].join('\n')

  return {
    userTimezone: tz,
    userLocalDateTime,
    userLocalCalendarDate,
    utcNowIso,
    promptLine,
  }
}
