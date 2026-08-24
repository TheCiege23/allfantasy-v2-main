import type { TradeDecisionContextV1, AssetValuation, PlayerRiskMarker } from './trade-decision-context'
import type { PeerReviewConsensus, DisagreementBlock } from './trade-analysis-schema'
import type { QualityGateResult, ConditionalRecommendation } from './quality-gate'

/** 'N/A' = refused: zero valued assets — see verdictHasNoSignal(). Never a letter. */
export type FairnessGrade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F' | 'N/A'

export type DeterministicDriver = {
  label: string
  value: string
  impact: 'positive' | 'negative' | 'neutral'
  category: 'value' | 'roster' | 'timing' | 'risk' | 'viability'
}

export type DeterministicVerdict = {
  winner: 'A' | 'B' | 'Even'
  winnerLabel: string
  fairnessGrade: FairnessGrade
  /** Null when the verdict refused to grade (no valued assets — see verdictHasNoSignal). */
  fairnessScore: number | null
  netValueDelta: number
  netValueDeltaPct: number
  acceptanceProbability: number
  acceptanceLikelihood: 'Very Likely' | 'Likely' | 'Uncertain' | 'Unlikely' | 'Very Unlikely'
  vetoRisk: 'None' | 'Low' | 'Moderate' | 'High'
  confidence: number
  keyDrivers: DeterministicDriver[]
  sideATotalValue: number
  sideBTotalValue: number
  sideANetStarterDelta: number
  sideBNetStarterDelta: number
  injuryRiskDelta: number
  source: 'deterministic-engine'
}

export type ValueVerdict = {
  fairnessGrade: FairnessGrade
  edge: string
  edgeSide: 'A' | 'B' | 'Even'
  valueDeltaPercent: number
  valueDeltaAbsolute: number
  sideATotalValue: number
  sideBTotalValue: number
  confidence: number
  deterministicConfidence: number
  vetoRisk: 'None' | 'Low' | 'Moderate' | 'High'
  reasons: string[]
  warnings: string[]
  disagreementCodes?: string[]
  disagreementDetails?: string
  dataFreshness: {
    staleSourceCount: number
    staleSources: string[]
  }
  dataCoverage: {
    tier: 'FULL' | 'PARTIAL' | 'MINIMAL'
    score: number
    badge: {
      label: string
      description: string
      color: 'green' | 'yellow' | 'red'
    }
    dimensions: {
      assetCoverage: { score: number; detail: string }
      sourceFreshness: { score: number; detail: string }
      dataCompleteness: { score: number; detail: string }
    }
  }
  recommendationType: ConditionalRecommendation
  disagreement: DisagreementBlock
}

export type RankingsImpact = {
  sideARankDelta: number
  sideBRankDelta: number
  sideAProjectedTier: string
  sideBProjectedTier: string
  leaguePositionSignal: string
  details: string[]
}

export type InjuryAdjustedValue = {
  sideAHealthyValue: number
  sideBHealthyValue: number
  sideAAdjustedValue: number
  sideBAdjustedValue: number
  sideAInjuryDiscount: number
  sideBInjuryDiscount: number
  netInjuryExposureShift: string
  details: string[]
}

export type StarterBenchDelta = {
  sideAStarterImpact: number
  sideBStarterImpact: number
  sideABenchValue: number
  sideBBenchValue: number
  netStarterDelta: number
  starterImpactLabel: string
  details: string[]
}

export type ViabilityVerdict = {
  acceptanceLikelihood: 'Very Likely' | 'Likely' | 'Uncertain' | 'Unlikely' | 'Very Unlikely'
  acceptanceScore: number
  partnerFit: {
    needsAlignment: string
    surplusMatch: string
    fitScore: number
    details: string[]
  }
  timing: {
    sideAWindow: string
    sideBWindow: string
    timingFit: string
    details: string[]
  }
  rankingsImpact: RankingsImpact
  injuryAdjustedValue: InjuryAdjustedValue
  starterBenchDelta: StarterBenchDelta
  leagueActivity: string
  signals: string[]
  calibration?: {
    isotonicApplied: boolean
    rawAcceptProbability?: number
  }
}

export type ActionPlan = {
  bestOffer: {
    assessment: string
    sendAsIs: boolean
    adjustmentNeeded: string | null
  }
  counters: {
    description: string
    rationale: string
  }[]
  messageText: string
}

export type FormattedTradeResponse = {
  deterministicVerdict: DeterministicVerdict
  valueVerdict: ValueVerdict
  viabilityVerdict: ViabilityVerdict
  actionPlan: ActionPlan
}

function computeFairnessGrade(pctDiff: number): FairnessGrade {
  if (pctDiff <= 3) return 'A+'
  if (pctDiff <= 7) return 'A'
  if (pctDiff <= 12) return 'B+'
  if (pctDiff <= 18) return 'B'
  if (pctDiff <= 25) return 'C'
  if (pctDiff <= 35) return 'D'
  return 'F'
}

/**
 * P4-8 zero-data guard — mirrors hasNoSignal() in lib/projections/tradeGrading.
 * When no asset resolved a value, sideA/sideB totals are 0-vs-0, percentageDiff
 * reads 0, and the bands above would grade "A+ / dead even" from pure absence
 * of data. "We could not price this trade" and "this trade is fair" are
 * opposite claims; only one of them is true.
 */
export function verdictHasNoSignal(ctx: TradeDecisionContextV1): boolean {
  return (
    ctx.dataQuality.assetsCovered === 0 ||
    (ctx.sideA.totalValue <= 0 && ctx.sideB.totalValue <= 0)
  )
}

function computeVetoRisk(pctDiff: number): ValueVerdict['vetoRisk'] {
  if (pctDiff <= 8) return 'None'
  if (pctDiff <= 15) return 'Low'
  if (pctDiff <= 25) return 'Moderate'
  return 'High'
}

