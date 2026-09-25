import { EntitlementResolver, type EntitlementSnapshot } from "@/lib/subscription/EntitlementResolver"
import { expandPlansWithBundle, isActiveOrGraceStatus } from "@/lib/subscription/feature-access"

/**
 * Which plans a user holds RIGHT NOW — the live answer behind the old UserProfile
 * booleans `afProSub` / `afCommissionerSub` / `afWarRoomSub`.
 *
 * 🛑 READ THIS, NOT THE PROFILE FLAGS. The flags are a copy written only when a Stripe
 * webhook or a post-purchase sync runs (lib/subscription/syncBridge.ts), and nothing
 * refreshes them on a schedule. So they miss everything the resolver sees that is not a
 * Stripe event:
 *  - an admin grant (`admin_subscription_grants`) — a comped user stays locked out;
 *  - a plan that lapses by DATE (period, grace or expiry passing) — the flag stays true;
 *  - the admin bypass accounts, which have no subscription row at all.
 * Measured on production 2026-09-24: one entitled account had no flag, and was locked
 * out of every feature gated on one.
 *
 * Same plan semantics as the flags (Supreme counts toward every family), so a gate
 * moved from a flag to this changes only freshness, never who a plan is for.
 */
export type LivePlanFlags = {
  pro: boolean
  commissioner: boolean
  warRoom: boolean
}

export const NO_PLAN_FLAGS: LivePlanFlags = Object.freeze({ pro: false, commissioner: false, warRoom: false })

export function planFlagsFromSnapshot(snapshot: Pick<EntitlementSnapshot, "plans" | "status">): LivePlanFlags {
  if (!isActiveOrGraceStatus(snapshot.status)) return { ...NO_PLAN_FLAGS }
  const expanded = expandPlansWithBundle(snapshot.plans)
  const supreme = expanded.includes("supreme")
  return {
    pro: supreme || expanded.includes("pro"),
    commissioner: supreme || expanded.includes("commissioner"),
    warRoom: supreme || expanded.includes("war_room"),
  }
}

/**
 * Fails CLOSED: if the plan cannot be resolved, no plan — the same rule as every other
 * plan check after launch. It never throws, so a page gating one panel on it still renders.
 */
export async function resolveLivePlanFlags(userId: string, email?: string | null): Promise<LivePlanFlags> {
  try {
    const snapshot = await new EntitlementResolver().resolveSnapshot(userId, email)
    return planFlagsFromSnapshot(snapshot)
  } catch {
    return { ...NO_PLAN_FLAGS }
  }
}
