import type {
  ManagerDnaInput,
  ManagerDnaResult,
  ManagerDnaProfile,
  ManagerSignalInput,
  ManagerIdentityLabel,
  DecisionStyle,
  TransactionStyle,
  RiskTendency,
  EngagementReliability,
  ManagerTrait,
  ManagerLeagueContextInput,
  DetectedPatternInput,
  PatternConfidenceInput,
} from './types'

export const MANAGER_DNA_VERSION = '6.2.0'

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_CONFIDENCE = 0.50
const TRADE_SEEKER_THRESHOLD = 0.40
const MIN_COMPLETENESS = 20
const TRANSACTION_ACTIVE_RATE = 0.15  // per-week threshold to be "active"

// ── Helpers ───────────────────────────────────────────────────────────────────

function findPattern(
  patterns: DetectedPatternInput[],
  type: string,
): DetectedPatternInput | undefined {
  return patterns.find((p) => p.patternType === type)
}

function patternScore(
  pattern: DetectedPatternInput | undefined,
  high: number,
  med: number,
  low: number,
): number {
  if (!pattern) return 0
  if (pattern.confidence === 'high') return high
  if (pattern.confidence === 'medium') return med
  return low
}

// ── Classifiers (priority 1–8) ────────────────────────────────────────────────

function scoreGhostManager(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): number {
  let score = patternScore(findPattern(patterns, 'manager_inactivity_window'), 0.65, 0.50, 0.30)
  if (signals?.engagementTier === 'dormant') score += 0.15
  else if (signals?.engagementTier === 'passive') score += 0.05
  return Math.min(1, score)
}

function scoreSetAndForget(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): number {
  if (!findPattern(patterns, 'conservative_roster_pattern')) return 0
  let score = patternScore(findPattern(patterns, 'conservative_roster_pattern'), 0.52, 0.35, 0.20)
  if (signals) {
    if (signals.activityRates.waiverClaimsPerWeek < 0.25) score += 0.20
    if (signals.activityRates.tradeProposalsPerWeek < 0.10) score += 0.15
    if (signals.engagementTier === 'passive' || signals.engagementTier === 'dormant') score += 0.10
  }
  return Math.min(1, score)
}

function scoreReactiveManager(
  patterns: DetectedPatternInput[],
  _signals: ManagerSignalInput | undefined,
): number {
  const overreaction = findPattern(patterns, 'matchup_overreaction')
  const benchRegret = findPattern(patterns, 'bench_regret_repetition')
  if (!overreaction && !benchRegret) return 0
  let score = 0
  score += patternScore(overreaction, 0.40, 0.30, 0.20)
  score += patternScore(benchRegret, 0.35, 0.25, 0.15)
  if (findPattern(patterns, 'repeated_lineup_indecision')) score += 0.10
  return Math.min(1, score)
}

function scoreIndecisiveTinkerer(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): number {
  const indecision = findPattern(patterns, 'repeated_lineup_indecision')
  const benchRegret = findPattern(patterns, 'bench_regret_repetition')
  if (!indecision && !benchRegret) return 0
  let score = 0
  score += patternScore(indecision, 0.52, 0.30, 0.20)
  score += patternScore(benchRegret, 0.30, 0.20, 0.10)
  if (signals && signals.activityRates.lineupEditsPerWeek > 2.0) score += 0.10
  return Math.min(1, score)
}

function scoreSerialTrader(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): number {
  const spike = findPattern(patterns, 'trade_proposal_spike')
  if (!spike) return 0
  let score = patternScore(spike, 0.55, 0.38, 0.25)
  if (signals) {
    if (signals.activityRates.tradeProposalsPerWeek > 0.5) score += 0.20
    else if (signals.activityRates.tradeProposalsPerWeek > 0.25) score += 0.10
  }
  return Math.min(1, score)
}

function scoreWaiverHawk(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): number {
  const streak = findPattern(patterns, 'waiver_aggression_streak')
  if (!streak) return 0
  let score = patternScore(streak, 0.55, 0.38, 0.25)
  if (signals) {
    if (signals.activityRates.waiverClaimsPerWeek > 1.0) score += 0.20
    else if (signals.activityRates.waiverClaimsPerWeek > 0.5) score += 0.10
  }
  return Math.min(1, score)
}