function computeEdgeLabel(ctx: TradeDecisionContextV1): string {
  const pct = ctx.valueDelta.percentageDiff
  const side = ctx.valueDelta.favoredSide

  if (side === 'Even' || pct <= 3) return 'Dead even'
  if (pct <= 7) return `Slight edge to Side ${side}`
  if (pct <= 15) return `Clear edge to Side ${side} (+${pct}%)`
  if (pct <= 25) return `Strong edge to Side ${side} (+${pct}%)`
  return `Lopsided toward Side ${side} (+${pct}%)`
}

function computeNeedsAlignment(ctx: TradeDecisionContextV1): {
  needsAlignment: string
  surplusMatch: string
  fitScore: number
  details: string[]
} {
  const details: string[] = []
  let fitScore = 50

  const aNeeds = new Set(ctx.sideA.needs.map(n => n.toLowerCase()))
  const bNeeds = new Set(ctx.sideB.needs.map(n => n.toLowerCase()))
  const aSurplus = new Set(ctx.sideA.surplus.map(s => s.toLowerCase()))
  const bSurplus = new Set(ctx.sideB.surplus.map(s => s.toLowerCase()))

  const bAssetsPositions = ctx.sideB.assets.map(a => a.position.toUpperCase())
  const aAssetsPositions = ctx.sideA.assets.map(a => a.position.toUpperCase())

  let aGetsNeeded = 0
  for (const pos of bAssetsPositions) {
    if (aNeeds.has(pos.toLowerCase())) aGetsNeeded++
  }

  let bGetsNeeded = 0
  for (const pos of aAssetsPositions) {
    if (bNeeds.has(pos.toLowerCase())) bGetsNeeded++
  }

  if (aGetsNeeded > 0) {
    details.push(`Side A fills ${aGetsNeeded} roster need${aGetsNeeded > 1 ? 's' : ''} from this trade`)
    fitScore += aGetsNeeded * 10
  }

  if (bGetsNeeded > 0) {
    details.push(`Side B fills ${bGetsNeeded} roster need${bGetsNeeded > 1 ? 's' : ''} from this trade`)
    fitScore += bGetsNeeded * 10
  }

  if (aGetsNeeded === 0 && bGetsNeeded === 0) {
    details.push('Neither side fills a clear positional need')
    fitScore -= 15
  }

  let surplusOverlap = 0
  for (const pos of bAssetsPositions) {
    if (aSurplus.has(pos.toLowerCase())) surplusOverlap++
  }
  for (const pos of aAssetsPositions) {
    if (bSurplus.has(pos.toLowerCase())) surplusOverlap++
  }

  if (surplusOverlap > 0) {
    details.push(`${surplusOverlap} asset${surplusOverlap > 1 ? 's' : ''} being traded from surplus positions — good fit`)
    fitScore += surplusOverlap * 5
  }

  fitScore = Math.max(10, Math.min(100, fitScore))

  const needsLabel = aGetsNeeded > 0 && bGetsNeeded > 0
    ? 'Both sides address roster needs'
    : aGetsNeeded > 0
    ? 'Mostly helps Side A\'s needs'
    : bGetsNeeded > 0
    ? 'Mostly helps Side B\'s needs'
    : 'No clear needs addressed'

  const surplusLabel = surplusOverlap > 0
    ? `${surplusOverlap} asset${surplusOverlap > 1 ? 's' : ''} from surplus positions`
    : 'No surplus-to-need transfers'

  return { needsAlignment: needsLabel, surplusMatch: surplusLabel, fitScore, details }
}

function computeTimingFit(ctx: TradeDecisionContextV1): {
  sideAWindow: string
  sideBWindow: string
  timingFit: string
  details: string[]
} {
  const details: string[] = []
  const tierLabels: Record<string, string> = {
    champion: 'Championship contender',
    contender: 'Playoff contender',
    middle: 'Mid-tier team',
    rebuild: 'Rebuilding',
  }

  const sideAWindow = tierLabels[ctx.sideA.contenderTier] || 'Unknown'
  const sideBWindow = tierLabels[ctx.sideB.contenderTier] || 'Unknown'

  details.push(`Side A: ${sideAWindow}`)
  details.push(`Side B: ${sideBWindow}`)

  const aYoungRatio = ctx.sideA.rosterComposition.youngAssetCount / Math.max(ctx.sideA.assets.length, 1)
  const bYoungRatio = ctx.sideB.rosterComposition.youngAssetCount / Math.max(ctx.sideB.assets.length, 1)

  const aIsContender = ctx.sideA.contenderTier === 'champion' || ctx.sideA.contenderTier === 'contender'
  const bIsContender = ctx.sideB.contenderTier === 'champion' || ctx.sideB.contenderTier === 'contender'
  const aIsRebuilder = ctx.sideA.contenderTier === 'rebuild'
  const bIsRebuilder = ctx.sideB.contenderTier === 'rebuild'

  const bAssetsYoungCount = ctx.sideB.assets.filter(a => a.age != null && a.age <= 25).length
  const aAssetsYoungCount = ctx.sideA.assets.filter(a => a.age != null && a.age <= 25).length
  const bAssetsPrimeCount = ctx.sideB.assets.filter(a => a.age != null && a.age >= 26 && a.age <= 30).length
  const aAssetsPrimeCount = ctx.sideA.assets.filter(a => a.age != null && a.age >= 26 && a.age <= 30).length

  let timingFit = 'Neutral'

  if (aIsContender && bIsRebuilder) {
    if (aAssetsPrimeCount < bAssetsPrimeCount && bAssetsYoungCount < aAssetsYoungCount) {
      timingFit = 'Excellent — contender gets win-now pieces, rebuilder gets youth'
      details.push('Classic contender-to-rebuilder swap aligns with both windows')
    } else {
      timingFit = 'Mixed — team directions favor a deal but assets may not align'
    }
  } else if (bIsContender && aIsRebuilder) {
    if (bAssetsPrimeCount < aAssetsPrimeCount && aAssetsYoungCount < bAssetsYoungCount) {
      timingFit = 'Excellent — contender gets win-now pieces, rebuilder gets youth'
      details.push('Classic contender-to-rebuilder swap aligns with both windows')
    } else {
      timingFit = 'Mixed — team directions favor a deal but assets may not align'
    }
  } else if (aIsContender && bIsContender) {
    timingFit = 'Both competing — could be win-win or zero-sum'
    details.push('Both teams in win-now mode — trade should improve both starting lineups')
  } else if (aIsRebuilder && bIsRebuilder) {
    timingFit = 'Both rebuilding — focus on dynasty asset accumulation'
    details.push('Both teams rebuilding — prioritize long-term upside')
  } else {
    timingFit = 'Neutral timing'
  }

  return { sideAWindow, sideBWindow, timingFit, details }
}

