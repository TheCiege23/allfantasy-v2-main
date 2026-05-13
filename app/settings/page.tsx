import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import { getDisplayPlanName } from "@/lib/subscription/feature-access"
import type { SubscriptionPlanId } from "@/lib/subscription/types"
import SettingsApp from "./components/SettingsApp"

export const dynamic = "force-dynamic"

/** Plan IDs ordered from highest to lowest tier for display purposes. */
const PLAN_TIER_ORDER: SubscriptionPlanId[] = [
  "supreme",
  "all_access",
  "commissioner",
  "war_room",
  "pro",
]

export default async function SettingsPage() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user) {
    redirect("/login?callbackUrl=/settings")
  }

  if (!session.user.id) {
    redirect("/login?callbackUrl=/settings")
  }

  const userId = session.user.id

  // TG3 — fetch account creation date
  const user = await prisma.appUser
    .findUnique({ where: { id: userId }, select: { createdAt: true } })
    .catch(() => null)

  // TG2 — fetch subscription plan label
  let planLabel: string | null = null
  try {
    const snapshot = await new EntitlementResolver().resolveSnapshot(userId)
    if (snapshot.plans.length > 0) {
      // Pick the highest-tier plan present in the snapshot
      const topPlan =
        PLAN_TIER_ORDER.find((p) => snapshot.plans.includes(p)) ?? snapshot.plans[0]
      planLabel = getDisplayPlanName(topPlan)
    }
  } catch {
    // Fall back to null → AccountSettingsSection shows localised "Free" label
  }

  return (
    <SettingsApp
      uploadLeagueId={null}
      accountCreatedAt={user?.createdAt?.toISOString() ?? null}
      planLabel={planLabel}
    />
  )
}