function scoreTradeSeeker(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): number {
  let score = 0
  if (signals) {
    if (signals.activityRates.tradeProposalsPerWeek > 0.25) score += 0.30
    else if (signals.activityRates.tradeProposalsPerWeek > 0.10) score += 0.15
  }
  if (findPattern(patterns, 'trade_rejection_pattern')) score += 0.15
  return Math.min(1, score)
}

function scoreCommittedGrinder(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): number {
  if (!signals) return 0
  let score = 0
  if (signals.engagementTier === 'elite') score += 0.50
  else if (signals.engagementTier === 'active') score += 0.35
  else if (signals.engagementTier === 'moderate') score += 0.20
  if (!findPattern(patterns, 'manager_inactivity_window')) score += 0.10
  if (!findPattern(patterns, 'matchup_overreaction')) score += 0.05
  if (!findPattern(patterns, 'conservative_roster_pattern')) score += 0.05
  return Math.min(1, score)
}

type Classifier = [
  label: ManagerIdentityLabel,
  scorer: (p: DetectedPatternInput[], s: ManagerSignalInput | undefined) => number,
  threshold: number,
]

const CLASSIFIERS: Classifier[] = [
  ['ghost_manager',       scoreGhostManager,       MIN_CONFIDENCE],
  ['set_and_forget',      scoreSetAndForget,        MIN_CONFIDENCE],
  ['reactive_manager',    scoreReactiveManager,     MIN_CONFIDENCE],
  ['indecisive_tinkerer', scoreIndecisiveTinkerer,  MIN_CONFIDENCE],
  ['serial_trader',       scoreSerialTrader,        MIN_CONFIDENCE],
  ['waiver_hawk',         scoreWaiverHawk,          MIN_CONFIDENCE],
  ['trade_seeker',        scoreTradeSeeker,         TRADE_SEEKER_THRESHOLD],
  ['committed_grinder',   scoreCommittedGrinder,    MIN_CONFIDENCE],
]

function classifyIdentity(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): { label: ManagerIdentityLabel; confidence: number; derivation: string[] } {
  const derivation: string[] = []
  for (const [label, scorer, threshold] of CLASSIFIERS) {
    const score = scorer(patterns, signals)
    const selected = score >= threshold
    derivation.push(
      `${label}: score=${score.toFixed(3)}, threshold=${threshold}${selected ? ' → SELECTED' : ''}`,
    )
    if (selected) return { label, confidence: Math.min(1, score), derivation }
  }
  return {
    label: 'unknown',
    confidence: 0,
    derivation: [...derivation, 'unknown: no classifier reached threshold'],
  }
}

// ── Dimension derivers ────────────────────────────────────────────────────────

function deriveDecisionStyle(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): DecisionStyle {
  if (
    findPattern(patterns, 'repeated_lineup_indecision') ||
    findPattern(patterns, 'bench_regret_repetition')
  ) return 'indecisive'
  if (findPattern(patterns, 'matchup_overreaction')) return 'reactive'
  if (signals && signals.activityRates.lineupEditsPerWeek < 0.5) return 'decisive'
  return 'methodical'
}

function deriveTransactionStyle(signals: ManagerSignalInput | undefined): TransactionStyle {
  if (!signals) return 'passive'
  const { tradeProposalsPerWeek, waiverClaimsPerWeek } = signals.activityRates
  const tradeActive = tradeProposalsPerWeek > TRANSACTION_ACTIVE_RATE
  const waiverActive = waiverClaimsPerWeek > TRANSACTION_ACTIVE_RATE
  if (tradeActive && waiverActive) {
    if (tradeProposalsPerWeek > 2 * waiverClaimsPerWeek) return 'trade_dominant'
    if (waiverClaimsPerWeek > 2 * tradeProposalsPerWeek) return 'waiver_dominant'
    return 'balanced'
  }
  if (tradeActive) return 'trade_dominant'
  if (waiverActive) return 'waiver_dominant'
  return 'passive'
}

function deriveRiskTendency(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): RiskTendency {
  if (
    findPattern(patterns, 'waiver_aggression_streak') ||
    findPattern(patterns, 'trade_proposal_spike')
  ) return 'risk_taking'
  if (findPattern(patterns, 'conservative_roster_pattern')) return 'risk_averse'
  if (signals) {
    const { waiverClaimsPerWeek, tradeProposalsPerWeek } = signals.activityRates
    if (waiverClaimsPerWeek > 0.5 || tradeProposalsPerWeek > 0.3) return 'risk_taking'
    if (
      waiverClaimsPerWeek < 0.1 &&
      tradeProposalsPerWeek < 0.1 &&
      signals.engagementTier !== 'elite' &&
      signals.engagementTier !== 'active'
    ) return 'risk_averse'
  }
  return 'neutral'
}

