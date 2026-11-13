import type { TradeDecisionContextV1 } from './trade-decision-context'
import { computeDataCoverageTier, type DataCoverageResult } from './trade-decision-context'
import type { PeerReviewConsensus } from './trade-analysis-schema'
import { buildDeterministicIntelligence, type DeterministicIntelligence } from './deterministic-intelligence'

type QualityViolation = {
  rule: string
  severity: 'hard' | 'soft'
  detail: string
  adjustment?: string
}

export type ConditionalRecommendation = {
  isConditional: boolean
  reasons: string[]
  label: string
}

type QualityGateResult = {
  passed: boolean
  violations: QualityViolation[]
  adjustedConfidence: number
  deterministicConfidence: number
  originalLLMConfidence: number
  filteredReasons: string[]
  filteredCounters: string[]
  filteredWarnings: string[]
  deterministicIntelligence: DeterministicIntelligence
  conditionalRecommendation: ConditionalRecommendation
  dataCoverage: DataCoverageResult
}

const CONFIDENCE_CEILING_BY_COVERAGE: [number, number][] = [
  [30, 35],
  [50, 55],
  [70, 75],
  [85, 90],
]

function computeConfidenceCeiling(coverage: number): number {
  for (const [threshold, cap] of CONFIDENCE_CEILING_BY_COVERAGE) {
    if (coverage <= threshold) return cap
  }
  return 100
}

function checkConfidenceVsCompleteness(
  confidence: number,
  ctx: TradeDecisionContextV1
): { violations: QualityViolation[]; ceiling: number } {
  const violations: QualityViolation[] = []
  const coverage = ctx.dataQuality.coveragePercent

  let ceiling = computeConfidenceCeiling(coverage)

  if (confidence > ceiling) {
    violations.push({
      rule: 'confidence_vs_completeness',
      severity: 'soft',
      detail: `Confidence ${confidence}% exceeds ceiling ${ceiling}% for ${coverage}% data coverage`,
      adjustment: `Capped confidence to ${ceiling}`,
    })
  }

  const missingCount =
    ctx.missingData.valuationsMissing.length +
    ctx.missingData.adpMissing.length +
    ctx.missingData.analyticsMissing.length

  if (missingCount > 0) {
    const missingPenalty = Math.min(missingCount * 5, 25)
    const dataCeiling = Math.max(55, 80 - missingPenalty)
    if (dataCeiling < ceiling) {
      ceiling = dataCeiling
      violations.push({
        rule: 'confidence_vs_missing_data',
        severity: 'soft',
        detail: `${missingCount} missing data fields — ceiling reduced to ${dataCeiling}%`,
        adjustment: `Penalized ceiling by ${missingPenalty} for missing data`,
      })
    }
  }

  if (ctx.missingData.injuryDataStale) {
    const staleCeiling = Math.min(ceiling, 70)
    if (staleCeiling < ceiling) {
      ceiling = staleCeiling
      violations.push({
        rule: 'confidence_vs_stale_injury',
        severity: 'soft',
        detail: `Injury data is stale — ceiling reduced to ${staleCeiling}%`,
        adjustment: `Reduced ceiling for stale injury data`,
      })
    }
  }

  if (ctx.missingData.valuationDataStale) {
    const staleCeiling = Math.min(ceiling, 65)
    if (staleCeiling < ceiling) {
      ceiling = staleCeiling
      violations.push({
        rule: 'confidence_vs_stale_valuation',
        severity: 'soft',
        detail: `Player valuations are stale (>3 days) — ceiling reduced to ${staleCeiling}%`,
        adjustment: `Reduced ceiling for stale valuation data`,
      })
    }
  }

  if (ctx.missingData.adpDataStale) {
    const staleCeiling = Math.min(ceiling, 75)
    if (staleCeiling < ceiling) {
      ceiling = staleCeiling
      violations.push({
        rule: 'confidence_vs_stale_adp',
        severity: 'soft',
        detail: `ADP data is stale (>7 days) — ceiling reduced to ${staleCeiling}%`,
        adjustment: `Reduced ceiling for stale ADP data`,
      })
    }
  }

  if (ctx.missingData.tradeHistoryStale) {
    const staleCeiling = Math.min(ceiling, 75)
    if (staleCeiling < ceiling) {
      ceiling = staleCeiling
      violations.push({
        rule: 'confidence_vs_stale_trade_history',
        severity: 'soft',
        detail: `Trade history is stale (>7 days) — ceiling reduced to ${staleCeiling}%`,
        adjustment: `Reduced ceiling for stale trade history`,
      })
    }
  }

  const staleCount = [
    ctx.missingData.injuryDataStale,
    ctx.missingData.valuationDataStale,
    ctx.missingData.adpDataStale,
    ctx.missingData.analyticsDataStale,
    ctx.missingData.tradeHistoryStale,
  ].filter(Boolean).length

  if (staleCount >= 3) {
    const multiStaleCeiling = Math.min(ceiling, 50)
    if (multiStaleCeiling < ceiling) {
      ceiling = multiStaleCeiling
      violations.push({
        rule: 'confidence_vs_multi_stale',
        severity: 'hard',
        detail: `${staleCount}/5 data sources are stale — ceiling hard-capped at ${multiStaleCeiling}%`,
        adjustment: `Multiple stale sources cap`,
      })
    }
  }

  return { violations, ceiling }
}

