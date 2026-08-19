import type {
  Recommendation,
  RecommendationSet,
  RecommendationPriority,
  RecommendationSeverity,
  RecommendationConfidence,
  RecommendationCategory,
  RecommendedAction,
  ManagerRecommendationInput,
  CommissionerRecommendationInput,
  PlatformRecommendationInput,
  RecommendationEngineInput,
  RecommendationEngineResult,
  DetectedPatternSlice,
} from './types'

export const RECOMMENDATION_VERSION = '6.4.0'

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
}
const SEVERITY_ORDER: Record<RecommendationSeverity, number> = {
  urgent: 4, elevated: 3, standard: 2, advisory: 1,
}

// Commissioner thresholds
const TRADE_CRITICAL_PERCENTILE = 10
const TRADE_HIGH_PERCENTILE = 25
const WAIVER_HIGH_PERCENTILE = 25
const ENGAGEMENT_LOW_PERCENTILE = 30
const ENGAGEMENT_RECAP_PERCENTILE = 40

// Platform thresholds
const CHURN_CRITICAL_FRACTION = 0.40
const CHURN_HIGH_FRACTION = 0.20
const LOW_ENGAGEMENT_HIGH_FRACTION = 0.50
const LOW_ENGAGEMENT_MEDIUM_FRACTION = 0.30
const INACTIVE_LEAGUE_HIGH_FRACTION = 0.40
const INACTIVE_LEAGUE_MEDIUM_FRACTION = 0.25
const INACTIVE_ARCHETYPE_HIGH_FRACTION = 0.30
const INACTIVE_ARCHETYPE_MEDIUM_FRACTION = 0.20

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId(tier: string, category: string, entityId: string): string {
  return `rec_${tier}_${category}_${entityId}`.replace(/[^a-z0-9_]/gi, '_')
}

function findPattern(
  patterns: DetectedPatternSlice[] | undefined,
  type: string,
): DetectedPatternSlice | undefined {
  return patterns?.find((p) => p.patternType === type)
}

function toConfidence(patternConf: string): RecommendationConfidence {
  if (patternConf === 'high') return 'high'
  if (patternConf === 'medium') return 'medium'
  return 'low'
}

function sortRecommendations(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => {
    const pd = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]
    if (pd !== 0) return pd
    const sd = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
    if (sd !== 0) return sd
    const cd = a.category.localeCompare(b.category)
    if (cd !== 0) return cd
    return a.id.localeCompare(b.id)
  })
}

function makeSet(
  entityId: string,
  tier: RecommendationSet['tier'],
  recs: Array<Recommendation | null>,
  warnings: string[],
): RecommendationSet {
  const valid = recs.filter((r): r is Recommendation => r !== null)
  const sorted = sortRecommendations(valid)
  return {
    entityId,
    tier,
    recommendations: sorted,
    totalRecommendations: sorted.length,
    criticalCount: sorted.filter((r) => r.priority === 'critical').length,
    warnings,
    version: RECOMMENDATION_VERSION,
  }
}

// ── Manager recommendation generators ────────────────────────────────────────

function buildEngagementBoost(input: ManagerRecommendationInput): Recommendation | null {
  const inactivity = findPattern(input.patterns, 'manager_inactivity_window')
  const isGhost = input.identity?.primaryIdentity === 'ghost_manager'
  const isUnreliable = input.identity?.engagementReliability === 'unreliable'
  const isInconsistent = input.identity?.engagementReliability === 'inconsistent'

  if (!inactivity && !isGhost && !isUnreliable && !isInconsistent) return null

  const highSignal = (inactivity?.confidence === 'high') || isGhost
  const priority: RecommendationPriority = highSignal ? 'critical' : (isUnreliable ? 'high' : 'medium')
  const severity: RecommendationSeverity = isGhost ? 'urgent' : (highSignal ? 'elevated' : 'standard')
  const confidence: RecommendationConfidence = inactivity
    ? toConfidence(inactivity.confidence)
    : (isGhost ? 'high' : 'medium')

  const derivation: string[] = []
  if (inactivity) derivation.push(`manager_inactivity_window (${inactivity.confidence}): ${inactivity.occurrenceCount} instance(s)`)
  if (isGhost) derivation.push('primaryIdentity=ghost_manager')
  if (isUnreliable) derivation.push('engagementReliability=unreliable')
  if (isInconsistent) derivation.push('engagementReliability=inconsistent')
  derivation.push(`priority=${priority}, severity=${severity}`)

  const evidence: string[] = []
  if (inactivity) evidence.push(`Inactivity gap detected (${inactivity.confidence} confidence, ${inactivity.occurrenceCount}x)`)
  if (isGhost) evidence.push('Manager classified as ghost_manager by DNA assembler')
  if (isUnreliable && !inactivity) evidence.push('Engagement reliability = unreliable (no explicit gap pattern)')

  return {
    id: makeId('manager', 'engagement_boost', input.managerId),
    tier: 'manager',
    category: 'engagement_boost',
    entityId: input.managerId,
    priority,
    severity,
    confidence,
    affectedDimensions: ['engagement', 'participation', 'roster_management'],
    expectedImpact: 'Improved lineup setting, waiver participation, and seasonal roster performance',
    derivation,
    evidence,
    benchmarkComparison: input.leagueBenchmark
      ? `League at ${input.leagueBenchmark.engagement.percentile}th percentile engagement platform-wide`
      : null,
    prerequisites: ['Manager must have an active league roster'],
    recommendedActions: [
      { action: 'Enable weekly lineup reminder notifications', rationale: 'Reduces missed start/sit decisions' },
      { action: 'Check lineup 48 hours before game day', rationale: 'Allows time for injury adjustment before lock' },
      { action: 'Review waiver wire every Tuesday morning', rationale: 'Waiver claims typically process overnight' },
    ],
    rollbackCriteria: ['Dismiss when engagement_reliability returns to reliable for 3+ consecutive weeks'],
    completeness: input.identity?.completeness ?? 50,
    uncertainty: [
      'Pattern detection depends on event stream completeness',
      ...(inactivity ? ['Absence-based detection — requires other league managers to have been active during gap'] : []),
    ],
  }
}

