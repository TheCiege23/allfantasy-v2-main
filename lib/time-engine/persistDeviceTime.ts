import 'server-only'

import { prisma } from '@/lib/prisma'
import { ensureUserProfileForUserId } from '@/lib/user-profile/ensureUserProfileForUserId'
import { getServerNowUTC } from '@/lib/time-engine/serverClock'
import { detectTimeMismatch } from '@/lib/time-engine/mismatch'
import { normalizeToUTC } from '@/lib/time-engine/normalize'
import { isValidIanaTimeZone } from '@/lib/timezone'
import { resolveUserTimezone } from '@/lib/time-engine/resolveTimezone'

type PersistDeviceTimeInput = {
  userId: string
  deviceTimezone: string
  deviceLocalIso: string
}

/**
 * Persist device time signals and recompute mismatch flags. Call from API only (throttled client).
 */
export async function persistDeviceTimeContext(input: PersistDeviceTimeInput): Promise<{
  ok: boolean
  timeMismatchFlag: boolean
}> {
  const tz = input.deviceTimezone?.trim() ?? ''
  if (!tz || !isValidIanaTimeZone(tz)) {
    return { ok: false, timeMismatchFlag: false }
  }
  const dev = normalizeToUTC(input.deviceLocalIso)
  if (Number.isNaN(dev.getTime())) {
    return { ok: false, timeMismatchFlag: false }
  }

  await ensureUserProfileForUserId(input.userId)

  const profile = await prisma.userProfile.findUnique({
    where: { userId: input.userId },
    select: { timezone: true },
  })
  const accountTz = resolveUserTimezone(profile?.timezone)

  const { timezoneMismatch, deviceClockMismatch } = detectTimeMismatch({
    accountTimezone: accountTz,
    deviceTimezone: tz,
    deviceLocalIso: input.deviceLocalIso,
  })

  const timeMismatchFlag = timezoneMismatch || deviceClockMismatch
  const serverNow = getServerNowUTC()

  await prisma.userProfile.update({
    where: { userId: input.userId },
    data: {
      deviceTimezoneLastSeen: tz,
      deviceTimeLastSeen: dev,
      timeMismatchFlag,
      lastTimeContextAt: serverNow,
    },
  })

  return { ok: true, timeMismatchFlag }
}