function buildKnownAssetNames(ctx: TradeDecisionContextV1): Set<string> {
  const names = new Set<string>()

  for (const side of [ctx.sideA, ctx.sideB]) {
    for (const asset of side.assets) {
      names.add(asset.name.toLowerCase())
      const words = asset.name.toLowerCase().split(/\s+/)
      if (words.length >= 2) {
        names.add(words[words.length - 1])
      }
    }
    for (const marker of side.riskMarkers) {
      names.add(marker.playerName.toLowerCase())
      const words = marker.playerName.toLowerCase().split(/\s+/)
      if (words.length >= 2) {
        names.add(words[words.length - 1])
      }
    }
  }

  return names
}

const COMMON_TERMS = new Set([
  'team', 'side', 'trade', 'value', 'pick', 'round', 'draft', 'player',
  'dynasty', 'fantasy', 'football', 'league', 'roster', 'starter',
  'bench', 'waiver', 'injury', 'season', 'week', 'game', 'point',
  'super', 'flex', 'premium', 'standard', 'half', 'full', 'none',
  'low', 'moderate', 'high', 'even', 'slight', 'edge', 'data',
  'missing', 'stale', 'quality', 'gate', 'based', 'market',
  'age', 'prime', 'declining', 'cliff', 'ascending', 'unknown',
  'total', 'delta', 'percent', 'ceiling', 'floor',
])

function looksLikePlayerName(token: string): boolean {
  const words = token.trim().split(/\s+/)
  if (words.length < 2 || words.length > 4) return false
  if (words.some(w => COMMON_TERMS.has(w.toLowerCase()))) return false
  return words.every(w => /^[A-Z][a-z]+$/.test(w) || /^[A-Z]\.?$/.test(w) || /^(Jr|Sr|II|III|IV|V)\.?$/.test(w))
}

function extractPlayerReferences(text: string): string[] {
  const potentialNames: string[] = []
  const pattern = /(?:^|[,;.\s])([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:\s+(?:Jr|Sr|II|III|IV|V)\.?)?)/g

  let match
  while ((match = pattern.exec(text)) !== null) {
    const candidate = match[1].trim()
    if (looksLikePlayerName(candidate)) {
      potentialNames.push(candidate)
    }
  }

  return potentialNames
}

