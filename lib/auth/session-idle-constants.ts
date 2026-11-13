/** Allowed values for UserProfile.sessionIdleTimeoutMinutes (null/0 = disabled). */
const SESSION_IDLE_TIMEOUT_MINUTES = [30, 60, 240, 720, 1440] as const

type SessionIdleTimeoutMinutes = (typeof SESSION_IDLE_TIMEOUT_MINUTES)[number]

export function isAllowedSessionIdleMinutes(value: unknown): value is SessionIdleTimeoutMinutes {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (SESSION_IDLE_TIMEOUT_MINUTES as readonly number[]).includes(value)
  )
}

export function resolveSessionIdleMs(
  minutes: number | null | undefined
): number | null {
  if (minutes == null || minutes === 0) return null
  if (!isAllowedSessionIdleMinutes(minutes)) return null
  return minutes * 60 * 1000
}
