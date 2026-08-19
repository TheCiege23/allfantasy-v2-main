/**
 * Phase 6.2 — Manager DNA / Identity Layer types.
 *
 * Input types are Phase 6.2-local structural definitions compatible with:
 *   - Phase 6.1 BehavioralPatternResult.managerPatterns (ManagerPatternGroupInput)
 *   - Phase 5.2 ManagerBehavioralIntelligence (ManagerSignalInput)
 *   - Phase 6.3 LeagueArchetypeResult + Phase 6.5 LeagueBenchmarkResult (ManagerLeagueContextInput)
 *
 * No imports from Phase 6.1, 6.3, or 6.5 type files — cross-sub-phase boundary independence.
 */

// ── Input: Phase 6.1 pattern data (structural mirror) ────────────────────────

export type PatternConfidenceInput = 'high' | 'medium' | 'low'

export interface EvidenceWindowInput {
  startedAt: string
  endedAt: string
  durationDays: number
  eventIds: string[]
  summary: string
}

export interface DetectedPatternInput {
  patternType: string
  confidence: PatternConfidenceInput
  occurrenceCount: number
  firstDetectedAt: string
  lastDetectedAt: string
  evidenceWindows: EvidenceWindowInput[]
  derivation: string[]
  warnings: string[]
}

export interface ManagerPatternGroupInput {
  managerId: string
  patterns: DetectedPatternInput[]
}

// ── Input: Phase 5.2 aggregate manager signals ────────────────────────────────

export type ManagerEngagementTier = 'elite' | 'active' | 'moderate' | 'passive' | 'dormant'

export interface ManagerActivityRatesInput {
  lineupEditsPerWeek: number
  waiverClaimsPerWeek: number
  tradeProposalsPerWeek: number
  loginSessionsPerWeek: number
}

/** Per-manager aggregate signals. Structurally compatible with Phase 5.2 output. */
export interface ManagerSignalInput {
  managerId: string
  /** 0–100 composite engagement score. */
  engagementScore: number
  engagementTier: ManagerEngagementTier
  activityRates: ManagerActivityRatesInput
  /** Data quality score 0–100 from Phase 5.2. */
  completeness: number
}

// ── Input: league-level context (from Phase 6.3 + 6.5) ───────────────────────

/** Optional league-level context for profile calibration. Does not duplicate 6.3/6.5 outputs. */
export interface ManagerLeagueContextInput {
  leagueId: string
  /** Phase 6.3 archetype label for this manager's league. */
  leagueArchetype: string
  /** Phase 6.5 engagement dimension percentile for this league (0–100). */
  leagueEngagementPercentile: number
}

// ── Main input ────────────────────────────────────────────────────────────────

export interface ManagerDnaInput {
  leagueId: string
  /** Per-manager behavioral patterns from Phase 6.1. Partial coverage is allowed. */
  managerPatterns: ManagerPatternGroupInput[]
  /** Per-manager aggregate signals. Partial coverage is allowed. */
  managerSignals: ManagerSignalInput[]
  /** Optional: league-level context from Phase 6.3/6.5. */
  leagueContext?: ManagerLeagueContextInput
}

// ── Output: identity dimensions ───────────────────────────────────────────────

/**
 * Primary identity classification for a manager. Priority-ordered pipeline;
 * 'unknown' when data is insufficient or no classifier reaches threshold.
 */
export type ManagerIdentityLabel =
  | 'ghost_manager'        // inactivity dominant or dormant engagement
  | 'set_and_forget'       // conservative roster + low transaction activity
  | 'reactive_manager'     // overreaction + bench regret combination
  | 'indecisive_tinkerer'  // repeated lineup indecision or bench flip-flopping
  | 'serial_trader'        // trade spike pattern
  | 'waiver_hawk'          // waiver aggression streak
  | 'trade_seeker'         // moderate trade rate, no spike (lower threshold)
  | 'committed_grinder'    // high engagement, no negative patterns
  | 'unknown'              // insufficient data or no dominant pattern

/** How the manager makes roster decisions. */
export type DecisionStyle =
  | 'decisive'     // few edits, quick final decisions
  | 'indecisive'   // multiple saves per week, bench flip-flopping
  | 'reactive'     // changes frequently after matchup results
  | 'methodical'   // consistent cadence, no overreaction

/** Whether the manager favors trades, waivers, both, or neither. */
export type TransactionStyle =
  | 'trade_dominant'   // trade rate > 2× waiver rate
  | 'waiver_dominant'  // waiver rate > 2× trade rate
  | 'balanced'         // both above minimal threshold and neither dominates
  | 'passive'          // both below minimal threshold

/** Risk appetite for roster changes. */
export type RiskTendency =
  | 'risk_taking'   // aggressive waiver + trade behavior
  | 'risk_averse'   // conservative, avoids roster turnover
  | 'neutral'       // balanced risk profile

/** Consistency of participation over the season. */
export type EngagementReliability =
  | 'reliable'       // consistent, no inactivity windows
  | 'inconsistent'   // some inactivity periods detected
  | 'unreliable'     // major inactivity or ghost behavior

// ── Output: traits ────────────────────────────────────────────────────────────

export interface ManagerTrait {
  /** Canonical trait name (e.g. 'bench_second_guesser', 'waiver_wire_aggressor'). */
  trait: string
  /** How strongly the evidence supports this trait. */
  strength: 'strong' | 'moderate' | 'weak'
  /** The patterns and signals that support this trait. */
  evidence: string[]
}

// ── Output: profile + result ──────────────────────────────────────────────────

export interface ManagerDnaProfile {
  managerId: string
  leagueId: string
  /** Primary identity classification. 'unknown' when data is insufficient. */
  primaryIdentity: ManagerIdentityLabel
  /** Classification confidence 0–1. Always 0 for 'unknown'. */
  confidence: number
  /** How this manager makes roster decisions. */
  decisionStyle: DecisionStyle
  /** Whether they trade or use waivers more. */
  transactionStyle: TransactionStyle
  /** Their appetite for roster risk. */
  riskTendency: RiskTendency
  /** How reliably they engage with the league. */
  engagementReliability: EngagementReliability
  /** Behavioral traits derived from detected patterns and aggregate signals. */
  traits: ManagerTrait[]
  /** Step-by-step derivation: classifiers evaluated, scores, threshold comparisons. */
  derivation: string[]
  /** Profile-specific warnings (conflicting signals, missing data, proxy detections). */
  warnings: string[]
  /** Input data quality score 0–100 for this profile. */
  completeness: number
}

export interface ManagerDnaResult {
  leagueId: string
  /** Per-manager profiles sorted by managerId ascending for stable ordering. */
  profiles: ManagerDnaProfile[]
  /** Total unique managers analyzed (union of pattern and signal sources). */
  totalManagersAnalyzed: number
  /** Managers with a non-'unknown' primaryIdentity. */
  profiledManagers: number
  /** Managers whose data was insufficient (identity = 'unknown'). */
  insufficientDataManagers: number
  warnings: string[]
  /** Assembly logic version — '6.2.0'. */
  version: string
}