function checkPhantomAssetReferences(
  consensus: PeerReviewConsensus,
  ctx: TradeDecisionContextV1
): { violations: QualityViolation[]; phantomReasonIdxs: Set<number>; phantomCounterIdxs: Set<number>; phantomWarningIdxs: Set<number> } {
  const violations: QualityViolation[] = []
  const phantomReasonIdxs = new Set<number>()
  const phantomCounterIdxs = new Set<number>()
  const phantomWarningIdxs = new Set<number>()
  const knownAssets = buildKnownAssetNames(ctx)

  const sections: { items: string[]; section: string; tracker: Set<number> }[] = [
    { items: consensus.reasons, section: 'reasons', tracker: phantomReasonIdxs },
    { items: consensus.counters, section: 'counters', tracker: phantomCounterIdxs },
    { items: consensus.warnings, section: 'warnings', tracker: phantomWarningIdxs },
  ]

  for (const { items, section, tracker } of sections) {
    for (let i = 0; i < items.length; i++) {
      const refs = extractPlayerReferences(items[i])
      for (const ref of refs) {
        const lower = ref.toLowerCase()
        const lastName = lower.split(/\s+/).pop() || ''
        if (!knownAssets.has(lower) && !knownAssets.has(lastName)) {
          tracker.add(i)
          violations.push({
            rule: 'phantom_asset_reference',
            severity: 'soft',
            detail: `"${ref}" referenced in ${section}[${i}] but not found in trade context assets`,
            adjustment: `Flagged line for potential hallucination`,
          })
        }
      }
    }
  }

  return { violations, phantomReasonIdxs, phantomCounterIdxs, phantomWarningIdxs }
}

function checkCounterConstraintViolations(
  counters: string[],
  ctx: TradeDecisionContextV1
): QualityViolation[] {
  const violations: QualityViolation[] = []

  for (let i = 0; i < counters.length; i++) {
    const text = counters[i].toLowerCase()

    if (!ctx.leagueConfig.isSF && (text.includes('superflex') || text.includes('super flex') || /\bsf\b/.test(text))) {
      violations.push({
        rule: 'counter_sf_in_non_sf',
        severity: 'soft',
        detail: `counters[${i}] references Superflex in a non-SF league`,
        adjustment: 'Counter uses wrong league format context',
      })
    }

    if (ctx.leagueConfig.isSF && /\b1qb\b/.test(text)) {
      violations.push({
        rule: 'counter_1qb_in_sf',
        severity: 'soft',
        detail: `counters[${i}] references 1QB in a Superflex league`,
        adjustment: 'Counter uses wrong league format context',
      })
    }

    if (!ctx.leagueConfig.isTEP && (text.includes('te premium') || /\btep\b/.test(text))) {
      violations.push({
        rule: 'counter_tep_in_non_tep',
        severity: 'soft',
        detail: `counters[${i}] references TE Premium in a non-TEP league`,
        adjustment: 'Counter uses wrong league format context',
      })
    }

    if (ctx.leagueConfig.taxiSlots === 0 && text.includes('taxi')) {
      violations.push({
        rule: 'counter_taxi_in_no_taxi',
        severity: 'soft',
        detail: `counters[${i}] references taxi squad but league has 0 taxi slots`,
        adjustment: 'Counter references non-existent roster feature',
      })
    }

    const rosterSize = ctx.leagueConfig.starterSlots + ctx.leagueConfig.benchSlots + ctx.leagueConfig.taxiSlots
    const rosterMatch = text.match(/(\d+)\s*(?:roster|man roster|player roster)/)
    if (rosterMatch) {
      const mentioned = parseInt(rosterMatch[1])
      if (Math.abs(mentioned - rosterSize) > 5) {
        violations.push({
          rule: 'counter_roster_size_mismatch',
          severity: 'soft',
          detail: `counters[${i}] references ${mentioned}-man roster but league has ${rosterSize} slots`,
          adjustment: 'Counter assumes wrong roster size',
        })
      }
    }

    const teamMatch = text.match(/(\d+)\s*(?:team|man)\s*league/)
    if (teamMatch) {
      const mentioned = parseInt(teamMatch[1])
      if (mentioned !== ctx.leagueConfig.numTeams) {
        violations.push({
          rule: 'counter_team_count_mismatch',
          severity: 'soft',
          detail: `counters[${i}] references ${mentioned}-team league but league has ${ctx.leagueConfig.numTeams} teams`,
          adjustment: 'Counter assumes wrong league size',
        })
      }
    }
  }

  return violations
}

