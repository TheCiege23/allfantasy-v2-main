import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { readAdOptOut, withAdOptOut, type AdOptOutSource } from "@/lib/privacy/adMeasurementOptOut"

/**
 * The account half of "Do Not Sell or Share" (see lib/privacy/adMeasurementOptOut).
 *
 * ⚠ FAILS CLOSED. If the record cannot be read, the caller is told the person HAS opted out:
 * a conversion event lost to a database blip costs one data point, and one sent against a
 * recorded opt-out is the thing the Privacy Policy promises will not happen.
 */
export async function isUserAdOptedOut(userId: string): Promise<boolean> {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { notificationPreferences: true },
    })
    return readAdOptOut(profile?.notificationPreferences) !== null
  } catch {
    return true
  }
}

/**
 * Set or clear the account opt-out. Merged into notificationPreferences, never replacing it,
 * with the same compare-and-set the notification settings writer uses, so a concurrent
 * settings save cannot erase it (or be erased by it). Returns false when it could not write.
 */
export async function setUserAdOptOut(userId: string, optOut: { source: AdOptOutSource } | null): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await prisma.userProfile.findUnique({
      where: { userId },
      select: { notificationPreferences: true },
    })
    const already = readAdOptOut(current?.notificationPreferences) !== null
    if (already === Boolean(optOut)) return true
    const next = withAdOptOut(current?.notificationPreferences, optOut) as Prisma.InputJsonObject
    if (!current) {
      await prisma.userProfile.create({ data: { userId, notificationPreferences: next } })
      return true
    }
    const { count } = await prisma.userProfile.updateMany({
      where: {
        userId,
        notificationPreferences: { equals: current.notificationPreferences ?? Prisma.AnyNull },
      },
      data: { notificationPreferences: next },
    })
    if (count === 1) return true
  }
  return false
}
