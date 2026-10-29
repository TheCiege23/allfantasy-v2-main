/**
 * Does a league's commissioner hold AF Commissioner, for the rookie-draft auto-open default?
 *
 * The same feature the live rookie order is gated on (`commissioner_automation`, required plan
 * `commissioner`), so the two offseason automations unlock together. Fails closed: an entitlement
 * lookup that throws reads as "no plan", which leaves auto-open off — the pre-plan behaviour.
 */
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'

export const ROOKIE_DRAFT_AUTO_OPEN_FEATURE = 'commissioner_automation' as const

export async function commissionerHasRookieDraftAutoOpenPlan(commissionerUserId: string | null | undefined): Promise<boolean> {
  if (!commissionerUserId) return false
  try {
    const decision = await new FeatureGateService().evaluateUserFeatureAccess(commissionerUserId, ROOKIE_DRAFT_AUTO_OPEN_FEATURE)
    return decision.allowed
  } catch (error) {
    console.warn('[rookie-draft-calendar] plan lookup failed; treating as no plan', { error: String(error) })
    return false
  }
}