function checkLeagueConstraintViolations(
  consensus: PeerReviewConsensus,
  ctx: TradeDecisionContextV1
): QualityViolation[] {
  const violations: QualityViolation[] = []

  const reasonsText = consensus.reasons.join(' ').toLowerCase()

  if (!ctx.leagueConfig.isSF && (reasonsText.includes('superflex') || reasonsText.includes('super flex') || /\bsf\b/.test(reasonsText))) {
    violations.push({
      rule: 'sf_reference_in_non_sf',
      severity: 'soft',
      detail: 'Model references Superflex value in a non-SF league',
      adjustment: 'Flagged SF-specific reasoning in standard league',
    })
  }

  if (ctx.leagueConfig.isSF && /\b1qb\b/.test(reasonsText) && !/\bsf\b/.test(reasonsText)) {
    violations.push({
      rule: '1qb_reference_in_sf',
      severity: 'soft',
      detail: 'Model references 1QB value in a Superflex league',
      adjustment: 'Flagged 1QB-specific reasoning in SF league',
    })
  }

  if (!ctx.leagueConfig.isTEP && (reasonsText.includes('te premium') || /\btep\b/.test(reasonsText))) {
    violations.push({
      rule: 'tep_reference_in_non_tep',
      severity: 'soft',
      detail: 'Model references TE Premium value in a non-TEP league',
      adjustment: 'Flagged TEP-specific reasoning in standard league',
    })
  }

  const scoringType = ctx.leagueConfig.scoringType.toLowerCase()
  if (scoringType.includes('ppr') && reasonsText.includes('standard scoring') && !reasonsText.includes('ppr')) {
    violations.push({
      rule: 'scoring_mismatch',
      severity: 'soft',
      detail: `Model references standard scoring but league is ${ctx.leagueConfig.scoringType}`,
      adjustment: 'Flagged scoring format mismatch',
    })
  }

  if (ctx.leagueConfig.taxiSlots === 0 && reasonsText.includes('taxi squad')) {
    violations.push({
      rule: 'taxi_reference_in_no_taxi',
      severity: 'soft',
      detail: 'Model references taxi squad but league has no taxi slots',
      adjustment: 'Flagged taxi squad reference in non-taxi league',
    })
  }

  violations.push(...checkCounterConstraintViolations(consensus.counters, ctx))

  return violations
}

function checkValuationBoundConflicts(
  consensus: PeerReviewConsensus,
  ctx: TradeDecisionContextV1
): QualityViolation[] {
  const violations: QualityViolation[] = []

  const deterministicFavored = ctx.valueDelta.favoredSide
  const peerVerdict = consensus.verdict

  const peerFavorsA = peerVerdict === 'Team A' || peerVerdict === 'Slight edge to Team A'
  const peerFavorsB = peerVerdict === 'Team B' || peerVerdict === 'Slight edge to Team B'
  const peerEven = peerVerdict === 'Even' || peerVerdict === 'Disagreement'

  if (ctx.valueDelta.percentageDiff > 20) {
    if (deterministicFavored === 'A' && peerFavorsB) {
      violations.push({
        rule: 'verdict_contradicts_deterministic_valuation',
        severity: 'hard',
        detail: `Deterministic values favor Side A by ${ctx.valueDelta.percentageDiff}% but model says "${peerVerdict}"`,
        adjustment: `Severe confidence reduction — model contradicts strong deterministic signal`,
      })
    }
    if (deterministicFavored === 'B' && peerFavorsA) {
      violations.push({
        rule: 'verdict_contradicts_deterministic_valuation',
        severity: 'hard',
        detail: `Deterministic values favor Side B by ${ctx.valueDelta.percentageDiff}% but model says "${peerVerdict}"`,
        adjustment: `Severe confidence reduction — model contradicts strong deterministic signal`,
      })
    }
  }

  if (ctx.valueDelta.percentageDiff > 30 && peerEven) {
    violations.push({
      rule: 'even_verdict_with_large_delta',
      severity: 'soft',
      detail: `${ctx.valueDelta.percentageDiff}% value delta but model says "${peerVerdict}" — likely ignoring valuation gap`,
      adjustment: `Reduced confidence for even verdict with large delta`,
    })
  }

  if (ctx.valueDelta.percentageDiff <= 5 && consensus.confidence > 85) {
    if (peerFavorsA || peerFavorsB) {
      violations.push({
        rule: 'high_confidence_on_close_trade',
        severity: 'soft',
        detail: `Only ${ctx.valueDelta.percentageDiff}% delta but model is ${consensus.confidence}% confident in "${peerVerdict}"`,
        adjustment: `Capped confidence — values too close for strong verdict`,
      })
    }
  }

  return violations
}