function buildLineupDiscipline(input: ManagerRecommendationInput): Recommendation | null {
  const indecision = findPattern(input.patterns, 'repeated_lineup_indecision')
  const benchRegret = findPattern(input.patterns, 'bench_regret_repetition')

  const medPlusIndecision = indecision && (indecision.confidence === 'high' || indecision.confidence === 'medium')
  const highBenchRegret = benchRegret?.confidence === 'high'
  const identitySupports = input.identity?.primaryIdentity === 'indecisive_tinkerer'
    || input.identity?.decisionStyle === 'indecisive'

  if (!medPlusIndecision && !highBenchRegret && !identitySupports) return null

  const primary = indecision ?? benchRegret
  const confidence: RecommendationConfidence = primary ? toConfidence(primary.confidence) : 'low'

  const derivation: string[] = []
  if (indecision) derivation.push(`repeated_lineup_indecision (${indecision.confidence}): ${indecision.occurrenceCount}x`)
  if (benchRegret) derivation.push(`bench_regret_repetition (${benchRegret.confidence}): ${benchRegret.occurrenceCount}x`)
  if (identitySupports) derivation.push(`identity/decisionStyle supports indecisive pattern`)

  return {
    id: makeId('manager', 'lineup_discipline', input.managerId),
    tier: 'manager',
    category: 'lineup_discipline',
    entityId: input.managerId,
    priority: 'medium',
    severity: confidence === 'high' ? 'elevated' : 'standard',
    confidence,
    affectedDimensions: ['roster_management', 'lineup_discipline'],
    expectedImpact: 'Fewer last-minute changes, reduced bench regret, more consistent start/sit decisions',
    derivation,
    evidence: [
      ...(indecision ? [`${indecision.occurrenceCount} week(s) with 3+ lineup saves (indecision pattern)`] : []),
      ...(benchRegret ? [`${benchRegret.occurrenceCount} player(s) flip-flopped between bench and starter`] : []),
    ],
    benchmarkComparison: null,
    prerequisites: ['Manager must have at least one flex position in their lineup'],
    recommendedActions: [
      { action: 'Lock lineup decisions 24 hours before kickoff', rationale: 'Prevents impulse changes after partial game data' },
      { action: 'Build a pre-week start/sit shortlist on Tuesdays', rationale: 'Proactive ranking reduces game-day anxiety' },
      { action: 'Commit to bench decisions by Thursday night', rationale: 'Reduces bench regret from late-week changes' },
    ],
    rollbackCriteria: ['Dismiss when no indecision or bench-regret pattern detected for 4+ consecutive weeks'],
    completeness: input.identity?.completeness ?? 60,
    uncertainty: ['Lineup save frequency proxy may reflect platform UX patterns, not true indecision'],
  }
}

function buildTradeCoaching(input: ManagerRecommendationInput): Recommendation | null {
  const rejectionPattern = findPattern(input.patterns, 'trade_rejection_pattern')
  const medPlus = rejectionPattern && (rejectionPattern.confidence === 'high' || rejectionPattern.confidence === 'medium')
  const identitySupports = input.identity?.primaryIdentity === 'trade_seeker'

  if (!medPlus && !identitySupports) return null

  const confidence: RecommendationConfidence = rejectionPattern
    ? toConfidence(rejectionPattern.confidence)
    : 'low'

  return {
    id: makeId('manager', 'trade_coaching', input.managerId),
    tier: 'manager',
    category: 'trade_coaching',
    entityId: input.managerId,
    priority: 'medium',
    severity: 'standard',
    confidence,
    affectedDimensions: ['trade_activity', 'roster_management'],
    expectedImpact: 'Higher trade acceptance rate, more balanced proposals, improved roster construction via trades',
    derivation: [
      ...(rejectionPattern ? [`trade_rejection_pattern (${rejectionPattern.confidence}): ${rejectionPattern.occurrenceCount} window(s)`] : []),
      ...(identitySupports ? ['identity=trade_seeker'] : []),
    ],
    evidence: [
      ...(rejectionPattern ? [`${rejectionPattern.occurrenceCount} window(s) with repeated trade rejections`] : []),
      ...(identitySupports ? ['Manager classified as trade_seeker — moderate trade rate with rejections'] : []),
    ],
    benchmarkComparison: input.leagueBenchmark
      ? `League at ${input.leagueBenchmark.tradeActivity.percentile}th percentile trade activity`
      : null,
    prerequisites: ['Manager must have proposed at least one trade in the last 30 days'],
    recommendedActions: [
      { action: 'Research fair market value before proposing', rationale: 'Reduces one-sided proposals that get rejected' },
      { action: 'Add a value sweetener (pick or depth piece) to stalled offers', rationale: 'Shows good faith and improves acceptance rate' },
      { action: 'Check trade value charts for current buy-low/sell-high opportunities', rationale: 'Leverages market timing for better proposals' },
    ],
    rollbackCriteria: ['Dismiss when no trade_rejection_pattern detected for 30+ days'],
    completeness: input.identity?.completeness ?? 55,
    uncertainty: ['Trade rejection detection requires cross-manager event correlation — completeness depends on all managers having events'],
  }
}