function deriveEngagementReliability(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): EngagementReliability {
  const inactivity = findPattern(patterns, 'manager_inactivity_window')
  if (inactivity) {
    return inactivity.confidence === 'high' ? 'unreliable' : 'inconsistent'
  }
  if (signals?.engagementTier === 'dormant') return 'unreliable'
  if (signals?.engagementTier === 'passive') return 'inconsistent'
  return 'reliable'
}

// ── Trait extraction ──────────────────────────────────────────────────────────

function confidenceToStrength(c: PatternConfidenceInput): 'strong' | 'moderate' | 'weak' {
  if (c === 'high') return 'strong'
  if (c === 'medium') return 'moderate'
  return 'weak'
}

function extractTraits(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
): ManagerTrait[] {
  const traits: ManagerTrait[] = []

  const pushTrait = (
    patternType: string,
    trait: string,
    evidenceFn: (p: DetectedPatternInput) => string,
  ) => {
    const p = findPattern(patterns, patternType)
    if (!p) return
    traits.push({
      trait,
      strength: confidenceToStrength(p.confidence),
      evidence: [evidenceFn(p)],
    })
  }

  pushTrait(
    'bench_regret_repetition',
    'bench_second_guesser',
    (p) => `${p.occurrenceCount} player(s) repeatedly flip-flopped between bench and starter`,
  )
  pushTrait(
    'waiver_aggression_streak',
    'waiver_wire_aggressor',
    (p) => `${p.occurrenceCount} waiver aggression window(s) detected`,
  )
  pushTrait(
    'trade_proposal_spike',
    'active_trade_initiator',
    (p) => `${p.occurrenceCount} trade proposal spike(s) detected`,
  )
  pushTrait(
    'conservative_roster_pattern',
    'set_and_forget_tendency',
    (p) => `${p.occurrenceCount} streak(s) of consecutive zero-change weeks`,
  )
  pushTrait(
    'matchup_overreaction',
    'matchup_overreactor',
    (p) => `${p.occurrenceCount} streak(s) of consecutive high-change weeks`,
  )
  pushTrait(
    'repeated_lineup_indecision',
    'lineup_tinkerer',
    (p) => `${p.occurrenceCount} week(s) with 3+ lineup saves`,
  )
  pushTrait(
    'trade_rejection_pattern',
    'persistent_trade_negotiator',
    (p) => `${p.occurrenceCount} window(s) with repeated trade rejections`,
  )
  pushTrait(
    'manager_inactivity_window',
    'sporadic_engager',
    (p) => `Inactivity gap: ${p.evidenceWindows[0]?.durationDays ?? '?'} days`,
  )

  const injDelay = findPattern(patterns, 'injury_response_delay')
  if (injDelay) {
    traits.push({
      trait: 'slow_injury_responder',
      strength: confidenceToStrength(injDelay.confidence),
      evidence: [
        `${injDelay.occurrenceCount} instance(s) of delayed injury response (proxy detection)`,
      ],
    })
  }

  // Signal-derived trait: no pattern evidence but strong consistent engagement
  if (patterns.length === 0 && signals) {
    if (signals.engagementTier === 'elite' || signals.engagementTier === 'active') {
      traits.push({
        trait: 'consistent_performer',
        strength: signals.engagementTier === 'elite' ? 'strong' : 'moderate',
        evidence: [`Engagement tier: ${signals.engagementTier}, no negative patterns detected`],
      })
    }
  }

  return traits
}

// ── Completeness ──────────────────────────────────────────────────────────────

function computeProfileCompleteness(
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
  leagueContext: ManagerLeagueContextInput | undefined,
): number {
  if (!signals && patterns.length === 0) return 5

  let score = signals ? 100 : 30
  if (signals && signals.completeness < 50) {
    score -= Math.round((50 - signals.completeness) * 0.5)
  }
  if (patterns.length === 0) score -= 20
  if (!leagueContext) score -= 5

  return Math.min(100, Math.max(0, score))
}

// ── Conflict detection ────────────────────────────────────────────────────────

