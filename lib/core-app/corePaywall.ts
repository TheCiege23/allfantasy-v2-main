/**
 * Server side of the /core depth paywall: resolve the viewer's plans ONCE per render and
 * decide every depth from that. The rule and its reasons live in ./coreDepthAccess.ts.
 */
import 'server-only'

import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { hasFeatureAccessForPlans } from '@/lib/subscription/feature-access'
import { getPaywallStartsAt, isPaywallLive } from '@/lib/monetization/paywallLaunch'
import {
  CORE_DEPTH,
  decideCoreDepth,
  type CoreDepth,
  type CoreDepthAccess,
} from '@/lib/core-app/coreDepthAccess'

export type CorePaywall = Record<CoreDepth, CoreDepthAccess>

export async function resolveCorePaywall(
  userId: string | null | undefined,
  opts: { email?: string | null; now?: Date } = {},
): Promise<CorePaywall> {
  const now = opts.now ?? new Date()
  const live = isPaywallLive(now)
  const startsAt = getPaywallStartsAt()

  let snapshot: Awaited<ReturnType<EntitlementResolver['resolveSnapshot']>> | null = null
  if (userId) {
    snapshot = await new EntitlementResolver().resolveSnapshot(userId, opts.email ?? null).catch((error) => {
      // After launch this locks the depth (fail closed); before launch nothing is locked anyway.
      console.error('[core-paywall] entitlement lookup failed', error)
      return null
    })
  }

  const decide = (depth: CoreDepth): CoreDepthAccess => {
    const hasPlan = snapshot
      ? hasFeatureAccessForPlans(snapshot.plans, snapshot.status, CORE_DEPTH[depth].featureId)
      : false
    return decideCoreDepth(depth, { live, startsAt, hasPlan })
  }

  return {
    player_depth: decide('player_depth'),
    trade_depth: decide('trade_depth'),
    commissioner_depth: decide('commissioner_depth'),
    competitive_edge: decide('competitive_edge'),
  }
}

/** One depth, for an API route or a page that needs only that one. Same rule, same single read. */
export async function resolveCoreDepth(
  userId: string | null | undefined,
  depth: CoreDepth,
  opts: { email?: string | null; now?: Date } = {},
): Promise<CoreDepthAccess> {
  return (await resolveCorePaywall(userId, opts))[depth]
}