function checkInjuryCompoundRisk(
  ctx: TradeDecisionContextV1
): { violations: QualityViolation[]; ceiling: number | null } {
  const violations: QualityViolation[] = []

  const allRiskMarkers = [...ctx.sideA.riskMarkers, ...ctx.sideB.riskMarkers]
  const injuryRiskPlayers = allRiskMarkers.filter(
    r => r.injuryStatus && (
      r.injuryStatus.reinjuryRisk === 'high' ||
      r.injuryStatus.reinjuryRisk === 'moderate' ||
      (r.injuryStatus.status !== 'Healthy' && r.injuryStatus.status !== 'Active')
    )
  )
  const hasInjuryRisk = injuryRiskPlayers.length > 0

  let injuryDataUnreliable = ctx.missingData.injuryDataStale === true
  if (ctx.sourceFreshness) {
    const g = ctx.sourceFreshness.injuries.grade
    injuryDataUnreliable = g === 'stale' || g === 'expired' || g === 'unavailable'
  }

  const thinDelta = ctx.valueDelta.percentageDiff <= 10

  if (hasInjuryRisk && injuryDataUnreliable && thinDelta) {
    const cap = 55
    const playerNames = injuryRiskPlayers.slice(0, 3).map(r => r.playerName).join(', ')
    violations.push({
      rule: 'injury_compound_risk',
      severity: 'hard',
      detail: `Injury risk (${playerNames}) + unreliable injury data + thin value delta (${ctx.valueDelta.percentageDiff}%) — confidence hard-capped at ${cap}%`,
      adjustment: `Capped at ${cap}% due to compounding injury uncertainty`,
    })
    return { violations, ceiling: cap }
  }

  if (hasInjuryRisk && injuryDataUnreliable) {
    const cap = 65
    violations.push({
      rule: 'injury_stale_risk',
      severity: 'soft',
      detail: `Injury risk present but injury data is unreliable — ceiling reduced to ${cap}%`,
      adjustment: `Reduced ceiling for injury data uncertainty`,
    })
    return { violations, ceiling: cap }
  }

  return { violations, ceiling: null }
}

function checkMissingRosterTeamData(
  ctx: TradeDecisionContextV1
): { conditionalReasons: string[]; violations: QualityViolation[] } {
  const conditionalReasons: string[] = []
  const violations: QualityViolation[] = []

  let rosterUnavailable = false
  if (ctx.sourceFreshness) {
    const g = ctx.sourceFreshness.rosters.grade
    rosterUnavailable = g === 'expired' || g === 'unavailable'
  }

  const sideAEmpty = ctx.sideA.rosterComposition.size === 0
  const sideBEmpty = ctx.sideB.rosterComposition.size === 0

  if (rosterUnavailable || sideAEmpty || sideBEmpty) {
    conditionalReasons.push('Roster data is missing or expired — needs/surplus analysis may be inaccurate')
    violations.push({
      rule: 'missing_roster_data',
      severity: 'soft',
      detail: 'Roster data is unavailable or expired — recommendation is conditional',
      adjustment: 'Forced conditional recommendation',
    })
  }

  if (ctx.missingData.competitorDataUnavailable) {
    conditionalReasons.push('No competitor team data — league-wide context is unavailable')
    violations.push({
      rule: 'missing_competitor_data',
      severity: 'soft',
      detail: 'Competitor team data unavailable — league context incomplete',
      adjustment: 'Forced conditional recommendation',
    })
  }

  const bothTendenciesMissing =
    ctx.sideA.managerPreferences === null && ctx.sideB.managerPreferences === null
  if (bothTendenciesMissing && ctx.missingData.managerTendenciesUnavailable.length >= 2) {
    conditionalReasons.push('No manager trade history for either side — acceptance predictions are unreliable')
    violations.push({
      rule: 'missing_manager_tendencies',
      severity: 'soft',
      detail: 'Both managers lack trade tendency data — acceptance signals unreliable',
      adjustment: 'Forced conditional recommendation',
    })
  }

  if (ctx.missingData.valuationsMissing.length >= 3) {
    conditionalReasons.push(`Valuations missing for ${ctx.missingData.valuationsMissing.length} assets — value delta may not reflect true trade value`)
    violations.push({
      rule: 'missing_critical_valuations',
      severity: 'soft',
      detail: `${ctx.missingData.valuationsMissing.length} assets lack valuations — value analysis is incomplete`,
      adjustment: 'Forced conditional recommendation',
    })
  }

  return { conditionalReasons, violations }
}

