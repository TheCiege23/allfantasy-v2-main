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

/**
 * 🛑 FOUR FIELDS ARE OPTIONAL BECAUSE THE BACKEND DOES NOT HAVE THEM, AND REQUIRING THEM COST US
 * THE WHOLE MODULE. `recommendations/live.ts` made its real call, received real recommendations,
 * and then **threw them away** — returning an honest "backend does not expose this" error —
 * because it could not fill `confidence`, `expectedImpact`, `primaryActionLabel` and `status`.
 * That was the correct call given a contract that demanded them; the contract was the problem.
 *
 * The behavioural pipeline emits `{recommendationId, priority, category, signal, message}`. That
 * is a complete, useful recommendation — what is wrong and why — and it was being discarded to
 * protect four fields nothing computes. Optional here means "omitted when unknown", never
 * "defaulted": a fabricated `confidence: 'high'` on a recommendation nothing scored would be a
 * confidence signal invented by the presentation layer, which is the failure this whole module
 * has avoided from the start.
 *
 * `status` in particular has no analog anywhere and is not merely unported: recommendations are
 * recomputed fresh from the current event window on every request, so there is no persisted
 * lifecycle for a status to describe. It becomes real when something persists one.
 */
export interface CommissionerRecommendationContract {
  id: string
  title: string
  rationale: string
  severity: SeverityTier
  /** Absent when nothing scored this recommendation's confidence. Never defaulted. */
  confidence?: CommissionerConfidenceLevel
  /** Absent when no impact estimate exists upstream. */
  expectedImpact?: string
  /** Absent when the backend names no specific action. */
  primaryActionLabel?: string
  /** Absent until something persists a recommendation lifecycle. */
  status?: CommissionerRecommendationStatus
  category: CommissionerRecommendationCategory
  sourceModuleId: CommissionerModuleId
  createdAt: string
}
