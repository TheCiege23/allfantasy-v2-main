const BASE_PICK_VALUE: Record<string, number> = {
  "1st": 100,
  "2nd": 65,
  "3rd": 40,
  "4th": 20,
  "5th+": 10
}

const TIME_MULTIPLIER_BY_YEARS_OUT: Record<number, number> = {
  0: 1.00,
  1: 0.92,
  2: 0.85,
  3: 0.80
}

const TIME_FLOOR = 0.75

const TIER_UPGRADE_BONUS: Record<number, number> = {
  1: 20,
  2: 35,
  3: 50
}

const MAX_TIME_PENALTY_ON_UPGRADE = 0.08

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

function roundToKey(round: number): string {
  if (round === 1) return "1st"
  if (round === 2) return "2nd"
  if (round === 3) return "3rd"
  if (round === 4) return "4th"
  return "5th+"
}

function rookieFeverMultiplier(daysToDraft: number | null): number {
  if (daysToDraft === null) return 1.00
  if (daysToDraft <= 30) return 1.06
  if (daysToDraft <= 90) return 1.03
  return 1.00
}

export function pickValue(
  pickRound: number, 
  pickYear: number, 
  currentYear: number, 
  daysToDraftForPickYear: number | null = null,
  classStrength: number | null = null,
): number {
  const base = BASE_PICK_VALUE[roundToKey(pickRound)] || 10
  const yearsOut = pickYear - currentYear

  let timeMult = TIME_MULTIPLIER_BY_YEARS_OUT[yearsOut] ?? TIME_FLOOR
  timeMult = clamp(timeMult, TIME_FLOOR, 1.00)

  const feverMult = rookieFeverMultiplier(daysToDraftForPickYear)

  let value = base * timeMult * feverMult

  if (classStrength !== null && classStrength > 0) {
    value *= (classStrength / 80)
  }

  return value
}

export function computeClassStrength(players: any[]): number {
  // Unscored prospects are EXCLUDED, not counted as 50. Defaulting them to
  // average let a class of players we know nothing about report "average
  // strength", which is a claim; averaging only the scored ones at least
  // describes the players we can actually see.
  const topProspects = players
    .filter((p: any) => p.projectedDraftRound === 1)
    .map((p: any) => p.draftProjectionScore)
    .filter((s: unknown): s is number => typeof s === 'number' && Number.isFinite(s))

  if (topProspects.length === 0) return 50

  const avg = topProspects.reduce((a: number, b: number) => a + b, 0) / topProspects.length

  return Math.round(avg)
}

export function computeClassDepthByPosition(players: any[]): { qbDepth: number; rbDepth: number; wrDepth: number; teDepth: number } {
  const byPos = { QB: [] as number[], RB: [] as number[], WR: [] as number[], TE: [] as number[] }

  for (const p of players) {
    const pos = (p.position || '').toUpperCase()
    const score = p.draftProjectionScore
    // Same rule as computeClassStrength: an unscored player contributes
    // nothing rather than contributing a phantom average.
    if (byPos[pos as keyof typeof byPos] && typeof score === 'number' && Number.isFinite(score)) {
      byPos[pos as keyof typeof byPos].push(score)
    }
  }

  const depthScore = (scores: number[]) => {
    if (scores.length === 0) return 40
    const top = scores.sort((a, b) => b - a).slice(0, 5)
    return Math.round(top.reduce((a, b) => a + b, 0) / top.length)
  }

  return {
    qbDepth: depthScore(byPos.QB),
    rbDepth: depthScore(byPos.RB),
    wrDepth: depthScore(byPos.WR),
    teDepth: depthScore(byPos.TE),
  }
}

function pickTier(round: number): number {
  if (round === 1) return 1
  if (round === 2) return 2
  if (round === 3) return 3
  if (round === 4) return 4
  return 5
}