function buildWaiverOpportunity(input: ManagerRecommendationInput): Recommendation | null {
  const isPassive = input.identity?.transactionStyle === 'passive'
  const hasNoWaiverPattern = !findPattern(input.patterns, 'waiver_aggression_streak')
  const hasSignals = !!input.identity

  if (!isPassive || !hasNoWaiverPattern || !hasSignals) return null

  return {
    id: makeId('manager', 'waiver_opportunity', input.managerId),
    tier: 'manager',
    category: 'waiver_opportunity',
    entityId: input.managerId,
    priority: 'low',
    severity: 'advisory',
    confidence: 'medium',
    affectedDimensions: ['waiver_activity', 'roster_management'],
    expectedImpact: 'Improved roster depth and flexibility through targeted waiver wire use',
    derivation: [
      'transactionStyle=passive: both trade and waiver rates below active threshold',
      'No waiver_aggression_streak detected',
    ],
    evidence: ['Manager transaction style classified as passive — below-threshold activity on both waivers and trades'],
    benchmarkComparison: input.leagueBenchmark
      ? `League at ${input.leagueBenchmark.waiverActivity.percentile}th percentile waiver activity`
      : null,
    prerequisites: ['League must use waiver wire (not free-agent system)'],
    recommendedActions: [
      { action: 'Review available players every Tuesday morning', rationale: 'Waiver claims process weekly — early priority claims are highest value' },
      { action: 'Set waiver priority targets before the weekly deadline', rationale: 'Avoids reactive claims based only on the latest game results' },
      { action: 'Monitor injury reports for pickup opportunities', rationale: 'Streamlining transactions improves roster ceiling' },
    ],
    rollbackCriteria: ['Dismiss when transactionStyle improves to waiver_dominant or balanced'],
    completeness: input.identity?.completeness ?? 50,
    uncertainty: ['Passive transaction style may reflect intentional roster management strategy for deep-bench teams'],
  }
}

function buildLeagueParticipation(input: ManagerRecommendationInput): Recommendation | null {
  const isGhost = input.identity?.primaryIdentity === 'ghost_manager'
  const isSetAndForget = input.identity?.primaryIdentity === 'set_and_forget'

  if (!isGhost && !isSetAndForget) return null

  const priority: RecommendationPriority = isGhost ? 'high' : 'low'
  const severity: RecommendationSeverity = isGhost ? 'elevated' : 'advisory'

  return {
    id: makeId('manager', 'league_participation', input.managerId),
    tier: 'manager',
    category: 'league_participation',
    entityId: input.managerId,
    priority,
    severity,
    confidence: 'medium',
    affectedDimensions: ['engagement', 'participation'],
    expectedImpact: 'Improved league culture, higher commish satisfaction, better seasonal experience',
    derivation: [
      `primaryIdentity=${input.identity?.primaryIdentity}`,
      `priority=${priority}, severity=${severity}`,
    ],
    evidence: [`Manager classified as ${input.identity?.primaryIdentity} — low active participation signals`],
    benchmarkComparison: null,
    prerequisites: ['Manager must be in a league with active messaging/polling features'],
    recommendedActions: [
      { action: 'Respond to commissioner polls and surveys', rationale: 'Signals active membership, improves commissioner experience' },
      { action: 'Comment on matchup results or trade blocks', rationale: 'Increases league engagement culture' },
      ...(isGhost ? [{ action: 'Set up push notifications for lineup lock reminders', rationale: 'Prevents forfeits from missed lineups' }] : []),
    ],
    rollbackCriteria: ['Dismiss when primaryIdentity transitions to committed_grinder or active classification'],
    completeness: input.identity?.completeness ?? 50,
    uncertainty: ['League participation signals depend on platform social feature availability'],
  }
}

function buildDraftPreparation(input: ManagerRecommendationInput): Recommendation | null {
  const conservativePattern = findPattern(input.patterns, 'conservative_roster_pattern')
  const isSetAndForget = input.identity?.primaryIdentity === 'set_and_forget'

  if (!conservativePattern && !isSetAndForget) return null

  return {
    id: makeId('manager', 'draft_preparation', input.managerId),
    tier: 'manager',
    category: 'draft_preparation',
    entityId: input.managerId,
    priority: 'low',
    severity: 'advisory',
    confidence: conservativePattern ? toConfidence(conservativePattern.confidence) : 'low',
    affectedDimensions: ['roster_management'],
    expectedImpact: 'Better draft positioning, stronger initial roster quality, reduced in-season adjustment burden',
    derivation: [
      ...(conservativePattern ? [`conservative_roster_pattern (${conservativePattern.confidence}): ${conservativePattern.occurrenceCount} streak(s) of zero-change weeks`] : []),
      ...(isSetAndForget ? ['primaryIdentity=set_and_forget'] : []),
    ],
    evidence: [`Manager shows minimal in-season roster activity — draft quality has outsized impact on outcomes`],
    benchmarkComparison: null,
    prerequisites: ['Offseason or pre-draft window must be within 60 days'],
    recommendedActions: [
      { action: 'Study ADP and positional value tiers before the draft', rationale: 'Set-and-forget managers benefit most from a strong draft foundation' },
      { action: 'Prepare a ranked position board for each round', rationale: 'Reduces decision fatigue during live draft' },
      { action: 'Identify 3-4 handcuff running backs to target in late rounds', rationale: 'Provides injury insurance without waiver wire dependency' },
    ],
    rollbackCriteria: ['Archive after draft is complete'],
    completeness: input.identity?.completeness ?? 45,
    uncertainty: ['Draft timing and format may vary — recommendation applies to standard season-long formats'],
  }
}

