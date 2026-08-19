/**
 * Fantasy OS enterprise-workspace access — the single source of truth.
 *
 * Access is granted to exactly three cases and nothing else:
 *   1. platform admin,
 *   2. the owner,
 *   3. an active `enterprise` entitlement.
 *
 * The `/fantasy-os` route guard consumes this as the SECURITY boundary. The dashboard
 * nav entry and launch card are convenience surfaces that consume the same resolver — they
 * are never the boundary. Fails closed on any error: never grants access on failure.
 *
 * Customer-facing rule: this gates the "Fantasy OS" workspace. The internal engine name
 * ("Decision OS") must never appear on any surface reached through here.
 */
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { expandPlansWithBundle } from '@/lib/subscription/feature-access'
import { isAdminRole, isAdminEmailAllowed } from '@/lib/adminAuth'
import { isDevAdminUserId } from '@/lib/dev-admin/access'
import type { EntitlementStatus } from '@/lib/subscription/types'

export type FantasyOsAccessInput = {
  userId?: string | null
  email?: string | null
  /** NextAuth session role, when available (e.g. "admin"). */
  role?: string | null
}

/** Reason an access decision was reached — useful for the launch-card variant + debugging. */
export type FantasyOsAccessReason = 'admin' | 'owner' | 'enterprise' | 'none'

const ACTIVE_STATUSES: ReadonlySet<EntitlementStatus> = new Set<EntitlementStatus>(['active', 'grace'])

const entitlementResolver = new EntitlementResolver()

/** Owner/admin override — always passes, independent of subscription state. */
export function isFantasyOsAdminOrOwner(input: FantasyOsAccessInput): boolean {
  return isAdminRole(input.role) || isAdminEmailAllowed(input.email) || isDevAdminUserId(input.userId)
}

/**
 * Resolve Fantasy OS access + the reason. Admin/owner short-circuits without a DB read;
 * everyone else is checked against an active `enterprise` entitlement.
 */
export async function resolveFantasyOsAccess(
  input: FantasyOsAccessInput,
): Promise<{ allowed: boolean; reason: FantasyOsAccessReason }> {
  if (isAdminRole(input.role) || isDevAdminUserId(input.userId)) return { allowed: true, reason: 'admin' }
  if (isAdminEmailAllowed(input.email)) return { allowed: true, reason: 'owner' }
  if (!input.userId) return { allowed: false, reason: 'none' }
  try {
    const snapshot = await entitlementResolver.resolveSnapshot(input.userId, input.email ?? undefined)
    if (!ACTIVE_STATUSES.has(snapshot.status)) return { allowed: false, reason: 'none' }
    const hasEnterprise = expandPlansWithBundle(snapshot.plans).includes('enterprise')
    return hasEnterprise ? { allowed: true, reason: 'enterprise' } : { allowed: false, reason: 'none' }
  } catch {
    // Fail closed — a resolver/DB error must never open the workspace.
    return { allowed: false, reason: 'none' }
  }
}

/** Boolean access check used by the route guard and nav/card visibility. */
export async function canAccessFantasyOS(input: FantasyOsAccessInput): Promise<boolean> {
  const { allowed } = await resolveFantasyOsAccess(input)
  return allowed
}

/**
 * Smallest client-safe access view for dashboard UI. Carries only allowed + a coarse reason
 * (owner/admin/enterprise/unauthorized) — never raw entitlements, admin flags, plan ids, or
 * internal authorization details. The server resolver remains the authorization source of truth;
 * this is a presentational hint for nav/card visibility + copy variant.
 */
export type FantasyOsAccessView = {
  allowed: boolean
  reason: 'owner' | 'admin' | 'enterprise' | 'unauthorized'
}

export async function resolveFantasyOsAccessView(input: FantasyOsAccessInput): Promise<FantasyOsAccessView> {
  const { allowed, reason } = await resolveFantasyOsAccess(input)
  return { allowed, reason: reason === 'none' ? 'unauthorized' : reason }
}
