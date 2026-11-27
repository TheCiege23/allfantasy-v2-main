import { FeatureGateService } from '@/lib/subscription/FeatureGateService'

/**
 * Whether a league's COMMISSIONER (`League.userId`) holds the plan that unlocks AF's keeper automation
 * for the whole league — automatic board placement (./keeperAutoBoard) and the player card's keeper
 * line (./keeperCardCost). AF Commissioner, or AF Supreme (which includes it): feature
 * `commissioner_automation`, the same key the other AF Commissioner keeper rules use (./keeperRuleGate).
 */
export async function commissionerHasKeeperAutomation(commissionerUserId: string | null | undefined): Promise<boolean> {
  if (!commissionerUserId) return false
  const access = await new FeatureGateService().evaluateUserFeatureAccess(commissionerUserId, 'commissioner_automation').catch(() => null)
  return access?.allowed === true
}