function computeViabilityBonus(
  rankings: RankingsImpact,
  injury: InjuryAdjustedValue,
  starter: StarterBenchDelta
): { bonus: number; signals: string[] } {
  let bonus = 0
  const signals: string[] = []

  if (rankings.sideARankDelta > 0.1 && rankings.sideBRankDelta > 0.1) {
    bonus += 8
    signals.push('Both teams project to improve in league standings')
  } else if (rankings.sideARankDelta > 0.1 || rankings.sideBRankDelta > 0.1) {
    bonus += 3
  }

  const discountDiff = Math.abs(injury.sideAInjuryDiscount - injury.sideBInjuryDiscount)
  if (discountDiff > 15) {
    bonus -= 5
    signals.push(`Significant injury exposure imbalance (${Math.round(discountDiff)}% gap)`)
  } else if (discountDiff > 5) {
    bonus -= 2
    signals.push('Moderate injury risk asymmetry between sides')
  }

  const absStarterDelta = Math.abs(starter.netStarterDelta)
  if (absStarterDelta < 200) {
    bonus += 5
    signals.push('Even starter-level talent exchange — balanced lineup impact')
  } else if (absStarterDelta > 1000) {
    bonus -= 3
    signals.push('Large gap in starter-caliber talent being exchanged')
  }

  return { bonus, signals }
}

function computeAcceptanceScore(ctx: TradeDecisionContextV1, partnerFitScore: number, viabilityBonus: { bonus: number; signals: string[] }): {
  score: number
  likelihood: ViabilityVerdict['acceptanceLikelihood']
  signals: string[]
} {
  let score = 50
  const signals: string[] = []

  const pctDiff = ctx.valueDelta.percentageDiff
  if (pctDiff <= 5) {
    score += 15
    signals.push('Very close in value — likely acceptable to both sides')
  } else if (pctDiff <= 10) {
    score += 10
    signals.push('Close enough in value that context could make it fair')
  } else if (pctDiff <= 20) {
    score -= 5
    signals.push('Noticeable value gap — may need sweetener or context justification')
  } else {
    score -= 20
    signals.push('Large value gap — unlikely to be accepted without major adjustments')
  }

  score += Math.round((partnerFitScore - 50) * 0.3)

  score += viabilityBonus.bonus
  signals.push(...viabilityBonus.signals)

  if (ctx.sideB.managerPreferences) {
    const prefs = ctx.sideB.managerPreferences
    if (pctDiff <= prefs.fairnessTolerance * 100) {
      score += 10
      signals.push('Within trade partner\'s historical fairness tolerance')
    }
    if (prefs.riskTolerance > 0.6 && ctx.sideA.riskMarkers.some(r => r.ageBucket === 'ascending')) {
      score += 5
      signals.push('Partner has shown willingness to take on upside risk')
    }
  } else {
    signals.push('No trade history available for partner — acceptance harder to predict')
  }

  const tradeFreq = ctx.tradeHistoryStats.leagueTradeFrequency
  if (tradeFreq === 'high') {
    score += 5
    signals.push('Active trading league — deals happen frequently')
  } else if (tradeFreq === 'low') {
    score -= 5
    signals.push('Low-activity league — managers may be resistant to trading')
  }

  score = Math.max(5, Math.min(95, score))

  let likelihood: ViabilityVerdict['acceptanceLikelihood']
  if (score >= 75) likelihood = 'Very Likely'
  else if (score >= 60) likelihood = 'Likely'
  else if (score >= 40) likelihood = 'Uncertain'
  else if (score >= 25) likelihood = 'Unlikely'
  else likelihood = 'Very Unlikely'

  return { score, likelihood, signals }
}

