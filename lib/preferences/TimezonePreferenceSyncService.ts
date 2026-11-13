import {
  DEFAULT_TIMEZONE,
  isValidTimezone,
} from "@/lib/preferences/TimezonePreferenceService"

interface TimezonePreferenceSyncInput {
  profileTimezone: string | null
  browserTimezone: string | null
}

export interface TimezonePreferenceSyncResult {
  timezone: string
  shouldPersistToProfile: boolean
}

export function detectBrowserTimezone(): string | null {
  if (typeof Intl === "undefined") return null
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimezone(tz) ? tz : null
  } catch {
    return null
  }
}

export function resolveTimezonePreferenceSync(
  input: TimezonePreferenceSyncInput
): TimezonePreferenceSyncResult {
  if (isValidTimezone(input.profileTimezone)) {
    return {
      timezone: input.profileTimezone,
      shouldPersistToProfile: false,
    }
  }

  if (isValidTimezone(input.browserTimezone)) {
    return {
      timezone: input.browserTimezone,
      shouldPersistToProfile: true,
    }
  }

  return {
    timezone: DEFAULT_TIMEZONE,
    shouldPersistToProfile: false,
  }
}