// ── Commissioner recommendation generators ────────────────────────────────────

function buildRetentionIntervention(input: CommissionerRecommendationInput): Recommendation | null {
  const risk = input.leagueSignals?.retentionRisk
  const archetype = input.archetype?.label
  const isCriticalArchetype = archetype === 'inactive_or_stale'
  const isChurnArchetype = archetype === 'high_churn_risk'
  const isCriticalRisk = risk === 'critical'
  const isHighRisk = risk === 'high'
  const isMedRisk = risk === 'medium'

  if (!isCriticalRisk && !isHighRisk && !isMedRisk && !isCriticalArchetype && !isChurnArchetype) return null

  const priority: RecommendationPriority =
    (isCriticalRisk || isCriticalArchetype) ? 'critical' :
    (isHighRisk || isChurnArchetype) ? 'high' : 'medium'
  const severity: RecommendationSeverity =
    (isCriticalRisk || isCriticalArchetype) ? 'urgent' :
    (isHighRisk || isChurnArchetype) ? 'elevated' : 'standard'

  const derivation: string[] = []
  if (risk) derivation.push(`retentionRisk=${risk}`)
  if (archetype) derivation.push(`archetype=${archetype}`)
  if (input.leagueSignals?.inactiveManagerFraction !== undefined) {
    derivation.push(`inactiveManagerFraction=${(input.leagueSignals.inactiveManagerFraction * 100).toFixed(0)}%`)
  }
  derivation.push(`priority=${priority}`)

  const benchmarkComparison = input.benchmark
    ? `League at ${input.benchmark.retentionSafety.percentile}th percentile retention safety (lower = higher risk)`
    : null

  return {
    id: makeId('commissioner', 'retention_intervention', input.leagueId),
    tier: 'commissioner',
    category: 'retention_intervention',
    entityId: input.leagueId,
    priority,
    severity,
    confidence: risk ? 'high' : 'medium',
    affectedDimensions: ['retention', 'engagement', 'participation'],
    expectedImpact: 'Reduced manager dropout risk, improved season completion rate',
    derivation,
    evidence: [
      ...(risk ? [`Retention risk level: ${risk}`] : []),
      ...(archetype ? [`League archetype: ${archetype}`] : []),
      ...(input.leagueSignals?.inactiveManagerFraction !== undefined
        ? [`${(input.leagueSignals.inactiveManagerFraction * 100).toFixed(0)}% of managers inactive`]
        : []),
    ],
    benchmarkComparison,
    prerequisites: ['Commissioner must have direct messaging access to all managers'],
    recommendedActions: [
      { action: 'Personally message inactive managers to check availability', rationale: 'Direct outreach has highest re-engagement rate' },
      { action: 'Create a mid-season activity challenge with prize stakes', rationale: 'Competitive incentives re-engage passive managers' },
      { action: 'Discuss adding a last-place punishment for next season', rationale: 'Skin-in-the-game mechanics improve season-long retention' },
    ],
    rollbackCriteria: ['Dismiss when retentionRisk drops to low, or all inactive managers have responded'],
    completeness: input.leagueSignals ? 80 : 40,
    uncertainty: [
      'Retention risk is derived from behavioral signals — does not account for external life events',
      ...(isCriticalArchetype ? ['inactive_or_stale archetype may reflect a recently-started league, not true decline'] : []),
    ],
  }
}

function buildTradeActivation(input: CommissionerRecommendationInput): Recommendation | null {
  const tradePercentile = input.benchmark?.tradeActivity.percentile
  const tradeTier = input.leagueSignals?.tradeActivityTier

  const isCritical = (tradePercentile !== undefined && tradePercentile < TRADE_CRITICAL_PERCENTILE)
    || tradeTier === 'none'
  const isHigh = !isCritical && (
    (tradePercentile !== undefined && tradePercentile < TRADE_HIGH_PERCENTILE)
    || tradeTier === 'low'
  )

  if (!isCritical && !isHigh) return null

  const priority: RecommendationPriority = isCritical ? 'high' : 'medium'

  return {
    id: makeId('commissioner', 'trade_activation', input.leagueId),
    tier: 'commissioner',
    category: 'trade_activation',
    entityId: input.leagueId,
    priority,
    severity: isCritical ? 'elevated' : 'standard',
    confidence: tradePercentile !== undefined ? 'high' : 'medium',
    affectedDimensions: ['trade_activity', 'engagement'],
    expectedImpact: 'Increased trade proposals, more engaged roster management, improved competitive balance',
    derivation: [
      ...(tradePercentile !== undefined ? [`benchmark.tradeActivity.percentile=${tradePercentile} (threshold: ${isCritical ? TRADE_CRITICAL_PERCENTILE : TRADE_HIGH_PERCENTILE})`] : []),
      ...(tradeTier ? [`tradeActivityTier=${tradeTier}`] : []),
      `priority=${priority}`,
    ],
    evidence: [
      ...(tradePercentile !== undefined ? [`Trade activity at ${tradePercentile}th percentile platform-wide`] : []),
      ...(tradeTier ? [`Trade tier: ${tradeTier}`] : []),
    ],
    benchmarkComparison: tradePercentile !== undefined
      ? `Trade activity at ${tradePercentile}th percentile vs platform median`
      : null,
    prerequisites: ['League must have trading enabled'],
    recommendedActions: [
      { action: 'Post a trade block/offers thread in league chat', rationale: 'Opens conversation and reduces transaction friction' },
      { action: 'Run a power rankings poll to surface trade motivation', rationale: 'Managers with overranked players are more likely to deal' },
      { action: 'Create a trade deadline event with announcement', rationale: 'Deadline urgency drives trade volume in the final window' },
    ],
    rollbackCriteria: ['Dismiss when tradeActivityTier reaches moderate or benchmark percentile exceeds 35'],
    completeness: tradePercentile !== undefined ? 75 : 50,
    uncertainty: ['Trade activity norms vary significantly by league archetype and sport format'],
  }
}