export interface TradeAsset {
  type: 'pick' | 'player'
  round?: number
  year?: number
  daysToDraft?: number | null
  playerValue?: number
  playerName?: string
}

interface TierOverrideResult {
  bonus: number
  timePenaltyCapApplied: boolean
}

export function applyTierJumpOverride(
  outgoingAssets: TradeAsset[], 
  incomingAssets: TradeAsset[], 
  currentYear: number
): TierOverrideResult {
  const outgoingPicks = outgoingAssets.filter(a => a.type === 'pick' && a.round)
  const incomingPicks = incomingAssets.filter(a => a.type === 'pick' && a.round)

  if (outgoingPicks.length === 0 || incomingPicks.length === 0) {
    return { bonus: 0, timePenaltyCapApplied: false }
  }

  const bestOutgoingTier = Math.min(...outgoingPicks.map(a => pickTier(a.round!)))
  const bestIncomingTier = Math.min(...incomingPicks.map(a => pickTier(a.round!)))

  const tierDelta = bestOutgoingTier - bestIncomingTier
  if (tierDelta <= 0) {
    return { bonus: 0, timePenaltyCapApplied: false }
  }

  const bonus = TIER_UPGRADE_BONUS[tierDelta] ?? TIER_UPGRADE_BONUS[3]

  return { bonus, timePenaltyCapApplied: true }
}

export function sideTotalValue(assets: TradeAsset[], currentYear: number, classStrengthByYear?: Record<number, number>): number {
  let total = 0
  for (const a of assets) {
    if (a.type === 'pick' && a.round && a.year) {
      const cs = classStrengthByYear?.[a.year] ?? null
      total += pickValue(a.round, a.year, currentYear, a.daysToDraft ?? null, cs)
    } else if (a.type === 'player' && a.playerValue) {
      total += a.playerValue
    }
  }
  return total
}

export function recomputeIncomingPicksWithTimeCap(
  assets: TradeAsset[], 
  currentYear: number, 
  capPenalty: number
): number {
  const minMult = 1.00 - capPenalty
  let total = 0
  
  for (const a of assets) {
    if (a.type === 'pick' && a.round && a.year) {
      const base = BASE_PICK_VALUE[roundToKey(a.round)] || 10
      const yearsOut = a.year - currentYear
      let timeMult = TIME_MULTIPLIER_BY_YEARS_OUT[yearsOut] ?? TIME_FLOOR
      timeMult = clamp(timeMult, Math.max(minMult, TIME_FLOOR), 1.00)
      total += base * timeMult * rookieFeverMultiplier(a.daysToDraft ?? null)
    } else if (a.type === 'player' && a.playerValue) {
      total += a.playerValue
    }
  }
  return total
}

export function tradeScore(sideValueGet: number, sideValueGive: number): number {
  if (sideValueGive <= 0) return 50
  const ratio = sideValueGet / sideValueGive

  const SCALE = 0.20
  const x = (ratio - 1.0) / SCALE
  const score = 50 + 50 * Math.tanh(x)

  return clamp(score, 0, 100)
}

export function letterGrade(score: number): string {
  if (score >= 85) return "A"
  if (score >= 70) return "B"
  if (score >= 58) return "C"
  if (score >= 45) return "D"
  return "F"
}

export function processLabel(score: number, tierUpgradeApplied: boolean, isLowStakes: boolean): string {
  if (isLowStakes) {
    if (score >= 60) return "Process Win"
    if (score <= 40) return "Process Loss"
    return "Neutral Process"
  }

  if (tierUpgradeApplied && score >= 52) return "Process Win"
  if (score >= 60) return "Process Win"
  if (score <= 40) return "Process Loss"
  return "Neutral Process"
}

