import { prisma } from "@/lib/prisma"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import { planFlagsFromSnapshot } from "@/lib/subscription/livePlanFlags"

/**
 * Single place that updates UserProfile boolean flags from canonical subscription state (System B).
 *
 * ⚠ THE FLAGS ARE A SNAPSHOT, NOT AN ACCESS CHECK. This runs only on a Stripe webhook or a
 * post-purchase sync, so a flag misses admin grants and plans that lapse by date. Gate on
 * `resolveLivePlanFlags` (lib/subscription/livePlanFlags.ts), which computes the same
 * answer live — this function uses it too, so the two cannot disagree on what a plan means.
 */
export async function syncUserProfileFromSubscriptions(userId: string): Promise<void> {
  const resolver = new EntitlementResolver()
  const snapshot = await resolver.resolveSnapshot(userId)
  const flags = planFlagsFromSnapshot(snapshot)
  const hasCommissioner = flags.commissioner
  const hasPro = flags.pro
  const hasWarRoom = flags.warRoom

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
