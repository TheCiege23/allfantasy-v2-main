/**
 * Decision OS — Phase 6.3 League Archetype types.
 *
 * Pure types only — no runtime logic, no imports from Phase 5 internals.
 * Input interface is structurally compatible with Phase 5.3 LeagueBehavioralIntelligence
 * but defined independently so Phase 6 remains testable without Phase 5 internals.
 */

// ── Input types (structurally mirrors Phase 5.3) ─────────────────────────────

export type LeagueEngagementTierInput = 'elite' | 'active' | 'moderate' | 'passive' | 'dormant'
export type ActivityTierInput         = 'high'  | 'moderate' | 'low' | 'none'
export type RetentionRiskInput        = 'low'   | 'medium'   | 'high' | 'critical'
export type CommissionerWorkloadInput = 'light' | 'moderate' | 'heavy' | 'critical'

export interface LeagueActivitySignalInput {
  tier:           ActivityTierInput
  /** Events per manager in the lookback window. */
  perManagerRate: number
}

export interface LeagueParticipationInput {
  totalManagers:    number
  activeManagers:   number
  inactiveManagers: number
  /** 0–100. */
  activePercent:    number
  /** 0–100. */
  inactivePercent:  number
}

/**
 * Input contract for the Phase 6.3 archetype classifier.
 *
 * Pass a `LeagueBehavioralIntelligence` object directly — it satisfies this interface.
 * Phase 6.3 consumes only these fields; extra fields on the Phase 5.3 type are ignored.
 */
export interface LeagueArchetypeInput {
  /** Composite engagement score 0–100. */
  leagueEngagementScore:     number
  leagueEngagementTier:      LeagueEngagementTierInput
  participationDistribution: LeagueParticipationInput
  tradeActivity:             LeagueActivitySignalInput
  waiverActivity:            LeagueActivitySignalInput
  draftActivity:             LeagueActivitySignalInput
  retentionRisk:             RetentionRiskInput
  commissionerWorkload:      CommissionerWorkloadInput
  /** Data quality score 0–100 inherited from Phase 5.3. Below 20 → 'unknown'. */
  completeness:              number
}

// ── Output types ─────────────────────────────────────────────────────────────

export type LeagueArchetypeLabel =
  | 'highly_engaged'
  | 'casual_social'
  | 'commissioner_driven'
  | 'competitive_balanced'
  | 'high_churn_risk'
  | 'low_engagement'
  | 'trade_heavy'
  | 'waiver_active'
  | 'inactive_or_stale'
  | 'unknown'

export interface ArchetypeDerivationStep {
  /** Phase 5 signal path, e.g. "tradeActivity.tier" */
  signal:       string
  /** Observed value of the signal at classification time */
  value:        unknown
  /** How this signal contributed to (or did not support) the selected archetype */
  contribution: string
}

export interface ArchetypeSignalCoverage {
  /** Signal paths that were evaluated (completeness > 0) */
  available: string[]
  /** Signal paths that would improve accuracy but require Phase 6.1+ enrichment */
  missing:   string[]
}

export interface LeagueArchetypeResult {
  /** The determined archetype label. 'unknown' when confidence < 0.50 or data is sparse. */
  archetype:      LeagueArchetypeLabel
  /** Classification confidence 0–1. Always 0 for 'unknown'. */
  confidence:     number
  /** Human-readable reasons supporting the classification. Empty for 'unknown'. */
  reasons:        string[]
  signalCoverage: ArchetypeSignalCoverage
  /**
   * Full derivation chain showing every signal evaluated, whether it supported
   * or was neutral to the selected archetype.
   */
  derivation:     ArchetypeDerivationStep[]
  /** Classifier version string. Stable for identical logic. Format: "6.{minor}.{patch}" */
  version:        string
}