export function timingLabel(outgoingAssets: TradeAsset[], incomingAssets: TradeAsset[], currentYear: number): string {
  const incomingPicks = incomingAssets.filter(a => a.type === 'pick' && a.year)
  const outgoingPicks = outgoingAssets.filter(a => a.type === 'pick' && a.year)

  const avgIncoming = incomingPicks.length > 0 
    ? incomingPicks.reduce((sum, a) => sum + (a.year! - currentYear), 0) / incomingPicks.length 
    : 0
  const avgOutgoing = outgoingPicks.length > 0 
    ? outgoingPicks.reduce((sum, a) => sum + (a.year! - currentYear), 0) / outgoingPicks.length 
    : 0

  const delta = avgOutgoing - avgIncoming

  if (delta >= 0.6) return "Immediate Gain"
  if (delta <= -0.6) return "Timing Loss"
  return "Delayed Gain"
}

export function tradeMagnitude(outgoingValue: number, incomingValue: number): number {
  return outgoingValue + incomingValue
}

export function lowStakesFlag(magnitude: number): boolean {
  return magnitude < 60
}

interface ConfidenceInputs {
  magnitude: number
  missingDataCount: number
  nearEven: boolean
}

export function confidenceScore(inputs: ConfidenceInputs): number {
  const { magnitude, missingDataCount, nearEven } = inputs

  let magConf = clamp((magnitude - 40) / 160, 0.2, 0.9)

  const missingPenalty = 0.08 * missingDataCount
  const nearEvenPenalty = nearEven ? 0.10 : 0.00

  const conf = magConf - missingPenalty - nearEvenPenalty
  return clamp(conf, 0.15, 0.95)
}

export function compressScore(score: number, confidence: number): number {
  const weight = confidence
  return 50 + (score - 50) * weight
}

export function confidenceLabel(confidence: number, isLowStakes: boolean): string {
  if (isLowStakes && confidence < 0.55) return "Low confidence / Low stakes"
  if (confidence >= 0.75) return "High confidence"
  if (confidence >= 0.55) return "Medium confidence"
  return "Low confidence"
}

export function adjustedLetterGrade(score: number, confidence: number, isLowStakes: boolean): string {
  if (isLowStakes && confidence < 0.55) {
    if (score >= 62) return "B"
    if (score <= 38) return "D"
    return "C"
  }
  return letterGrade(score)
}

export interface WhyTooltipPayload {
  headline: string
  bullets: string[]
  math: {
    outgoingValue: number
    incomingValue: number
    delta: number
    ratio: number
    score: number
  }
  flags: {
    tierOverrideApplied: boolean
    lowStakesTrade: boolean
    futurePickDiscountApplied: boolean
  }
}

interface TooltipContext {
  headline: string
  outgoingValue: number
  incomingValue: number
  score: number
  tierOverrideApplied: boolean
  isLowStakes: boolean
  futureDiscountUsed: boolean
  tierDelta?: number
  yearsOut?: number
}