function buildActionPlan(
  gate: QualityGateResult,
  ctx: TradeDecisionContextV1,
  consensus: PeerReviewConsensus,
  acceptanceScore: number
): ActionPlan {
  const pctDiff = ctx.valueDelta.percentageDiff
  const favoredSide = ctx.valueDelta.favoredSide
  const isConditional = gate.conditionalRecommendation.isConditional

  let assessment: string
  let sendAsIs = false
  let adjustmentNeeded: string | null = null

  const isReviewMode = consensus.disagreement.reviewMode

  if (isConditional) {
    const caveat = gate.conditionalRecommendation.reasons[0] || 'key data is missing'
    assessment = `This recommendation is conditional — ${caveat}. Verify the missing information before acting on this analysis.`
    sendAsIs = false
    adjustmentNeeded = 'Confirm missing data (roster info, valuations, or injury status) before sending this trade'
  } else if (isReviewMode) {
    assessment = `Our AI models disagree on this trade — we recommend reviewing both perspectives before deciding. The value numbers are solid, but the strategic interpretation is split.`
    sendAsIs = false
    adjustmentNeeded = 'Wait for more data clarity or get input from leaguemates before sending'
  } else if (pctDiff <= 5) {
    assessment = 'This trade is close enough in value to send as-is. Both sides should feel good about this deal.'
    sendAsIs = true
  } else if (pctDiff <= 12) {
    assessment = `Slightly favors Side ${favoredSide} by ${pctDiff}%. Sendable as-is if roster fit is strong, but a small sweetener could seal the deal.`
    sendAsIs = acceptanceScore >= 60
    if (!sendAsIs) {
      adjustmentNeeded = `Consider adding a late-round pick or depth piece to balance the ${pctDiff}% gap`
    }
  } else if (pctDiff <= 20) {
    assessment = `Noticeable edge to Side ${favoredSide} (+${pctDiff}%). You\'ll likely need to adjust before sending.`
    sendAsIs = false
    adjustmentNeeded = `The ${pctDiff}% value gap needs to be narrowed — add assets to the lighter side or remove from the heavier side`
  } else {
    assessment = `This trade heavily favors Side ${favoredSide} (+${pctDiff}%). It will almost certainly be rejected as-is.`
    sendAsIs = false
    adjustmentNeeded = `Major restructuring needed — the ${pctDiff}% gap is too large for most managers to accept`
  }

  const counters: ActionPlan['counters'] = []
  for (const counter of gate.filteredCounters.slice(0, 2)) {
    counters.push({
      description: counter,
      rationale: 'AI-suggested alternative based on roster needs and value alignment',
    })
  }

  if (counters.length === 0 && pctDiff > 5) {
    if (favoredSide === 'A') {
      counters.push({
        description: `Side A could add a future pick to close the ${pctDiff}% gap`,
        rationale: 'Picks are the easiest way to bridge small value differences',
      })
    } else if (favoredSide === 'B') {
      counters.push({
        description: `Side B could add a future pick to close the ${pctDiff}% gap`,
        rationale: 'Picks are the easiest way to bridge small value differences',
      })
    }
  }

  let messageText: string
  if (sendAsIs) {
    messageText = `Hey, I've been looking at our rosters and I think this trade makes sense for both of us. ${
      ctx.sideA.needs.length > 0 ? `I could use help at ${ctx.sideA.needs.slice(0, 2).join('/')}` : 'It fills some gaps for me'
    }${
      ctx.sideB.needs.length > 0 ? ` and you look like you could use ${ctx.sideB.needs.slice(0, 2).join('/')} depth` : ''
    }. Let me know what you think!`
  } else if (pctDiff <= 15) {
    messageText = `Hey, I've been thinking about a deal. I know the numbers might not be perfectly even, but I think this trade helps both our rosters${
      ctx.sideB.needs.length > 0 ? ` — you get help at ${ctx.sideB.needs.slice(0, 2).join('/')}` : ''
    }. Would you be open to something like this? Happy to tweak it.`
  } else {
    messageText = `Hey, I wanted to float a trade idea to start a conversation. I know this might need some adjustments, but I think there's a deal to be made here${
      ctx.sideB.needs.length > 0 ? ` that addresses your ${ctx.sideB.needs.slice(0, 2).join('/')} needs` : ''
    }. What would make this work for you?`
  }

  return {
    bestOffer: { assessment, sendAsIs, adjustmentNeeded },
    counters,
    messageText,
  }
}

const TIER_RANK: Record<string, number> = {
  champion: 4,
  contender: 3,
  middle: 2,
  rebuild: 1,
}

const TIER_LABELS: Record<number, string> = {
  4: 'Championship contender',
  3: 'Playoff contender',
  2: 'Mid-tier team',
  1: 'Rebuilding',
}

