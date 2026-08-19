import 'server-only'

import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { canAccess, type CanAccessResult } from '@/lib/access/canAccess'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

const resolver = new EntitlementResolver()

/**
 * Server-side wrapper over the single `canAccess` seam (AF_GATE0 §3.4). Resolves the
 * user's entitlement snapshot from the DB, then applies the same pure `canAccess`
 * decision the client uses — so server and client agree on locked/allowed.
 *
 * Returns a rich, non-throwing result (unlike `requireEntitlement`, which returns a 402
 * NextResponse for HTTP guards). Use this when a server surface needs to RENDER a locked
 * preview or branch on access rather than reject a request.
 *
 * Pass `isAuthenticated: false` (or omit `userId`) for an unauthenticated/trial request.
 */
export async function canAccessForUser(
  feature: SubscriptionFeatureId,
  args: { userId?: string | null; email?: string | null; returnTo?: string },
): Promise<CanAccessResult> {
  const userId = args.userId?.trim()
  if (!userId) {
    return canAccess(feature, { isAuthenticated: false, returnTo: args.returnTo })
  }

  const snapshot = await resolver.resolveSnapshot(userId, args.email ?? null).catch(() => null)
  return canAccess(feature, {
    isAuthenticated: true,
    plans: snapshot?.plans ?? [],
    status: snapshot?.status,
    returnTo: args.returnTo,
  })
}
