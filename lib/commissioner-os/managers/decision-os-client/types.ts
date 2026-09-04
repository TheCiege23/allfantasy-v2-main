import type { CommissionerPlatformResponse } from '../../contracts'

/**
 * Manager Intelligence owns behavioral pattern analysis only — never
 * fantasy strategy, player evaluation, or message content. Per the
 * Manager Intelligence blueprint's Privacy & Trust section: no single
 * overall "manager score" exists here — reliability is one specific,
 * labeled trait among several, never a collapsed grade.
 */
export interface ManagerDnaProfile {
  id: string
  managerName: string
  /** A descriptive archetype, never a permanent label — see the blueprint's DNA naming discipline. */
  archetype: string
  /**
   * OPTIONAL because it has no source in the live backend. Tenure is a roster-history fact, not a
   * Decision OS concept, and there is no season-continuity query to reuse. Demo and stub supply it;
   * the live client omits it rather than inventing a number, and the view renders it only when
   * present.
   */
  tenureSeasons?: number
  /**
   * OPTIONAL because a manager can genuinely have no trend: fewer than two behavioral snapshots
   * means there is nothing to compare.
   *
   * ⚠ Absent means UNKNOWN, never 'steady'. A direction and a reliability LEVEL are orthogonal —
   * a manager can be reliably absent — so this must never be back-filled from
   * `engagementReliability`, and a missing trend must never be rendered as a flat one. That
   * substitution is the exact misrepresentation this module refused to make when it had no DNA
   * source at all.
   */
  engagementTrend?: 'rising' | 'steady' | 'declining'
  /**
   * OPTIONAL. The live backend classifies reliability as an ORDINAL LEVEL, not a score; see
   * `engagementReliability`. Demo and stub keep supplying a number, so the view still renders one
   * in preview mode, but the live client does not manufacture a score to fill this field.
   */
  reliabilityScore?: number
  /** The live backend's real reliability classification. Preferred over `reliabilityScore` when present. */
  engagementReliability?: 'reliable' | 'inconsistent' | 'unreliable'
  /** League-continuity risk framing only — never a characterological judgment. */
  riskFlag?: string
  recognition?: string
}

export interface ManagerIntelligenceClient {
  getManagerDirectory(): Promise<CommissionerPlatformResponse<ManagerDnaProfile[]>>
}