function computeRankingsImpact(ctx: TradeDecisionContextV1): RankingsImpact {
  const details: string[] = []

  const aTier = TIER_RANK[ctx.sideA.contenderTier] ?? 2
  const bTier = TIER_RANK[ctx.sideB.contenderTier] ?? 2

  const aSSI = ctx.sideA.rosterComposition.starterStrengthIndex
  const bSSI = ctx.sideB.rosterComposition.starterStrengthIndex

  const competitorSSIs = ctx.competitors.map(c => c.starterStrengthIndex)
  const leagueAvgSSI = competitorSSIs.length > 0
    ? competitorSSIs.reduce((s, v) => s + v, 0) / competitorSSIs.length
    : (aSSI + bSSI) / 2

  const aAssetsAvgValue = ctx.sideA.assets.length > 0
    ? ctx.sideA.assets.reduce((s, a) => s + a.marketValue, 0) / ctx.sideA.assets.length
    : 0
  const bAssetsAvgValue = ctx.sideB.assets.length > 0
    ? ctx.sideB.assets.reduce((s, a) => s + a.marketValue, 0) / ctx.sideB.assets.length
    : 0

  const sideAValueShift = (bAssetsAvgValue - aAssetsAvgValue) / Math.max(leagueAvgSSI, 1)
  const sideBValueShift = (aAssetsAvgValue - bAssetsAvgValue) / Math.max(leagueAvgSSI, 1)

  const aIsContender = aTier >= 3
  const bIsContender = bTier >= 3
  const aIsRebuilder = aTier <= 1
  const bIsRebuilder = bTier <= 1

  const aYouthReceived = ctx.sideB.assets.filter(a => a.age !== null && a.age <= 25).length
  const bYouthReceived = ctx.sideA.assets.filter(a => a.age !== null && a.age <= 25).length
  const aPrimeReceived = ctx.sideB.assets.filter(a => a.age !== null && a.age >= 26 && a.age <= 30).length
  const bPrimeReceived = ctx.sideA.assets.filter(a => a.age !== null && a.age >= 26 && a.age <= 30).length

  let aDirectionBonus = 0
  let bDirectionBonus = 0
  if (aIsContender && aPrimeReceived > 0) {
    aDirectionBonus = aPrimeReceived * 0.15
    details.push(`Side A (contender) acquires ${aPrimeReceived} prime-age asset${aPrimeReceived > 1 ? 's' : ''} — strengthens win-now window`)
  }
  if (aIsRebuilder && aYouthReceived > 0) {
    aDirectionBonus = aYouthReceived * 0.12
    details.push(`Side A (rebuilder) acquires ${aYouthReceived} young asset${aYouthReceived > 1 ? 's' : ''} — aligns with rebuild`)
  }
  if (bIsContender && bPrimeReceived > 0) {
    bDirectionBonus = bPrimeReceived * 0.15
    details.push(`Side B (contender) acquires ${bPrimeReceived} prime-age asset${bPrimeReceived > 1 ? 's' : ''} — strengthens win-now window`)
  }
  if (bIsRebuilder && bYouthReceived > 0) {
    bDirectionBonus = bYouthReceived * 0.12
    details.push(`Side B (rebuilder) acquires ${bYouthReceived} young asset${bYouthReceived > 1 ? 's' : ''} — aligns with rebuild`)
  }

  if (aIsContender && aYouthReceived > aPrimeReceived && aPrimeReceived === 0) {
    aDirectionBonus -= 0.1
    details.push('Side A (contender) receiving mostly youth — may not help this season')
  }
  if (bIsContender && bYouthReceived > bPrimeReceived && bPrimeReceived === 0) {
    bDirectionBonus -= 0.1
    details.push('Side B (contender) receiving mostly youth — may not help this season')
  }

  const sideARankDelta = Math.round((sideAValueShift + aDirectionBonus) * 100) / 100
  const sideBRankDelta = Math.round((sideBValueShift + bDirectionBonus) * 100) / 100

  const aNewTier = Math.max(1, Math.min(4, Math.round(aTier + sideARankDelta)))
  const bNewTier = Math.max(1, Math.min(4, Math.round(bTier + sideBRankDelta)))

  const sideAProjectedTier = TIER_LABELS[aNewTier] || 'Mid-tier team'
  const sideBProjectedTier = TIER_LABELS[bNewTier] || 'Mid-tier team'

  if (aNewTier !== aTier) {
    details.push(`Side A projected tier shift: ${TIER_LABELS[aTier]} → ${sideAProjectedTier}`)
  }
  if (bNewTier !== bTier) {
    details.push(`Side B projected tier shift: ${TIER_LABELS[bTier]} → ${sideBProjectedTier}`)
  }

  let leaguePositionSignal: string
  if (sideARankDelta > 0.1 && sideBRankDelta > 0.1) {
    leaguePositionSignal = 'Both teams improve their league standing — win-win trade'
  } else if (sideARankDelta > 0.1 && sideBRankDelta < -0.1) {
    leaguePositionSignal = 'Side A improves, Side B weakens in league standings'
  } else if (sideBRankDelta > 0.1 && sideARankDelta < -0.1) {
    leaguePositionSignal = 'Side B improves, Side A weakens in league standings'
  } else {
    leaguePositionSignal = 'Minimal shift in league standings for both sides'
  }

  return { sideARankDelta, sideBRankDelta, sideAProjectedTier, sideBProjectedTier, leaguePositionSignal, details }
}

const INJURY_DISCOUNT: Record<string, number> = {
  Out: 0.90,
  IR: 0.85,
  Doubtful: 0.70,
  Questionable: 0.35,
  Probable: 0.10,
  'Day-to-Day': 0.20,
}

const REINJURY_MULTIPLIER: Record<string, number> = {
  high: 1.5,
  moderate: 1.2,
  low: 1.0,
  unknown: 1.1,
}

function computeInjuryAdjustedReplacementValue(ctx: TradeDecisionContextV1): InjuryAdjustedValue {
  const details: string[] = []

  function discountAssets(assets: AssetValuation[], riskMarkers: PlayerRiskMarker[]): {
    healthyTotal: number
    adjustedTotal: number
    discountPct: number
  } {
    const riskByName = new Map(riskMarkers.map(r => [r.playerName, r]))
    let healthyTotal = 0
    let adjustedTotal = 0

    for (const asset of assets) {
      const mv = asset.marketValue
      healthyTotal += mv

      const risk = riskByName.get(asset.name)
      if (!risk?.injuryStatus) {
        adjustedTotal += mv
        continue
      }

      const status = risk.injuryStatus.status
      const baseDiscount = INJURY_DISCOUNT[status] ?? 0
      const reinjury = risk.injuryStatus.reinjuryRisk
      const multiplier = REINJURY_MULTIPLIER[reinjury] ?? 1.0

      const finalDiscount = Math.min(0.95, baseDiscount * multiplier)
      const adjustedValue = mv * (1 - finalDiscount)
      adjustedTotal += adjustedValue

      if (finalDiscount >= 0.30) {
        details.push(`${asset.name} (${status}, ${reinjury} reinjury risk): value discounted ${Math.round(finalDiscount * 100)}%`)
      }
    }

    const discountPct = healthyTotal > 0
      ? Math.round((1 - adjustedTotal / healthyTotal) * 1000) / 10
      : 0

    return { healthyTotal, adjustedTotal, discountPct }
  }

  const sideA = discountAssets(ctx.sideA.assets, ctx.sideA.riskMarkers)
  const sideB = discountAssets(ctx.sideB.assets, ctx.sideB.riskMarkers)

  let netInjuryExposureShift: string
  const aDiscountPct = sideA.discountPct
  const bDiscountPct = sideB.discountPct

  if (Math.abs(aDiscountPct - bDiscountPct) < 2) {
    netInjuryExposureShift = 'Similar injury risk on both sides'
  } else if (aDiscountPct > bDiscountPct) {
    netInjuryExposureShift = `Side A sending riskier assets — Side B takes on ${Math.round(aDiscountPct - bDiscountPct)}% more injury exposure`
    details.push(`Side A assets carry ${aDiscountPct}% injury discount vs Side B at ${bDiscountPct}%`)
  } else {
    netInjuryExposureShift = `Side B sending riskier assets — Side A takes on ${Math.round(bDiscountPct - aDiscountPct)}% more injury exposure`
    details.push(`Side B assets carry ${bDiscountPct}% injury discount vs Side A at ${aDiscountPct}%`)
  }

  if (ctx.missingData.injuryDataStale) {
    details.push('Injury data may be stale — injury-adjusted values are approximate')
  }

  return {
    sideAHealthyValue: sideA.healthyTotal,
    sideBHealthyValue: sideB.healthyTotal,
    sideAAdjustedValue: Math.round(sideA.adjustedTotal),
    sideBAdjustedValue: Math.round(sideB.adjustedTotal),
    sideAInjuryDiscount: aDiscountPct,
    sideBInjuryDiscount: bDiscountPct,
    netInjuryExposureShift,
    details,
  }
}