function buildWaiverActivation(input: CommissionerRecommendationInput): Recommendation | null {
  const waiverPercentile = input.benchmark?.waiverActivity.percentile
  const waiverTier = input.leagueSignals?.waiverActivityTier

  const isLow = (waiverPercentile !== undefined && waiverPercentile < WAIVER_HIGH_PERCENTILE)
    || waiverTier === 'none' || waiverTier === 'low'

  if (!isLow) return null

  return {
    id: makeId('commissioner', 'waiver_activation', input.leagueId),
    tier: 'commissioner',
    category: 'waiver_activation',
    entityId: input.leagueId,
    priority: 'medium',
    severity: 'standard',
    confidence: waiverPercentile !== undefined ? 'high' : 'medium',
    affectedDimensions: ['waiver_activity', 'engagement'],
    expectedImpact: 'More active roster management, healthier competitive balance across the league',
    derivation: [
      ...(waiverPercentile !== undefined ? [`benchmark.waiverActivity.percentile=${waiverPercentile} < ${WAIVER_HIGH_PERCENTILE}`] : []),
      ...(waiverTier ? [`waiverActivityTier=${waiverTier}`] : []),
    ],
    evidence: [
      ...(waiverPercentile !== undefined ? [`Waiver activity at ${waiverPercentile}th percentile platform-wide`] : []),
      ...(waiverTier ? [`Waiver tier: ${waiverTier}`] : []),
    ],
    benchmarkComparison: waiverPercentile !== undefined
      ? `Waiver activity at ${waiverPercentile}th percentile vs platform median`
      : null,
    prerequisites: ['League must use a waiver wire system (not free agent)'],
    recommendedActions: [
      { action: 'Feature waiver wire pickups in your weekly recap', rationale: 'Visibility into available players drives claims' },
      { action: 'Post top 5 waiver wire targets every Tuesday', rationale: 'Commissioner-curated lists reduce decision fatigue' },
      { action: 'Highlight streaming options at thin positions', rationale: 'Helps managers at positions with limited waivers' },
    ],
    rollbackCriteria: ['Dismiss when waiver benchmark percentile exceeds 30'],
    completeness: waiverPercentile !== undefined ? 75 : 50,
    uncertainty: ['Low waiver activity may reflect a healthy, deep-roster league rather than disengagement'],
  }
}

function buildLeagueEvent(input: CommissionerRecommendationInput): Recommendation | null {
  const engPercentile = input.benchmark?.engagement.percentile
  const engTier = input.leagueSignals?.engagementTier

  const isLow = (engPercentile !== undefined && engPercentile < ENGAGEMENT_LOW_PERCENTILE)
    || engTier === 'passive' || engTier === 'dormant'

  if (!isLow) return null

  return {
    id: makeId('commissioner', 'league_event', input.leagueId),
    tier: 'commissioner',
    category: 'league_event',
    entityId: input.leagueId,
    priority: 'medium',
    severity: 'standard',
    confidence: engPercentile !== undefined ? 'high' : 'medium',
    affectedDimensions: ['engagement', 'participation'],
    expectedImpact: 'Increased league activity, more inter-manager interaction, improved season experience',
    derivation: [
      ...(engPercentile !== undefined ? [`benchmark.engagement.percentile=${engPercentile} < ${ENGAGEMENT_LOW_PERCENTILE}`] : []),
      ...(engTier ? [`engagementTier=${engTier}`] : []),
    ],
    evidence: [
      ...(engPercentile !== undefined ? [`Engagement at ${engPercentile}th percentile platform-wide`] : []),
      ...(engTier ? [`Engagement tier: ${engTier}`] : []),
    ],
    benchmarkComparison: engPercentile !== undefined
      ? `League at ${engPercentile}th percentile engagement vs platform`
      : null,
    prerequisites: ['League must have at least 4 active managers to support events'],
    recommendedActions: [
      { action: 'Run a power rankings poll mid-week', rationale: 'Low-friction engagement that most managers participate in' },
      { action: 'Post a weekly matchup preview or trash talk prompt', rationale: 'Narrative content drives replies and activity' },
      { action: 'Create a rivalry week with bonus stakes', rationale: 'Competitive moments spike engagement temporarily' },
    ],
    rollbackCriteria: ['Dismiss when engagement benchmark exceeds 35th percentile for 2+ consecutive weeks'],
    completeness: engPercentile !== undefined ? 70 : 45,
    uncertainty: ['Engagement metrics depend on platform social feature availability and manager notification settings'],
  }
}

