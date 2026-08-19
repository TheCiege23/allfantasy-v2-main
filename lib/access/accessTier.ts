import type { SubscriptionPlanId } from '@/lib/subscription/types'

/** Paid subscription tiers that gate real feature access (excludes the enterprise workspace tier). */
export type PaidTier = 'pro' | 'commissioner' | 'war_room' | 'supreme'

/**
 * The one accessTier vocabulary every gate in the app should read from.
 * - guest: no AllFantasy account. May still have a real, personalized preview via the
 *   signed af_guest_session cookie (a no-login Sleeper import) — that's guest DATA, not a
 *   different tier. Access-wise, every unauthenticated visitor is "guest".
 * - free: signed in, no active paid subscription.
 * - paid: signed in with at least one active (or grace-period) paid subscription.
 */
export type AccessTier = 'guest' | 'free' | 'paid'

export interface AccessTierResult {
  tier: AccessTier
  /** Which paid tiers are active, if tier === 'paid'. Empty otherwise. */
  paidTiers: PaidTier[]
  isAuthenticated: boolean
  isGuest: boolean
}

export interface AccessTierPaidFlags {
  hasPro: boolean
  hasCommissioner: boolean
  hasWarRoom: boolean
  hasSupreme: boolean
}

/**
 * Pure resolution — no I/O, safe on client or server. Callers gather `isAuthenticated`
 * from a session and the four `has*` flags from the entitlements snapshot (already-expanded
 * for bundle inheritance — see hooks/useEntitlements.ts's hasPro/hasCommissioner/etc).
 */
export function resolveAccessTier(input: { isAuthenticated: boolean } & AccessTierPaidFlags): AccessTierResult {
  if (!input.isAuthenticated) {
    return { tier: 'guest', paidTiers: [], isAuthenticated: false, isGuest: true }
  }

  const paidTiers: PaidTier[] = []
  if (input.hasPro) paidTiers.push('pro')
  if (input.hasCommissioner) paidTiers.push('commissioner')
  if (input.hasWarRoom) paidTiers.push('war_room')
  if (input.hasSupreme) paidTiers.push('supreme')

  return {
    tier: paidTiers.length > 0 ? 'paid' : 'free',
    paidTiers,
    isAuthenticated: true,
    isGuest: false,
  }
}

/** Maps a PaidTier to its SubscriptionPlanId for display/pricing lookups. */
export function paidTierToPlanId(tier: PaidTier): SubscriptionPlanId {
  return tier
}
