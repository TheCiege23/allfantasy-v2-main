import type { CommissionerModuleId } from './navigation'
import type { SeverityTier } from '../tokens/colors'
import type { CommissionerConfidenceLevel } from './metadata'

/**
 * The canonical recommendation shape, per Recommendations Center's own
 * "one owner, many consumers" rule — Mission Control, League Health, and
 * Recommendations Center all reference this same type rather than each
 * defining their own ad hoc recommendation shape (which is what Mission
 * Control did in Phase 1.0, before this contract existed).
 */
export type CommissionerRecommendationStatus =
  | 'new'
  | 'viewed'
  | 'in_progress'
  | 'completed'
  | 'dismissed'
  | 'expired'
  | 'automated'
  | 'deferred'
  | 'resolved'

export type CommissionerRecommendationCategory =
  | 'health_and_risk'
  | 'engagement'
  | 'competitive_integrity'
  | 'automation_opportunity'
  | 'administrative'

export interface CommissionerRecommendationContract {
  id: string
  title: string
  rationale: string
  severity: SeverityTier
  confidence: CommissionerConfidenceLevel
  expectedImpact: string
  primaryActionLabel: string
  status: CommissionerRecommendationStatus
  category: CommissionerRecommendationCategory
  sourceModuleId: CommissionerModuleId
  createdAt: string
}