function buildWeeklyRecap(input: CommissionerRecommendationInput): Recommendation | null {
  const engTier = input.leagueSignals?.engagementTier
  const engPercentile = input.benchmark?.engagement.percentile

  const needsRecap = engTier === 'passive' || engTier === 'dormant'
    || (engPercentile !== undefined && engPercentile < ENGAGEMENT_RECAP_PERCENTILE)

  if (!needsRecap) return null
  // Avoid duplicating league_event at the same engagement level — if we already fire league_event, this is additive
  return {
    id: makeId('commissioner', 'weekly_recap', input.leagueId),
    tier: 'commissioner',
    category: 'weekly_recap',
    entityId: input.leagueId,
    priority: 'low',
    severity: 'advisory',
    confidence: 'medium',
    affectedDimensions: ['engagement'],
    expectedImpact: 'Improved information flow, managers stay informed without active browsing',
    derivation: [
      ...(engTier ? [`engagementTier=${engTier}`] : []),
      ...(engPercentile !== undefined ? [`engagement.percentile=${engPercentile} < ${ENGAGEMENT_RECAP_PERCENTILE}`] : []),
    ],
    evidence: [
      `Engagement level suggests managers benefit from commissioner-pushed summaries`,
    ],
    benchmarkComparison: engPercentile !== undefined
      ? `Engagement at ${engPercentile}th percentile — recap reduces passive-manager dropout risk`
      : null,
    prerequisites: ['Commissioner must have time to post weekly (5–10 minutes per week)'],
    recommendedActions: [
      { action: 'Post weekly standings after Monday night games', rationale: 'Gives managers a natural engagement anchor each week' },
      { action: 'Highlight top performers and surprise outcomes', rationale: 'Personal callouts drive replies and interactions' },
    ],
    rollbackCriteria: ['Archive when engagementTier improves to active or elite'],
    completeness: engPercentile !== undefined ? 65 : 40,
    uncertainty: ['Recap impact depends heavily on league communication culture'],
  }
}

function buildRivalryEngagement(input: CommissionerRecommendationInput): Recommendation | null {
  const dropoff = findPattern(input.leaguePatterns, 'league_activity_dropoff')
  if (!dropoff) return null

  const priority: RecommendationPriority = dropoff.confidence === 'high' ? 'high' : 'medium'

  return {
    id: makeId('commissioner', 'rivalry_engagement', input.leagueId),
    tier: 'commissioner',
    category: 'rivalry_engagement',
    entityId: input.leagueId,
    priority,
    severity: dropoff.confidence === 'high' ? 'elevated' : 'standard',
    confidence: toConfidence(dropoff.confidence),
    affectedDimensions: ['engagement', 'participation'],
    expectedImpact: 'Re-energized league activity, reversal of engagement decline, stronger finish to season',
    derivation: [
      `league_activity_dropoff (${dropoff.confidence}): ${dropoff.occurrenceCount} window(s) detected`,
      `priority=${priority}`,
    ],
    evidence: [`${dropoff.occurrenceCount} window(s) of league activity below 40% of baseline`],
    benchmarkComparison: input.benchmark
      ? `League at ${input.benchmark.engagement.percentile}th percentile engagement — dropoff amplifies this gap`
      : null,
    prerequisites: ['League must have enough active managers to support rivalry mechanics'],
    recommendedActions: [
      { action: 'Launch a rivalry week with double-points stakes', rationale: 'Manufactured stakes reverse activity dropoff' },
      { action: 'Post a playoff bubble standings graphic', rationale: 'Visualizing stakes re-engages managers on the margin' },
      { action: 'Announce mid-season award (most points, best record, etc.)', rationale: 'Recognition incentives maintain engagement in losing managers' },
    ],
    rollbackCriteria: ['Dismiss when league_activity_dropoff pattern no longer detected for 3+ weeks'],
    completeness: 70,
    uncertainty: [
      'Activity dropoff detection uses a 14-day window vs 28-day baseline — short-term noise may trigger false positives',
    ],
  }
}

// ── Platform recommendation generators ───────────────────────────────────────

