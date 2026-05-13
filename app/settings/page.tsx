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

/**
 * Races a promise against a wall-clock timeout.
 * Returns the fallback if the timeout fires first.
 * Prevents slow DB queries from blocking the page SSR response.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timer = new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
  return Promise.race([promise, timer])
}

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

  // TG2 + TG3 — fetch plan label and account creation date in parallel,
  // each capped at 2 s so a cold DB start cannot stall the page render.
  const [user, snapshot] = await Promise.all([
    withTimeout(
      prisma.appUser
        .findUnique({ where: { id: userId }, select: { createdAt: true } })
        .catch(() => null),
      2000,
      null
    ),
    withTimeout(
      new EntitlementResolver().resolveSnapshot(userId).catch(() => null),
      2000,
      null
    ),
  ])

  let planLabel: string | null = null
  if (snapshot && snapshot.plans.length > 0) {
    const topPlan =
      PLAN_TIER_ORDER.find((p) => snapshot.plans.includes(p)) ?? snapshot.plans[0]
    planLabel = getDisplayPlanName(topPlan)
  }

  return (
    <SettingsApp
      uploadLeagueId={null}
      accountCreatedAt={user?.createdAt?.toISOString() ?? null}
      planLabel={planLabel}
    />
  )
}