export function buildWhyTooltipPayload(context: TooltipContext): WhyTooltipPayload {
  const bullets: string[] = []
  
  if (context.tierOverrideApplied && context.tierDelta) {
    bullets.push(`You moved up ${context.tierDelta} tier(s) (meaningful hit-rate jump).`)
  }
  
  if (context.yearsOut && context.yearsOut > 0) {
    bullets.push(`You pushed the asset out ${context.yearsOut} year(s) (small discount applied).`)
  }
  
  const delta = context.incomingValue - context.outgoingValue
  bullets.push(`Net value: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} points after aging curve.`)
  
  bullets.push(
    context.tierOverrideApplied
      ? "Tier Jump Override applied: capped time penalty and added tier bonus."
      : "No tier override needed."
  )

  return {
    headline: context.headline,
    bullets,
    math: {
      outgoingValue: Math.round(context.outgoingValue * 10) / 10,
      incomingValue: Math.round(context.incomingValue * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      ratio: Math.round((context.incomingValue / Math.max(context.outgoingValue, 1)) * 1000) / 1000,
      score: Math.round(context.score)
    },
    flags: {
      tierOverrideApplied: context.tierOverrideApplied,
      lowStakesTrade: context.isLowStakes,
      futurePickDiscountApplied: context.futureDiscountUsed
    }
  }
}

export interface TradeAnalysisResult {
  score: number
  grade: string
  verdict: string
  confidence: number
  confidenceLabel: string
  whyTooltip: WhyTooltipPayload
  rawValues: {
    outgoing: number
    incoming: number
  }
}

interface AnalyzeTradeMeta {
  missingDataCount?: number
}

export function analyzeTrade(
  sideA_out: TradeAsset[], 
  sideA_in: TradeAsset[], 
  currentYear: number, 
  meta: AnalyzeTradeMeta = {}
): TradeAnalysisResult {
  let A_out_val = sideTotalValue(sideA_out, currentYear)
  let A_in_val = sideTotalValue(sideA_in, currentYear)

  const override = applyTierJumpOverride(sideA_out, sideA_in, currentYear)
  if (override.timePenaltyCapApplied) {
    A_in_val = recomputeIncomingPicksWithTimeCap(sideA_in, currentYear, MAX_TIME_PENALTY_ON_UPGRADE)
  }
  A_in_val += override.bonus

  const rawScore = tradeScore(A_in_val, A_out_val)

  const magnitude = tradeMagnitude(A_out_val, A_in_val)
  const isLowStakes = lowStakesFlag(magnitude)

  const missingDataCount = meta.missingDataCount ?? 0
  const nearEven = Math.abs(rawScore - 50) < 8

  const conf = confidenceScore({
    magnitude,
    missingDataCount,
    nearEven
  })

  const finalScore = compressScore(rawScore, conf)

  const timing = timingLabel(sideA_out, sideA_in, currentYear)
  const process = processLabel(finalScore, override.bonus > 0, isLowStakes)

  const grade = adjustedLetterGrade(finalScore, conf, isLowStakes)

  const incomingPicks = sideA_in.filter(a => a.type === 'pick' && a.year)
  const outgoingPicks = sideA_out.filter(a => a.type === 'pick' && a.year)
  
  let tierDelta = 0
  if (outgoingPicks.length > 0 && incomingPicks.length > 0) {
    const bestOut = Math.min(...outgoingPicks.map(a => pickTier(a.round!)))
    const bestIn = Math.min(...incomingPicks.map(a => pickTier(a.round!)))
    tierDelta = bestOut - bestIn
  }

  const avgYearsOut = incomingPicks.length > 0 
    ? Math.round(incomingPicks.reduce((sum, a) => sum + (a.year! - currentYear), 0) / incomingPicks.length)
    : 0

  const why = buildWhyTooltipPayload({
    headline: override.bonus > 0
      ? "Tier upgrade outweighs the time delay."
      : "Value difference driven by aging curve + market values.",
    outgoingValue: A_out_val,
    incomingValue: A_in_val,
    score: finalScore,
    tierOverrideApplied: override.bonus > 0,
    isLowStakes,
    futureDiscountUsed: true,
    tierDelta: tierDelta > 0 ? tierDelta : undefined,
    yearsOut: avgYearsOut > 0 ? avgYearsOut : undefined
  })

  return {
    score: Math.round(finalScore),
    grade,
    verdict: `${process} / ${timing}`,
    confidence: conf,
    confidenceLabel: confidenceLabel(conf, isLowStakes),
    whyTooltip: why,
    rawValues: {
      outgoing: A_out_val,
      incoming: A_in_val
    }
  }
}

export function getDaysToDraft(pickYear: number): number | null {
  const now = new Date()
  const currentYear = now.getFullYear()
  
  if (pickYear < currentYear) return null
  if (pickYear > currentYear + 3) return null
  
  const draftDate = new Date(pickYear, 4, 1)
  const diffTime = draftDate.getTime() - now.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  
  return diffDays > 0 ? diffDays : null
}

export function getCurrentYear(): number {
  return new Date().getFullYear()
}