function buildBenchmarkIntervention(input: PlatformRecommendationInput): Recommendation | null {
  const fraction = input.highChurnRiskFraction
  if (fraction === undefined || fraction <= CHURN_HIGH_FRACTION) return null

  const priority: RecommendationPriority = fraction > CHURN_CRITICAL_FRACTION ? 'critical' : 'high'

  return {
    id: makeId('platform', 'benchmark_intervention', input.platformId),
    tier: 'platform',
    category: 'benchmark_intervention',
    entityId: input.platformId,
    priority,
    severity: fraction > CHURN_CRITICAL_FRACTION ? 'urgent' : 'elevated',
    confidence: 'high',
    affectedDimensions: ['retention', 'engagement'],
    expectedImpact: 'Platform-wide retention improvement, reduced seasonal dropout rate',
    derivation: [
      `highChurnRiskFraction=${(fraction * 100).toFixed(1)}% (threshold: ${(CHURN_HIGH_FRACTION * 100).toFixed(0)}%)`,
      `priority=${priority}`,
    ],
    evidence: [`${(fraction * 100).toFixed(1)}% of leagues classified as high or critical retention risk`],
    benchmarkComparison: `${(fraction * 100).toFixed(1)}% of leagues at high/critical churn risk — exceeds intervention threshold`,
    prerequisites: [`Minimum ${input.totalLeagues ?? 10} leagues for statistical validity`],
    recommendedActions: [
      { action: 'Analyze churn patterns by league archetype to identify highest-risk cohorts', rationale: 'Targeted interventions are more efficient than blanket outreach' },
      { action: 'Alert commissioners in high-churn leagues with retention recommendations', rationale: 'Commissioner-driven interventions have highest leverage' },
      { action: 'Review onboarding and re-engagement notification timing', rationale: 'System-driven nudges complement commissioner actions' },
    ],
    rollbackCriteria: ['Escalation resolves when highChurnRiskFraction drops below 15%'],
    completeness: input.totalLeagues !== undefined ? 85 : 55,
    uncertainty: [
      'Churn risk is a leading indicator — actual dropout rates require longitudinal tracking',
      ...(input.insufficientData ? ['Insufficient league count — statistical validity is limited'] : []),
    ],
  }
}

function buildProductOpportunity(input: PlatformRecommendationInput): Recommendation | null {
  const fraction = input.lowEngagementLeagueFraction
  if (fraction === undefined || fraction <= LOW_ENGAGEMENT_MEDIUM_FRACTION) return null

  const priority: RecommendationPriority = fraction > LOW_ENGAGEMENT_HIGH_FRACTION ? 'high' : 'medium'

  return {
    id: makeId('platform', 'product_opportunity', input.platformId),
    tier: 'platform',
    category: 'product_opportunity',
    entityId: input.platformId,
    priority,
    severity: fraction > LOW_ENGAGEMENT_HIGH_FRACTION ? 'elevated' : 'standard',
    confidence: 'medium',
    affectedDimensions: ['engagement'],
    expectedImpact: 'Increased platform engagement, improved product-market fit for low-engagement segments',
    derivation: [
      `lowEngagementLeagueFraction=${(fraction * 100).toFixed(1)}% (thresholds: high=${(LOW_ENGAGEMENT_HIGH_FRACTION * 100).toFixed(0)}%, med=${(LOW_ENGAGEMENT_MEDIUM_FRACTION * 100).toFixed(0)}%)`,
    ],
    evidence: [`${(fraction * 100).toFixed(1)}% of leagues below 30th percentile engagement`],
    benchmarkComparison: `${(fraction * 100).toFixed(1)}% of leagues in bottom engagement tier — product gap identified`,
    prerequisites: ['Product team must have roadmap capacity for engagement features'],
    recommendedActions: [
      { action: 'Audit onboarding flow for new commissioner friction points', rationale: 'New leagues disproportionately populate the low-engagement tier' },
      { action: 'Identify which features top-quartile leagues use that bottom-quartile leagues do not', rationale: 'Feature adoption gap drives engagement gap' },
      { action: 'A/B test proactive commissioner nudges in low-engagement leagues', rationale: 'System-assisted commissioner behaviors may bridge engagement gap' },
    ],
    rollbackCriteria: ['Archive when lowEngagementLeagueFraction drops below 20%'],
    completeness: input.totalLeagues !== undefined ? 70 : 45,
    uncertainty: ['Engagement floor varies by sport season and draft timing — off-season leagues inflate this fraction'],
  }
}

function buildCohortImprovement(input: PlatformRecommendationInput): Recommendation | null {
  const fraction = input.inactiveLeagueFraction
  if (fraction === undefined || fraction <= INACTIVE_LEAGUE_MEDIUM_FRACTION) return null

  const priority: RecommendationPriority = fraction > INACTIVE_LEAGUE_HIGH_FRACTION ? 'high' : 'medium'

  return {
    id: makeId('platform', 'cohort_improvement', input.platformId),
    tier: 'platform',
    category: 'cohort_improvement',
    entityId: input.platformId,
    priority,
    severity: fraction > INACTIVE_LEAGUE_HIGH_FRACTION ? 'elevated' : 'standard',
    confidence: 'medium',
    affectedDimensions: ['engagement', 'retention'],
    expectedImpact: 'Improved platform-wide health score, reduced stale league accumulation',
    derivation: [
      `inactiveLeagueFraction=${(fraction * 100).toFixed(1)}% (threshold: ${(INACTIVE_LEAGUE_MEDIUM_FRACTION * 100).toFixed(0)}%)`,
    ],
    evidence: [`${(fraction * 100).toFixed(1)}% of leagues classified as inactive_or_stale or dormant`],
    benchmarkComparison: `${(fraction * 100).toFixed(1)}% of platform leagues are inactive — cohort health gap identified`,
    prerequisites: ['Platform must have league archetype data from Phase 6.3'],
    recommendedActions: [
      { action: 'Segment inactive leagues by age and inactivity duration', rationale: 'Long-dormant leagues need different intervention than recently-stale ones' },
      { action: 'Send automated re-engagement prompts to commissioners of stale leagues', rationale: 'Low-cost intervention with measurable revival rate' },
      { action: 'Set a league archival policy after N weeks of inactivity', rationale: 'Removes noise from engagement metrics and focuses commissioner resources' },
    ],
    rollbackCriteria: ['Dismiss when inactiveLeagueFraction drops below 20%'],
    completeness: input.totalLeagues !== undefined ? 70 : 45,
    uncertainty: ['Inactive classification may include seasonal leagues in the off-season'],
  }
}

