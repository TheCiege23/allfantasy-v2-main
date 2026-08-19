/**
 * G15.4 — Commissioner Intelligence feature-gate boundary.
 *
 * Defines the entitlement seam WITHOUT enforcing paid gating in the UI yet (per phase
 * scope). The Query Service accepts an optional gate; the default ALLOWS everything so
 * nothing changes for callers today. A later phase swaps in a Stripe-entitlement-backed
 * implementation and flips features to premium — at the API boundary, not scattered.
 */

export const INTELLIGENCE_FEATURES = {
  ACTIVITY_SUMMARY: 'commissioner_intelligence.activity_summary',
  HEALTH_SNAPSHOT: 'commissioner_intelligence.health_snapshot',
  MANAGER_ACTIVITY: 'commissioner_intelligence.manager_activity',
  ACTION_ITEMS: 'commissioner_intelligence.action_items',
  AUDIT_FEED: 'commissioner_intelligence.audit_feed',
} as const

export type IntelligenceFeature = (typeof INTELLIGENCE_FEATURES)[keyof typeof INTELLIGENCE_FEATURES]

export interface FeatureGatePrincipal {
  userId?: string | null
  tenantId?: string
}

export type FeatureGateDecision = 'allow' | 'deny' | 'upgrade_required'

/** Entitlement port. Default impl allows all; production impl maps Stripe → grants. */
export interface IFeatureGate {
  decide(principal: FeatureGatePrincipal | null, feature: IntelligenceFeature): FeatureGateDecision
}

/** G15.4 default: everything allowed (no paid enforcement yet). */
export class AllowAllFeatureGate implements IFeatureGate {
  decide(): FeatureGateDecision {
    return 'allow'
  }
}

export const defaultFeatureGate: IFeatureGate = new AllowAllFeatureGate()
