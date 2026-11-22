import { getServerNowUTC } from '@/lib/time-engine/serverClock'
import { normalizeToUTC } from '@/lib/time-engine/normalize'

/** Wall-clock skew threshold between device-reported instant and server (seconds). */
const DEFAULT_CLOCK_SKEW_WARN_SECONDS = 120

type MismatchResult = {
  timezoneMismatch: boolean
  deviceClockMismatch: boolean
  clockSkewSeconds: number | null
}

export function detectTimeMismatch(input: {
  accountTimezone: string
  deviceTimezone: string | null
  deviceLocalIso: string | null
  serverNow?: Date
  skewWarnSeconds?: number
}): MismatchResult {
  const serverNow = input.serverNow ?? getServerNowUTC()
  const skewLimit = input.skewWarnSeconds ?? DEFAULT_CLOCK_SKEW_WARN_SECONDS

  const timezoneMismatch = Boolean(
    input.deviceTimezone &&
      input.deviceTimezone.trim() &&
      input.deviceTimezone.trim() !== input.accountTimezone.trim()
  )

  let deviceClockMismatch = false
  let clockSkewSeconds: number | null = null

  if (input.deviceLocalIso) {
    const dev = normalizeToUTC(input.deviceLocalIso)
    if (!Number.isNaN(dev.getTime())) {
      const deltaSec = Math.abs((dev.getTime() - serverNow.getTime()) / 1000)
      clockSkewSeconds = deltaSec
      if (deltaSec > skewLimit) {
        deviceClockMismatch = true
      }
    }
  }

  return { timezoneMismatch, deviceClockMismatch, clockSkewSeconds }
}

