import { prisma } from "@/lib/prisma"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import {
  expandPlansWithBundle,
  isActiveOrGraceStatus,
} from "@/lib/subscription/feature-access"
import type { SubscriptionPlanId } from "@/lib/subscription/types"

/**
 * Single place that updates UserProfile boolean flags from canonical subscription state (System B)
 * so legacy gates (e.g. requireAfSub → afCommissionerSub) stay aligned with userSubscription rows.
 */
export async function syncUserProfileFromSubscriptions(userId: string): Promise<void> {
  const resolver = new EntitlementResolver()
  const snapshot = await resolver.resolveSnapshot(userId)

  const expanded = expandPlansWithBundle(snapshot.plans as SubscriptionPlanId[])
  const active = isActiveOrGraceStatus(snapshot.status)

  const hasCommissioner =
    active && (expanded.includes("commissioner") || expanded.includes("supreme"))
  const hasPro = active && (expanded.includes("pro") || expanded.includes("supreme"))
  const hasWarRoom =
    active && (expanded.includes("war_room") || expanded.includes("supreme"))

  await prisma.userProfile.upsert({
    where: { userId },
    update: {
      afCommissionerSub: hasCommissioner,
      afProSub: hasPro,
      afWarRoomSub: hasWarRoom,
    },
    create: {
      userId,
      afCommissionerSub: hasCommissioner,
      afProSub: hasPro,
      afWarRoomSub: hasWarRoom,
    },
  })
}

/**
 * Batch sync for cron: every distinct user with a userSubscription row.
 */
export async function syncAllActiveSubscribers(): Promise<{ synced: number; errors: number }> {
  const rows = await prisma.userSubscription.findMany({
    select: { userId: true },
    distinct: ["userId"],
  })

  let synced = 0
  let errors = 0

  for (const row of rows) {
    try {
      await syncUserProfileFromSubscriptions(row.userId)
      synced += 1
    } catch {
      errors += 1
    }
  }

  return { synced, errors }
}
