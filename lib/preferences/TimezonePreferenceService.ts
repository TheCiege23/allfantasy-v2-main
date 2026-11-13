/**
 * Timezone preference: stored on server (UserProfile.timezone). No client localStorage for timezone.
 * Read via GET /api/user/profile; write via PATCH /api/user/profile (timezone).
 * Formatting uses TimezoneFormattingResolver with the user's IANA timezone.
 */

import {
  DEFAULT_SIGNUP_TIMEZONE,
  SIGNUP_TIMEZONES,
} from "@/lib/signup/timezones"

export const DEFAULT_TIMEZONE = DEFAULT_SIGNUP_TIMEZONE

const ALLOWED_TIMEZONES = new Set(
  SIGNUP_TIMEZONES.map((timezone) => timezone.value)
)

/**
 * Validates against the allowed U.S./Canada/Mexico IANA timezone list.
 */
export function isValidTimezone(value: string | null | undefined): value is string {
  return typeof value === "string" && ALLOWED_TIMEZONES.has(value)
}