function buildFeatureAdoption(input: PlatformRecommendationInput): Recommendation | null {
  const dist = input.archetypeDistribution
  if (!dist) return null

  const totalLeagues = input.totalLeagues
  if (!totalLeagues || totalLeagues < 3) return null

  const inactiveLabels = ['inactive_or_stale', 'low_engagement', 'high_churn_risk']
  const inactiveCount = inactiveLabels.reduce((sum, label) => sum + (dist[label] ?? 0), 0)
  const fraction = inactiveCount / totalLeagues

  if (fraction <= INACTIVE_ARCHETYPE_MEDIUM_FRACTION) return null

  const priority: RecommendationPriority = fraction > INACTIVE_ARCHETYPE_HIGH_FRACTION ? 'medium' : 'low'

  return {
    id: makeId('platform', 'feature_adoption', input.platformId),
    tier: 'platform',
    category: 'feature_adoption',
    entityId: input.platformId,
    priority,
    severity: fraction > INACTIVE_ARCHETYPE_HIGH_FRACTION ? 'standard' : 'advisory',
    confidence: 'low',
    affectedDimensions: ['engagement', 'participation'],
    expectedImpact: 'Improved feature discovery, better platform utilization in low-engagement segments',
    derivation: [
      `inactiveArchetypeCount=${inactiveCount} / totalLeagues=${totalLeagues} = ${(fraction * 100).toFixed(1)}%`,
      `archetypes counted: ${inactiveLabels.join(', ')}`,
    ],
    evidence: [`${(fraction * 100).toFixed(1)}% of leagues are in low-engagement archetypes: ${inactiveLabels.join(', ')}`],
    benchmarkComparison: `${(fraction * 100).toFixed(1)}% of leagues in inactive archetype cluster — feature adoption gap likely`,
    prerequisites: ['Feature analytics must be available to identify adoption gaps'],
    recommendedActions: [
      { action: 'Identify which platform features are underused in inactive_or_stale and low_engagement leagues', rationale: 'Feature gaps drive archetype distribution — adoption improvements shift leagues to healthier archetypes' },
      { action: 'Test commissioner-targeted feature education for high-value features in low-adoption leagues', rationale: 'Commissioner education has multiplier effect across all managers in their league' },
    ],
    rollbackCriteria: ['Archive when inactive archetype fraction drops below 15%'],
    completeness: 55,
    uncertainty: [
      'Feature adoption correlation with archetypes is directional, not causal',
      'Low confidence: archetype data alone does not isolate feature gaps from behavioral preferences',
    ],
  }
}

// ── Tier assemblers ───────────────────────────────────────────────────────────

export function assembleManagerRecommendations(
  input: ManagerRecommendationInput,
): RecommendationSet {
  const warnings: string[] = []
  if (!input.identity && (!input.patterns || input.patterns.length === 0)) {
    warnings.push('no_identity_or_patterns: recommendations will be sparse')
  }

  return makeSet(input.managerId, 'manager', [
    buildEngagementBoost(input),
    buildLineupDiscipline(input),
    buildTradeCoaching(input),
    buildWaiverOpportunity(input),
    buildLeagueParticipation(input),
    buildDraftPreparation(input),
  ], warnings)
}

export function assembleCommissionerRecommendations(
  input: CommissionerRecommendationInput,
): RecommendationSet {
  const warnings: string[] = []
  if (!input.leagueSignals && !input.benchmark && !input.archetype) {
    warnings.push('no_signals_benchmark_archetype: recommendations will be sparse')
  }

  return makeSet(input.leagueId, 'commissioner', [
    buildRetentionIntervention(input),
    buildTradeActivation(input),
    buildWaiverActivation(input),
    buildLeagueEvent(input),
    buildWeeklyRecap(input),
    buildRivalryEngagement(input),
  ], warnings)
}

export function assemblePlatformRecommendations(
  input: PlatformRecommendationInput,
): RecommendationSet {
  const warnings: string[] = []
  if (input.insufficientData) {
    warnings.push('insufficient_data: platform has too few leagues for reliable recommendations')
  }

  return makeSet(input.platformId, 'platform', [
    buildBenchmarkIntervention(input),
    buildProductOpportunity(input),
    buildCohortImprovement(input),
    buildFeatureAdoption(input),
  ], warnings)
}

// ── Unified orchestrator ──────────────────────────────────────────────────────

export function assembleRecommendations(
  input: RecommendationEngineInput,
): RecommendationEngineResult {
  const managerRecommendations = input.managerInputs.map(assembleManagerRecommendations)
  const commissionerRecommendations = input.commissionerInputs.map(assembleCommissionerRecommendations)
  const platformRecommendations = input.platformInputs.map(assemblePlatformRecommendations)

  const all = [
    ...managerRecommendations,
    ...commissionerRecommendations,
    ...platformRecommendations,
  ]
  const totalRecommendations = all.reduce((n, s) => n + s.totalRecommendations, 0)
  const criticalRecommendations = all.reduce((n, s) => n + s.criticalCount, 0)

  return {
    managerRecommendations,
    commissionerRecommendations,
    platformRecommendations,
    totalRecommendations,
    criticalRecommendations,
    warnings: [],
    version: RECOMMENDATION_VERSION,
  }
}