const POSITION_SCARCITY: Record<string, number> = {
  QB: 0.95, RB: 0.80, WR: 0.70, TE: 0.85, K: 0.30, DEF: 0.30, DL: 0.50, LB: 0.55, DB: 0.50,
}

function estimateStarterLikelihood(asset: AssetValuation): number {
  if (asset.type !== 'PLAYER') {
    const roundGuess = asset.position.includes('1') ? 1 : asset.position.includes('2') ? 2 : 3
    return roundGuess === 1 ? 0.75 : roundGuess === 2 ? 0.40 : 0.15
  }

  const pos = asset.position.toUpperCase()
  const mv = asset.marketValue
  if (mv <= 0) return 0

  const scarcity = POSITION_SCARCITY[pos] ?? 0.65
  const maxMarket = pos === 'QB' ? 10000 : pos === 'RB' ? 9000 : pos === 'WR' ? 8500 : 5000
  const tierPercentile = Math.min(1, mv / maxMarket)

  if (tierPercentile >= 0.70) return 1.0 * scarcity + 0.35 * (1 - scarcity)
  if (tierPercentile >= 0.40) return 0.70 * scarcity + 0.20 * (1 - scarcity)
  if (tierPercentile >= 0.20) return 0.35 * scarcity + 0.10 * (1 - scarcity)
  return 0.10
}

function computeStarterBenchDelta(ctx: TradeDecisionContextV1): StarterBenchDelta {
  const details: string[] = []
  const starterThreshold = 0.50

  function splitAssets(assets: AssetValuation[]): { starterValue: number; benchValue: number; starterNames: string[]; benchNames: string[] } {
    let starterValue = 0
    let benchValue = 0
    const starterNames: string[] = []
    const benchNames: string[] = []

    for (const asset of assets) {
      const likelihood = estimateStarterLikelihood(asset)
      if (likelihood >= starterThreshold) {
        starterValue += asset.marketValue * likelihood
        starterNames.push(asset.name)
      } else {
        benchValue += asset.marketValue
        benchNames.push(asset.name)
      }
    }

    return { starterValue: Math.round(starterValue), benchValue: Math.round(benchValue), starterNames, benchNames }
  }

  const sideA = splitAssets(ctx.sideA.assets)
  const sideB = splitAssets(ctx.sideB.assets)

  if (sideA.starterNames.length > 0) {
    details.push(`Side A sends ${sideA.starterNames.length} starter-caliber asset${sideA.starterNames.length > 1 ? 's' : ''}: ${sideA.starterNames.slice(0, 3).join(', ')}`)
  }
  if (sideB.starterNames.length > 0) {
    details.push(`Side B sends ${sideB.starterNames.length} starter-caliber asset${sideB.starterNames.length > 1 ? 's' : ''}: ${sideB.starterNames.slice(0, 3).join(', ')}`)
  }
  if (sideA.benchNames.length > 0) {
    details.push(`Side A sends ${sideA.benchNames.length} bench/depth piece${sideA.benchNames.length > 1 ? 's' : ''}`)
  }
  if (sideB.benchNames.length > 0) {
    details.push(`Side B sends ${sideB.benchNames.length} bench/depth piece${sideB.benchNames.length > 1 ? 's' : ''}`)
  }

  const netStarterDelta = sideB.starterValue - sideA.starterValue

  let starterImpactLabel: string
  const absDelta = Math.abs(netStarterDelta)
  if (absDelta < 200) {
    starterImpactLabel = 'Even starter-level exchange'
  } else if (netStarterDelta > 0) {
    starterImpactLabel = `Side A gains net starter value (+${absDelta})`
  } else {
    starterImpactLabel = `Side B gains net starter value (+${absDelta})`
  }

  const totalStarterMoving = sideA.starterValue + sideB.starterValue
  const totalBenchMoving = sideA.benchValue + sideB.benchValue
  if (totalStarterMoving > 0 && totalBenchMoving === 0) {
    details.push('Pure starter-for-starter swap — high lineup impact on both sides')
  } else if (totalStarterMoving === 0 && totalBenchMoving > 0) {
    details.push('Bench-piece exchange — minimal starting lineup impact')
  }

  return {
    sideAStarterImpact: sideA.starterValue,
    sideBStarterImpact: sideB.starterValue,
    sideABenchValue: sideA.benchValue,
    sideBBenchValue: sideB.benchValue,
    netStarterDelta,
    starterImpactLabel,
    details,
  }
}