function detectConflicts(patterns: DetectedPatternInput[], warnings: string[]): void {
  const hasConservative = !!findPattern(patterns, 'conservative_roster_pattern')
  const hasTradeSpike = !!findPattern(patterns, 'trade_proposal_spike')
  const hasWaiverAggression = !!findPattern(patterns, 'waiver_aggression_streak')

  if (hasConservative && hasTradeSpike) {
    warnings.push(
      'conflicting_signals: conservative roster pattern alongside trade spike — set_and_forget may understate trade activity',
    )
  }
  if (hasConservative && hasWaiverAggression) {
    warnings.push(
      'conflicting_signals: conservative roster pattern alongside waiver aggression — player acquisition method differs from lineup management style',
    )
  }
}

// ── Per-manager profile assembler ─────────────────────────────────────────────

function assembleProfile(
  managerId: string,
  leagueId: string,
  patterns: DetectedPatternInput[],
  signals: ManagerSignalInput | undefined,
  leagueContext: ManagerLeagueContextInput | undefined,
): ManagerDnaProfile {
  const warnings: string[] = []
  const completeness = computeProfileCompleteness(patterns, signals, leagueContext)

  if (completeness < MIN_COMPLETENESS) {
    return {
      managerId,
      leagueId,
      primaryIdentity: 'unknown',
      confidence: 0,
      decisionStyle: 'methodical',
      transactionStyle: 'passive',
      riskTendency: 'neutral',
      engagementReliability: 'reliable',
      traits: [],
      derivation: [`completeness=${completeness} < ${MIN_COMPLETENESS} — insufficient data`],
      warnings: ['insufficient_data: completeness below minimum threshold'],
      completeness,
    }
  }

  if (!signals) warnings.push('missing_aggregate_signals: identity derived from patterns only')
  if (patterns.length === 0) warnings.push('no_patterns_detected: identity derived from aggregate signals only')

  detectConflicts(patterns, warnings)

  const { label, confidence, derivation } = classifyIdentity(patterns, signals)
  const decisionStyle = deriveDecisionStyle(patterns, signals)
  const transactionStyle = deriveTransactionStyle(signals)
  const riskTendency = deriveRiskTendency(patterns, signals)
  const engagementReliability = deriveEngagementReliability(patterns, signals)
  const traits = extractTraits(patterns, signals)

  if (leagueContext) {
    derivation.push(
      `league context: archetype=${leagueContext.leagueArchetype}, engagement_percentile=${leagueContext.leagueEngagementPercentile}`,
    )
  }

  return {
    managerId,
    leagueId,
    primaryIdentity: label,
    confidence,
    decisionStyle,
    transactionStyle,
    riskTendency,
    engagementReliability,
    traits,
    derivation,
    warnings,
    completeness,
  }
}

// ── Main assembler ────────────────────────────────────────────────────────────

export function assembleManagerDna(input: ManagerDnaInput): ManagerDnaResult {
  const { leagueId } = input
  const warnings: string[] = []

  const managerIds = new Set<string>()
  for (const pg of input.managerPatterns) managerIds.add(pg.managerId)
  for (const ms of input.managerSignals) managerIds.add(ms.managerId)

  const patternsByManager = new Map<string, DetectedPatternInput[]>()
  for (const pg of input.managerPatterns) {
    patternsByManager.set(pg.managerId, pg.patterns)
  }

  const signalsByManager = new Map<string, ManagerSignalInput>()
  for (const ms of input.managerSignals) {
    signalsByManager.set(ms.managerId, ms)
  }

  const sortedIds = [...managerIds].sort()
  const profiles = sortedIds.map((managerId) =>
    assembleProfile(
      managerId,
      leagueId,
      patternsByManager.get(managerId) ?? [],
      signalsByManager.get(managerId),
      input.leagueContext,
    ),
  )

  if (managerIds.size === 0) {
    warnings.push('no_managers: no manager patterns or signals provided')
  }

  const profiledManagers = profiles.filter((p) => p.primaryIdentity !== 'unknown').length
  const insufficientDataManagers = profiles.filter((p) => p.primaryIdentity === 'unknown').length

  return {
    leagueId,
    profiles,
    totalManagersAnalyzed: managerIds.size,
    profiledManagers,
    insufficientDataManagers,
    warnings,
    version: MANAGER_DNA_VERSION,
  }
}