export function runQualityGate(
  consensus: PeerReviewConsensus,
  ctx: TradeDecisionContextV1
): QualityGateResult {
  const deterministic = buildDeterministicIntelligence(ctx)
  const allViolations: QualityViolation[] = []

  const dataCoverage = computeDataCoverageTier(
    ctx.dataQuality,
    ctx.missingData,
    ctx.sourceFreshness,
  )

  const { violations: confidenceViolations, ceiling } = checkConfidenceVsCompleteness(deterministic.confidence, ctx)
  allViolations.push(...confidenceViolations)

  const { violations: phantomViolations, phantomReasonIdxs, phantomCounterIdxs, phantomWarningIdxs } =
    checkPhantomAssetReferences(consensus, ctx)
  allViolations.push(...phantomViolations)

  allViolations.push(...checkLeagueConstraintViolations(consensus, ctx))

  allViolations.push(...checkValuationBoundConflicts(consensus, ctx))

  const { violations: injuryViolations, ceiling: injuryCeiling } = checkInjuryCompoundRisk(ctx)
  allViolations.push(...injuryViolations)

  const { conditionalReasons, violations: rosterViolations } = checkMissingRosterTeamData(ctx)
  allViolations.push(...rosterViolations)

  const llmReasons = consensus.reasons.filter((_, i) => !phantomReasonIdxs.has(i))
  const llmCounters = consensus.counters.filter((_, i) => !phantomCounterIdxs.has(i))
  const llmWarnings = consensus.warnings.filter((_, i) => !phantomWarningIdxs.has(i))

  if (llmReasons.length === 0 && consensus.reasons.length > 0) {
    allViolations.push({
      rule: 'all_reasons_filtered',
      severity: 'hard',
      detail: `All ${consensus.reasons.length} LLM reasons contained phantom asset references`,
      adjustment: 'LLM reasoning discarded — deterministic reasons are primary',
    })
  }

  let adjustedConfidence = deterministic.confidence

  const llmDelta = consensus.confidence - deterministic.confidence
  const peerVerdict = consensus.verdict
  const detFavored = ctx.valueDelta.favoredSide
  const peerFavorsA = peerVerdict === 'Team A' || peerVerdict === 'Slight edge to Team A'
  const peerFavorsB = peerVerdict === 'Team B' || peerVerdict === 'Slight edge to Team B'
  const peerEven = peerVerdict === 'Even'
  const detEven = detFavored === 'Even'

  const llmAgreesWithDet =
    (detFavored === 'A' && peerFavorsA) ||
    (detFavored === 'B' && peerFavorsB) ||
    (detEven && peerEven)

  const llmContradictsdet =
    (detFavored === 'A' && peerFavorsB) ||
    (detFavored === 'B' && peerFavorsA)

  if (consensus.meta.consensusMethod === 'agreement' && llmAgreesWithDet) {
    adjustedConfidence += Math.max(0, Math.min(Math.round(llmDelta * 0.3), 10))
  } else if (llmContradictsdet) {
    adjustedConfidence -= 8
  } else if (consensus.meta.consensusMethod === 'disagreement') {
    adjustedConfidence -= 5
    if (consensus.disagreement.reviewMode) {
      adjustedConfidence -= 3
      allViolations.push({
        rule: 'review_mode_active',
        severity: 'soft',
        detail: `High disagreement between AI models (${consensus.disagreement.keyDifferences.length} key differences, ${consensus.disagreement.confidenceSpread}pt confidence spread) — review mode active with conservative counters`,
        adjustment: 'Additional -3 for high-disagreement review mode',
      })
    }
  }

  const hardViolations = allViolations.filter(v => v.severity === 'hard')
  const softViolations = allViolations.filter(v => v.severity === 'soft')

  for (const _v of hardViolations) {
    adjustedConfidence = Math.max(adjustedConfidence - 15, 10)
  }

  for (const _v of softViolations) {
    adjustedConfidence = Math.max(adjustedConfidence - 3, 10)
  }

  adjustedConfidence += dataCoverage.confidenceAdjustment
  if (dataCoverage.tier !== 'FULL') {
    allViolations.push({
      rule: 'coverage_tier_penalty',
      severity: 'soft',
      detail: `Data coverage is ${dataCoverage.tier} (score: ${dataCoverage.score}/100) — confidence adjusted by ${dataCoverage.confidenceAdjustment}`,
      adjustment: `Coverage tier: ${dataCoverage.badge.label}`,
    })
  }

  let effectiveCeiling = ceiling
  if (injuryCeiling !== null) {
    effectiveCeiling = Math.min(effectiveCeiling, injuryCeiling)
  }
  adjustedConfidence = Math.min(adjustedConfidence, effectiveCeiling)

  const filteredReasons = [
    ...deterministic.reasons,
    ...llmReasons.filter(lr => {
      const lrLower = lr.toLowerCase()
      return !deterministic.reasons.some(dr => {
        const drLower = dr.toLowerCase()
        const drWords = new Set(drLower.split(/\s+/).filter(w => w.length > 3))
        const overlap = lrLower.split(/\s+/).filter(w => drWords.has(w)).length
        return overlap >= 4
      })
    }),
  ]

  const filteredCounters = [
    ...deterministic.counterBaselines,
    ...llmCounters.filter(lc => {
      const lcLower = lc.toLowerCase()
      return !deterministic.counterBaselines.some(dc =>
        lcLower.includes(dc.toLowerCase().slice(0, 30))
      )
    }),
  ]

  let filteredWarnings = [
    ...deterministic.warnings,
    ...llmWarnings.filter(lw => {
      const lwLower = lw.toLowerCase()
      return !deterministic.warnings.some(dw => lwLower.includes(dw.toLowerCase().slice(0, 25)))
    }),
  ]

  for (const v of allViolations) {
    if (v.rule !== 'phantom_asset_reference') {
      filteredWarnings.push(`[QualityGate] ${v.detail}`)
    }
  }

  const passed = hardViolations.length === 0

  const isConditional = conditionalReasons.length > 0
  const conditionalRecommendation: ConditionalRecommendation = {
    isConditional,
    reasons: conditionalReasons,
    label: isConditional ? 'Conditional' : 'Standard',
  }

  if (isConditional) {
    filteredWarnings.push(`[Conditional] This recommendation requires verification: ${conditionalReasons[0]}`)
  }

  return {
    passed,
    violations: allViolations,
    adjustedConfidence: Math.max(15, Math.min(90, Math.round(adjustedConfidence))),
    deterministicConfidence: deterministic.confidence,
    originalLLMConfidence: consensus.confidence,
    filteredReasons: filteredReasons.length > 0 ? filteredReasons : ['Insufficient data for detailed analysis'],
    filteredCounters,
    filteredWarnings,
    deterministicIntelligence: deterministic,
    conditionalRecommendation,
    dataCoverage,
  }
}