function computeDeterministicConfidence(ctx: TradeDecisionContextV1): number {
  let confidence = 80

  const coverage = ctx.dataQuality.coveragePercent
  if (coverage >= 90) confidence += 10
  else if (coverage >= 70) confidence += 5
  else if (coverage < 50) confidence -= 15

  if (ctx.missingData.valuationsMissing.length > 0) {
    confidence -= Math.min(20, ctx.missingData.valuationsMissing.length * 5)
  }
  if (ctx.missingData.injuryDataStale) confidence -= 5
  if (ctx.missingData.adpDataStale) confidence -= 3
  if (ctx.missingData.competitorDataUnavailable) confidence -= 5

  const pctDiff = ctx.valueDelta.percentageDiff
  if (pctDiff <= 5) confidence += 5
  else if (pctDiff >= 25) confidence -= 5

  return Math.max(15, Math.min(95, confidence))
}

function buildDeterministicDrivers(
  ctx: TradeDecisionContextV1,
  rankingsImpact: RankingsImpact,
  injuryAdjusted: InjuryAdjustedValue,
  starterBench: StarterBenchDelta,
  partnerFit: ReturnType<typeof computeNeedsAlignment>,
  timing: ReturnType<typeof computeTimingFit>,
): DeterministicDriver[] {
  const drivers: DeterministicDriver[] = []
  const pctDiff = ctx.valueDelta.percentageDiff
  const favored = ctx.valueDelta.favoredSide

  if (pctDiff <= 3) {
    drivers.push({ label: 'Value Gap', value: `${pctDiff}% — Dead even`, impact: 'positive', category: 'value' })
  } else if (pctDiff <= 10) {
    drivers.push({ label: 'Value Gap', value: `${pctDiff}% edge to Side ${favored}`, impact: 'neutral', category: 'value' })
  } else {
    drivers.push({ label: 'Value Gap', value: `${pctDiff}% edge to Side ${favored}`, impact: 'negative', category: 'value' })
  }

  if (starterBench.netStarterDelta !== 0) {
    const absDelta = Math.abs(starterBench.netStarterDelta)
    const gainSide = starterBench.netStarterDelta > 0 ? 'A' : 'B'
    drivers.push({
      label: 'Starter Impact',
      value: absDelta < 200 ? 'Even starter exchange' : `Side ${gainSide} gains +${absDelta} starter value`,
      impact: absDelta < 200 ? 'neutral' : (absDelta > 1000 ? 'negative' : 'neutral'),
      category: 'roster',
    })
  }

  if (partnerFit.fitScore >= 70) {
    drivers.push({ label: 'Roster Fit', value: `${partnerFit.fitScore}/100 — ${partnerFit.needsAlignment}`, impact: 'positive', category: 'roster' })
  } else if (partnerFit.fitScore <= 40) {
    drivers.push({ label: 'Roster Fit', value: `${partnerFit.fitScore}/100 — ${partnerFit.needsAlignment}`, impact: 'negative', category: 'roster' })
  } else {
    drivers.push({ label: 'Roster Fit', value: `${partnerFit.fitScore}/100`, impact: 'neutral', category: 'roster' })
  }

  drivers.push({
    label: 'Timing Alignment',
    value: timing.timingFit,
    impact: timing.timingFit.startsWith('Excellent') ? 'positive' : timing.timingFit.startsWith('Both competing') || timing.timingFit === 'Neutral timing' ? 'neutral' : 'negative',
    category: 'timing',
  })

  const injuryDiff = Math.abs(injuryAdjusted.sideAInjuryDiscount - injuryAdjusted.sideBInjuryDiscount)
  if (injuryDiff > 5) {
    drivers.push({
      label: 'Injury Risk Gap',
      value: `${Math.round(injuryDiff)}% asymmetry`,
      impact: injuryDiff > 15 ? 'negative' : 'neutral',
      category: 'risk',
    })
  }

  if (rankingsImpact.sideARankDelta > 0.1 && rankingsImpact.sideBRankDelta > 0.1) {
    drivers.push({ label: 'League Impact', value: 'Both teams improve standings', impact: 'positive', category: 'viability' })
  } else if (rankingsImpact.sideARankDelta < -0.1 || rankingsImpact.sideBRankDelta < -0.1) {
    const weakened = rankingsImpact.sideARankDelta < -0.1 ? 'A' : 'B'
    drivers.push({ label: 'League Impact', value: `Side ${weakened} weakens in standings`, impact: 'negative', category: 'viability' })
  }

  return drivers
}

export function computeDeterministicVerdict(ctx: TradeDecisionContextV1): {
  verdict: DeterministicVerdict
  intermediates: {
    partnerFit: ReturnType<typeof computeNeedsAlignment>
    timing: ReturnType<typeof computeTimingFit>
    rankingsImpact: RankingsImpact
    injuryAdjusted: InjuryAdjustedValue
    starterBench: StarterBenchDelta
    acceptanceResult: { score: number; likelihood: DeterministicVerdict['acceptanceLikelihood']; signals: string[] }
  }
} {
  const partnerFit = computeNeedsAlignment(ctx)
  const timing = computeTimingFit(ctx)
  const rankingsImpact = computeRankingsImpact(ctx)
  const injuryAdjusted = computeInjuryAdjustedReplacementValue(ctx)
  const starterBench = computeStarterBenchDelta(ctx)
  const viabilityBonus = computeViabilityBonus(rankingsImpact, injuryAdjusted, starterBench)
  const acceptanceResult = computeAcceptanceScore(ctx, partnerFit.fitScore, viabilityBonus)

  const pctDiff = ctx.valueDelta.percentageDiff
  const favored = ctx.valueDelta.favoredSide
  const noSignal = verdictHasNoSignal(ctx)
  const winner = pctDiff <= 3 ? 'Even' as const : favored
  const grade: FairnessGrade = noSignal ? 'N/A' : computeFairnessGrade(pctDiff)
  const vetoRisk = computeVetoRisk(pctDiff)

  const fairnessScore = noSignal ? null : Math.max(0, Math.min(100, 100 - pctDiff * 2.5))
  const confidence = computeDeterministicConfidence(ctx)

  const injuryRiskDelta = Math.round((injuryAdjusted.sideAInjuryDiscount - injuryAdjusted.sideBInjuryDiscount) * 10) / 10

  const keyDrivers = buildDeterministicDrivers(ctx, rankingsImpact, injuryAdjusted, starterBench, partnerFit, timing)

  let winnerLabel: string
  if (noSignal) {
    winnerLabel = `Not graded — none of the ${ctx.dataQuality.assetsTotal} assets in this trade could be valued`
  } else if (winner === 'Even') {
    winnerLabel = 'Dead even — both sides get fair value'
  } else {
    winnerLabel = `Side ${winner} gets the better end by ${pctDiff}%`
  }

  const verdict: DeterministicVerdict = {
    winner,
    winnerLabel,
    fairnessGrade: grade,
    fairnessScore: fairnessScore == null ? null : Math.round(fairnessScore),
    netValueDelta: ctx.valueDelta.absoluteDiff,
    netValueDeltaPct: pctDiff,
    acceptanceProbability: acceptanceResult.score,
    acceptanceLikelihood: acceptanceResult.likelihood,
    vetoRisk,
    confidence,
    keyDrivers,
    sideATotalValue: ctx.sideA.totalValue,
    sideBTotalValue: ctx.sideB.totalValue,
    sideANetStarterDelta: starterBench.sideAStarterImpact,
    sideBNetStarterDelta: starterBench.sideBStarterImpact,
    injuryRiskDelta,
    source: 'deterministic-engine',
  }

  return {
    verdict,
    intermediates: { partnerFit, timing, rankingsImpact, injuryAdjusted, starterBench, acceptanceResult },
  }
}

export function formatTradeResponse(
  consensus: PeerReviewConsensus,
  ctx: TradeDecisionContextV1,
  gate: QualityGateResult,
  options?: { isotonicApplied?: boolean; rawAcceptProbability?: number }
): FormattedTradeResponse {
  const { verdict: detVerdict, intermediates } = computeDeterministicVerdict(ctx)
  const { partnerFit, timing, rankingsImpact, injuryAdjusted: injuryAdjustedValue, starterBench: starterBenchDelta, acceptanceResult } = intermediates
  const { score: acceptanceScore, likelihood, signals } = acceptanceResult

  const leagueFreq = ctx.tradeHistoryStats.leagueTradeFrequency
  const leagueActivity = leagueFreq === 'high'
    ? `Active league (${ctx.tradeHistoryStats.totalTrades} trades, ${ctx.tradeHistoryStats.recentTrades} in last 30 days)`
    : leagueFreq === 'medium'
    ? `Moderate activity (${ctx.tradeHistoryStats.totalTrades} trades total)`
    : `Low activity league (${ctx.tradeHistoryStats.totalTrades} trades total)`

  const staleSources: string[] = []
  if (ctx.missingData.valuationDataStale) staleSources.push('Valuations')
  if (ctx.missingData.adpDataStale) staleSources.push('ADP')
  if (ctx.missingData.injuryDataStale) staleSources.push('Injuries')
  if (ctx.missingData.analyticsDataStale) staleSources.push('Analytics')
  if (ctx.missingData.tradeHistoryStale) staleSources.push('Trade History')

  const warnings = [...gate.filteredWarnings]
  if (staleSources.length > 0) {
    warnings.push(`Data freshness notice: ${staleSources.join(', ')} may be outdated`)
  }

  return {
    deterministicVerdict: detVerdict,
    valueVerdict: {
      fairnessGrade: verdictHasNoSignal(ctx) ? 'N/A' : computeFairnessGrade(ctx.valueDelta.percentageDiff),
      edge: computeEdgeLabel(ctx),
      edgeSide: ctx.valueDelta.favoredSide,
      valueDeltaPercent: ctx.valueDelta.percentageDiff,
      valueDeltaAbsolute: ctx.valueDelta.absoluteDiff,
      sideATotalValue: ctx.sideA.totalValue,
      sideBTotalValue: ctx.sideB.totalValue,
      confidence: gate.adjustedConfidence,
      deterministicConfidence: gate.deterministicConfidence,
      vetoRisk: computeVetoRisk(ctx.valueDelta.percentageDiff),
      reasons: gate.filteredReasons,
      warnings,
      ...(() => {
        const codes = [...(consensus.meta.disagreementCodes || [])]
        let details = consensus.meta.disagreementDetails || ''
        if (staleSources.length >= 2 && !codes.includes('data_quality_concern')) {
          codes.push('data_quality_concern')
          details = details
            ? `${details} ${staleSources.length} data sources are stale, which may affect analysis reliability.`
            : `${staleSources.length} data sources are stale, which may affect analysis reliability.`
        }
        return codes.length > 0 ? { disagreementCodes: codes, disagreementDetails: details } : {}
      })(),
      dataFreshness: {
        staleSourceCount: staleSources.length,
        staleSources,
      },
      dataCoverage: {
        tier: gate.dataCoverage.tier,
        score: gate.dataCoverage.score,
        badge: gate.dataCoverage.badge,
        dimensions: gate.dataCoverage.dimensions,
      },
      recommendationType: gate.conditionalRecommendation,
      disagreement: consensus.disagreement,
    },
    viabilityVerdict: {
      acceptanceLikelihood: likelihood,
      acceptanceScore,
      partnerFit,
      timing,
      rankingsImpact,
      injuryAdjustedValue,
      starterBenchDelta,
      leagueActivity,
      signals,
      calibration: options?.isotonicApplied ? {
        isotonicApplied: true,
        rawAcceptProbability: options.rawAcceptProbability,
      } : undefined,
    },
    actionPlan: buildActionPlan(gate, ctx, consensus, acceptanceScore),
  }
}
