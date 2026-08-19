import type { DevyPlayer } from '@prisma/client'
import { getPlayerAnalytics, type PlayerAnalytics } from './player-analytics'

export interface DevyIntelMetrics {
  /** Null when no recruiting evidence exists — never the bare 0.75 default. */
  recruitingComposite: number | null
  productionIndex: number
  breakoutAge: number | null
  breakoutAgeScore: number
  athleticProfileScore: number
  draftCapitalScore: number
  /** Null when not one signal backed a projection. */
  draftProjectionScore: number | null
  /** Null when nothing supports an estimate. */
  projectedDraftRound: number | null
  projectedDraftPick: number | null
  /** How much of the model's weight was genuinely backed by data. */
  projectionConfidence: 'high' | 'moderate' | 'low' | null
  projectionCoverage: number
  projectionMissing: DevySignalKey[]
  nilImpactScore: number
  injurySeverityScore: number
  volatilityScore: number
  ppaScore: number
  usageScore: number
  wepaScore: number
  teamContextBoost: number
  transferRisk: number
}

export interface DevyFinalScore {
  finalScore: number
  draftProjectionComponent: number
  adpMarketComponent: number
  leagueNeedComponent: number
  scarcityComponent: number
  volatilityComponent: number
}

const DRAFT_CAPITAL_MULTIPLIERS: Record<number, number> = {
  1: 1.00,
  2: 0.80,
  3: 0.65,
  4: 0.50,
  5: 0.40,
  6: 0.30,
  7: 0.20,
}

const DRAFT_CAPITAL_UDFA = 0.10

const DYNASTY_VALUE_BY_ROUND: Record<number, { min: number; max: number }> = {
  1: { min: 8000, max: 10000 },
  2: { min: 5500, max: 7999 },
  3: { min: 3500, max: 5499 },
  4: { min: 2000, max: 3499 },
  5: { min: 1000, max: 1999 },
  6: { min: 500, max: 999 },
  7: { min: 200, max: 499 },
}

export function computeRecruitingComposite(player: DevyPlayer): number {
  if (player.recruitingComposite != null && player.recruitingComposite > 0) {
    return player.recruitingComposite
  }

  if (player.recruitingStars != null && player.recruitingStars > 0) {
    const starMap: Record<number, number> = { 5: 0.98, 4: 0.90, 3: 0.82, 2: 0.70, 1: 0.55 }
    return starMap[player.recruitingStars] || 0.70
  }

  if (player.recruitingRanking != null && player.recruitingRanking > 0) {
    if (player.recruitingRanking <= 50) return 0.97
    if (player.recruitingRanking <= 100) return 0.94
    if (player.recruitingRanking <= 200) return 0.90
    if (player.recruitingRanking <= 300) return 0.85
    return Math.max(0.60, 0.85 - (player.recruitingRanking - 300) * 0.001)
  }

  return 0.75
}

export function computeProductionIndex(player: DevyPlayer): number {
  const pos = player.position
  let score = 0

  if (pos === 'QB') {
    const yardScore = Math.min(100, ((player.passingYards || 0) / 4000) * 100)
    const tdScore = Math.min(100, ((player.passingTDs || 0) / 35) * 100)
    const rushBonus = Math.min(20, ((player.rushingYards || 0) / 500) * 20)
    score = yardScore * 0.45 + tdScore * 0.40 + rushBonus * 0.15
  } else if (pos === 'RB') {
    const rushScore = Math.min(100, ((player.rushingYards || 0) / 1500) * 100)
    const tdScore = Math.min(100, ((player.rushingTDs || 0) / 15) * 100)
    const recBonus = Math.min(25, ((player.receptions || 0) / 40) * 25)
    score = rushScore * 0.45 + tdScore * 0.35 + recBonus * 0.20
  } else if (pos === 'WR') {
    const recYards = Math.min(100, ((player.receivingYards || 0) / 1300) * 100)
    const recTds = Math.min(100, ((player.receivingTDs || 0) / 12) * 100)
    const recCount = Math.min(25, ((player.receptions || 0) / 80) * 25)
    score = recYards * 0.45 + recTds * 0.35 + recCount * 0.20
  } else if (pos === 'TE') {
    const recYards = Math.min(100, ((player.receivingYards || 0) / 800) * 100)
    const recTds = Math.min(100, ((player.receivingTDs || 0) / 8) * 100)
    const recCount = Math.min(25, ((player.receptions || 0) / 50) * 25)
    score = recYards * 0.45 + recTds * 0.35 + recCount * 0.20
  }

  const ppaBoost = computePPABoost(player)
  const usageBoost = computeUsageBoost(player)
  score = score * 0.70 + ppaBoost * 0.20 + usageBoost * 0.10

  return Math.round(Math.min(100, Math.max(0, score)) * 100) / 100
}

export function computePPABoost(player: DevyPlayer): number {
  const ppa = (player as any).ppaTotal as number | null | undefined
  if (ppa == null) return 50

  if (ppa >= 0.4) return 95
  if (ppa >= 0.3) return 88
  if (ppa >= 0.2) return 78
  if (ppa >= 0.1) return 68
  if (ppa >= 0.0) return 55
  if (ppa >= -0.1) return 40
  return 25
}

export function computeUsageBoost(player: DevyPlayer): number {
  const usage = (player as any).usageOverall as number | null | undefined
  if (usage == null) return 50

  if (usage >= 0.30) return 95
  if (usage >= 0.25) return 85
  if (usage >= 0.20) return 75
  if (usage >= 0.15) return 65
  if (usage >= 0.10) return 55
  if (usage >= 0.05) return 40
  return 25
}

export function computeWEPAScore(player: DevyPlayer): number {
  const wepa = (player as any).wepaTotal as number | null | undefined
  if (wepa == null) return 50

  if (wepa >= 50) return 95
  if (wepa >= 30) return 85
  if (wepa >= 15) return 75
  if (wepa >= 5) return 65
  if (wepa >= 0) return 50
  if (wepa >= -10) return 35
  return 20
}

export function computeTeamContextBoost(player: DevyPlayer): number {
  let boost = 0

  const spRating = (player as any).teamSpRating as number | null | undefined
  if (spRating != null) {
    if (spRating >= 25) boost += 10
    else if (spRating >= 15) boost += 7
    else if (spRating >= 5) boost += 3
    else if (spRating < -5) boost -= 5
  }

  const retProd = (player as any).returningProdPct as number | null | undefined
  if (retProd != null) {
    if (retProd >= 0.8) boost += 5
    else if (retProd >= 0.6) boost += 3
    else if (retProd < 0.4) boost -= 3
  }

  return boost
}

export function computeTransferRisk(player: DevyPlayer): number {
  if (!player.transferStatus) return 0

  let risk = 15

  const fromSchool = (player as any).transferFromSchool as string | null | undefined
  const toSchool = (player as any).transferToSchool as string | null | undefined
  const eliteSchools = new Set([
    'Alabama', 'Ohio State', 'Georgia', 'Texas', 'USC', 'Oregon',
    'Michigan', 'Penn State', 'LSU', 'Clemson', 'Notre Dame',
  ])

  if (toSchool && eliteSchools.has(toSchool)) {
    risk -= 10
  } else if (fromSchool && eliteSchools.has(fromSchool) && toSchool && !eliteSchools.has(toSchool)) {
    risk += 10
  }

  if (!toSchool) {
    risk += 10
  }

  return Math.max(0, Math.min(40, risk))
}

export function computeBreakoutAge(player: DevyPlayer): number | null {
  if (player.breakoutAge != null) return player.breakoutAge
  if (!player.classYear || !player.statSeason) return null

  const pos = player.position
  let hasBreakout = false

  if (pos === 'WR' || pos === 'TE') {
    hasBreakout = (player.receivingYards || 0) > 600 || (player.receivingTDs || 0) >= 5
  } else if (pos === 'RB') {
    hasBreakout = (player.rushingYards || 0) > 700 || (player.rushingTDs || 0) >= 6
  } else if (pos === 'QB') {
    hasBreakout = (player.passingYards || 0) > 2500 || (player.passingTDs || 0) >= 18
  }

  if (!hasBreakout) return null

  const estimatedAge = 18 + (player.classYear || 1) + (player.redshirtStatus ? 1 : 0)
  return estimatedAge
}

export function breakoutAgeToScore(breakoutAge: number | null): number {
  if (breakoutAge === null) return 50
  if (breakoutAge <= 19.5) return 95
  if (breakoutAge <= 20) return 90
  if (breakoutAge <= 20.5) return 85
  if (breakoutAge <= 21) return 80
  if (breakoutAge <= 21.5) return 70
  if (breakoutAge <= 22) return 55
  return Math.max(20, 55 - (breakoutAge - 22) * 15)
}

export function computeAthleticProfileScore(player: DevyPlayer): number {
  if (player.athleticProfileScore != null) return player.athleticProfileScore

  let score = 50
  const pos = player.position

  if (player.heightInches && player.weightLbs) {
    const idealProfiles: Record<string, { height: number; weight: number }> = {
      QB: { height: 75, weight: 220 },
      RB: { height: 71, weight: 215 },
      WR: { height: 73, weight: 205 },
      TE: { height: 77, weight: 250 },
    }
    const ideal = idealProfiles[pos] || idealProfiles.WR

    const heightDiff = Math.abs(player.heightInches - ideal.height)
    const weightDiff = Math.abs(player.weightLbs - ideal.weight)

    score = 80 - heightDiff * 3 - weightDiff * 0.3

    if (pos === 'WR' && player.heightInches >= 74 && player.weightLbs >= 200) score += 10
    if (pos === 'TE' && player.heightInches >= 77 && player.weightLbs >= 245) score += 10
    if (pos === 'RB' && player.heightInches >= 70 && player.weightLbs >= 210 && player.weightLbs <= 225) score += 10
    if (pos === 'QB' && player.heightInches >= 75) score += 8
  }

  return Math.round(Math.min(100, Math.max(10, score)) * 100) / 100
}

export function computeDraftCapitalScore(projectedRound: number | null): number {
  if (!projectedRound || projectedRound < 1) return 30
  const multiplier = DRAFT_CAPITAL_MULTIPLIERS[projectedRound] ?? DRAFT_CAPITAL_UDFA
  return Math.round(multiplier * 100)
}

export function estimateProjectedDraftRound(player: DevyPlayer): number {
  if (player.projectedDraftRound != null && player.projectedDraftRound > 0) return player.projectedDraftRound

  const recruiting = computeRecruitingComposite(player)
  const production = computeProductionIndex(player)
  const yearsLeft = Math.max(0, (player.draftEligibleYear || 2028) - new Date().getFullYear())

  let score = recruiting * 40 + (production / 100) * 40

  if (yearsLeft <= 1) score += 10
  else if (yearsLeft === 2) score += 5

  if (player.classYear && player.classYear <= 2) score += 5

  if (score >= 85) return 1
  if (score >= 72) return 2
  if (score >= 60) return 3
  if (score >= 48) return 4
  if (score >= 36) return 5
  if (score >= 25) return 6
  return 7
}

export function estimateProjectedDraftPick(round: number): number {
  if (round === 1) return 16
  if (round === 2) return 48
  return round * 32 - 16
}

export function computeNilImpactScore(player: DevyPlayer): number {
  if (player.nilImpactScore != null) return player.nilImpactScore

  let impact = 0

  if (player.transferStatus) {
    const eliteSchools = new Set(['Alabama', 'Ohio State', 'Georgia', 'Texas', 'USC', 'Oregon', 'Michigan', 'Penn State', 'LSU', 'Clemson'])
    if (eliteSchools.has(player.school)) {
      impact += 5
    } else {
      impact -= 3
    }
  }

  const recruiting = computeRecruitingComposite(player)
  if (recruiting >= 0.95) impact += 5
  else if (recruiting >= 0.90) impact += 3

  return Math.round(Math.min(100, Math.max(-20, impact)) * 100) / 100
}

export function computeInjurySeverityScore(player: DevyPlayer): number {
  if (player.injurySeverityScore != null) return player.injurySeverityScore

  let score = 0

  if (player.redshirtStatus) {
    if (player.classYear && player.classYear >= 3) {
      score += 15
    } else {
      score += 5
    }
  }

  return Math.round(Math.min(100, Math.max(0, score)))
}

export function computeVolatilityScore(player: DevyPlayer): number {
  if (player.volatilityScore != null) return player.volatilityScore

  let volatility = 30

  const transferRisk = computeTransferRisk(player)
  volatility += transferRisk

  if (player.redshirtStatus && player.classYear && player.classYear >= 3) volatility += 20

  const injuryScore = computeInjurySeverityScore(player)
  if (injuryScore > 50) volatility += 20
  else if (injuryScore > 25) volatility += 10

  const yearsOut = Math.max(0, (player.draftEligibleYear || 2028) - new Date().getFullYear())
  volatility += yearsOut * 5

  return Math.round(Math.min(100, Math.max(0, volatility)))
}

export function computeDraftProjectionScore(player: DevyPlayer): number {
  const recruitingRaw = computeRecruitingComposite(player) * 100
  const productionRaw = computeProductionIndex(player)
  const breakoutAge = computeBreakoutAge(player)
  const breakoutScore = breakoutAgeToScore(breakoutAge)
  const athleticScore = computeAthleticProfileScore(player)
  const projectedRound = estimateProjectedDraftRound(player)
  const draftCapital = computeDraftCapitalScore(projectedRound)
  const ppaScore = computePPABoost(player)
  const wepaScore = computeWEPAScore(player)
  const teamCtx = computeTeamContextBoost(player)
  const transferRisk = computeTransferRisk(player)

  const dps =
    recruitingRaw * 0.20 +
    productionRaw * 0.25 +
    breakoutScore * 0.10 +
    athleticScore * 0.10 +
    draftCapital * 0.15 +
    ppaScore * 0.10 +
    wepaScore * 0.05 +
    teamCtx * 0.05 -
    transferRisk * 0.3

  return Math.round(Math.min(100, Math.max(0, dps)) * 100) / 100
}


// ──────────────────────────────────────────────────────────────────
// Evidence layer — what we actually know about a player
//
// Every scorer above falls back to a plausible middle number when its input is
// absent: computePPABoost/computeUsageBoost/computeWEPAScore return 50,
// computeRecruitingComposite returns 0.75, estimateProjectedDraftRound always
// returns a round. That makes a player we know nothing about indistinguishable
// from an average one, and it is the same failure as a trade grading C off zero
// points.
//
// Measured against the real seeded board: enriching with those defaults would
// manufacture recruitingComposite for 991 of 1,718 players — every one of them
// exactly 0.75 — and a projectedDraftRound for all 1,718, to gain 40 genuinely
// derivable breakout ages.
//
// These predicates say whether a signal has any backing at all. Scores are then
// renormalised over the signals present, so absent ones neither drag a player
// toward average nor quietly count as evidence.
// ──────────────────────────────────────────────────────────────────

export type DevySignalKey =
  | 'recruiting'
  | 'production'
  | 'breakout'
  | 'athletic'
  | 'draftCapital'
  | 'ppa'
  | 'wepa'
  | 'teamContext'

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function hasRecruitingEvidence(player: DevyPlayer): boolean {
  const p = player as any
  return (
    (num(p.recruitingComposite) && p.recruitingComposite > 0) ||
    (num(p.recruitingStars) && p.recruitingStars > 0) ||
    (num(p.recruitingRanking) && p.recruitingRanking > 0)
  )
}

export function hasProductionEvidence(player: DevyPlayer): boolean {
  const p = player as any
  return [
    p.passingYards, p.passingTDs, p.rushingYards, p.rushingTDs,
    p.receivingYards, p.receivingTDs, p.receptions,
  ].some((v) => num(v) && v > 0)
}

export function hasAthleticEvidence(player: DevyPlayer): boolean {
  const p = player as any
  return num(p.athleticProfileScore) || (num(p.heightInches) && num(p.weightLbs))
}

export function hasTeamContextEvidence(player: DevyPlayer): boolean {
  const p = player as any
  return num(p.teamSpRating) || num(p.returningProdPct)
}

/**
 * Draft capital is derived from the projected round, which is itself derived
 * from recruiting and production. With neither of those it rests on nothing.
 */
export function hasDraftCapitalEvidence(player: DevyPlayer): boolean {
  const p = player as any
  if (num(p.projectedDraftRound) && p.projectedDraftRound > 0) return true
  return hasRecruitingEvidence(player) || hasProductionEvidence(player)
}

/** Composite only when something backs it — never the bare 0.75 default. */
export function computeRecruitingCompositeOrNull(player: DevyPlayer): number | null {
  return hasRecruitingEvidence(player) ? computeRecruitingComposite(player) : null
}

/** Projected round only when recruiting or production can support the estimate. */
export function estimateProjectedDraftRoundOrNull(player: DevyPlayer): number | null {
  return hasDraftCapitalEvidence(player) ? estimateProjectedDraftRound(player) : null
}

const DEVY_SIGNAL_WEIGHTS: { key: DevySignalKey; weight: number }[] = [
  { key: 'recruiting', weight: 0.2 },
  { key: 'production', weight: 0.25 },
  { key: 'breakout', weight: 0.1 },
  { key: 'athletic', weight: 0.1 },
  { key: 'draftCapital', weight: 0.15 },
  { key: 'ppa', weight: 0.1 },
  { key: 'wepa', weight: 0.05 },
  { key: 'teamContext', weight: 0.05 },
]

export type DevyProjection = {
  /** 0-100, or null when not one signal was available. */
  score: number | null
  confidence: 'high' | 'moderate' | 'low' | null
  /** Share of model weight actually backed by data, 0-1. */
  coverage: number
  present: DevySignalKey[]
  missing: DevySignalKey[]
}

/**
 * The devy-intel model, scored only on signals that exist.
 *
 * Richer than lib/devy-model.ts: eight signals including PPA, wEPA, usage and
 * team context, all sourced from CFBD. Same honesty contract as devy-model's
 * computeDraftProjection — null rather than a manufactured number.
 */
export function computeDevyProjection(player: DevyPlayer): DevyProjection {
  const p = player as any
  const breakoutAge = computeBreakoutAge(player)

  const values: Partial<Record<DevySignalKey, number>> = {}
  if (hasRecruitingEvidence(player)) values.recruiting = computeRecruitingComposite(player) * 100
  if (hasProductionEvidence(player)) values.production = computeProductionIndex(player)
  if (breakoutAge != null) values.breakout = breakoutAgeToScore(breakoutAge)
  if (hasAthleticEvidence(player)) values.athletic = computeAthleticProfileScore(player)
  if (hasDraftCapitalEvidence(player)) {
    values.draftCapital = computeDraftCapitalScore(estimateProjectedDraftRound(player))
  }
  if (num(p.ppaTotal)) values.ppa = computePPABoost(player)
  if (num(p.wepaTotal)) values.wepa = computeWEPAScore(player)
  if (hasTeamContextEvidence(player)) values.teamContext = computeTeamContextBoost(player)

  let weighted = 0
  let presentWeight = 0
  const present: DevySignalKey[] = []
  const missing: DevySignalKey[] = []
  for (const { key, weight } of DEVY_SIGNAL_WEIGHTS) {
    const v = values[key]
    if (v == null) {
      missing.push(key)
      continue
    }
    weighted += v * weight
    presentWeight += weight
    present.push(key)
  }

  // A prospect evaluation rests on what he was rated coming in, or what he has
  // actually done. Height and weight alone are real data but not an evaluation:
  // emitting a score off them anchors a number in the reader's mind that no
  // scouting signal supports. Substantive evidence is required before any score.
  const hasSubstantiveSignal = present.includes('recruiting') || present.includes('production')
  if (presentWeight === 0 || !hasSubstantiveSignal) {
    return { score: null, confidence: null, coverage: 0, present, missing }
  }

  let score = weighted / presentWeight

  // Transfer risk is a known-status penalty, not a signal; it never counts
  // toward coverage and only applies when the status is actually recorded.
  if (p.transferStatus) score -= computeTransferRisk(player) * 0.3

  const coverage = Math.round(presentWeight * 1000) / 1000
  const confidence: 'high' | 'moderate' | 'low' =
    coverage >= 0.7 ? 'high' : coverage >= 0.4 ? 'moderate' : 'low'

  return {
    score: Math.round(Math.min(100, Math.max(0, score)) * 100) / 100,
    confidence,
    coverage,
    present,
    missing,
  }
}

export function computeAllDevyIntelMetrics(player: DevyPlayer): DevyIntelMetrics {
  // Honest variants: null where nothing backs the value. The non-null helpers
  // above are kept for callers that genuinely want a filled-in estimate.
  const recruiting = computeRecruitingCompositeOrNull(player)
  const production = computeProductionIndex(player)
  const breakoutAge = computeBreakoutAge(player)
  const breakoutScore = breakoutAgeToScore(breakoutAge)
  const athletic = computeAthleticProfileScore(player)
  const projectedRound = estimateProjectedDraftRoundOrNull(player)
  const projectedPick = projectedRound == null ? null : estimateProjectedDraftPick(projectedRound)
  const draftCapital = computeDraftCapitalScore(projectedRound)
  const projection = computeDevyProjection(player)
  const nil = computeNilImpactScore(player)
  const injury = computeInjurySeverityScore(player)
  const volatility = computeVolatilityScore(player)
  const ppaScore = computePPABoost(player)
  const usageScore = computeUsageBoost(player)
  const wepaScore = computeWEPAScore(player)
  const teamCtx = computeTeamContextBoost(player)
  const transferRisk = computeTransferRisk(player)

  return {
    recruitingComposite: recruiting,
    productionIndex: production,
    breakoutAge,
    breakoutAgeScore: breakoutScore,
    athleticProfileScore: athletic,
    draftCapitalScore: draftCapital,
    draftProjectionScore: projection.score,
    projectedDraftRound: projectedRound,
    projectedDraftPick: projectedPick,
    projectionConfidence: projection.confidence,
    projectionCoverage: projection.coverage,
    projectionMissing: projection.missing,
    nilImpactScore: nil,
    injurySeverityScore: injury,
    volatilityScore: volatility,
    ppaScore,
    usageScore,
    wepaScore,
    teamContextBoost: teamCtx,
    transferRisk,
  }
}

export function computeDevyFinalScore(
  player: DevyPlayer,
  opts: {
    biggestNeed: string
    secondaryNeed?: string
    isSF?: boolean
    isTEP?: boolean
    totalTeams?: number
    pickNumber?: number
  }
): DevyFinalScore | null {
  const metrics = computeAllDevyIntelMetrics(player)

  // No signal backed a projection, so there is no final score to give. Callers
  // render "unrated" rather than receive a number assembled from defaults.
  if (metrics.draftProjectionScore == null) return null

  const draftProjectionComponent = metrics.draftProjectionScore * 0.40

  const currentAdp = player.devyAdp
  let adpMarketComponent = 50
  if (currentAdp != null && currentAdp > 0) {
    adpMarketComponent = Math.max(0, Math.min(100, 100 - (currentAdp - 1) * 3))
  } else {
    adpMarketComponent = metrics.draftProjectionScore * 0.7
  }
  adpMarketComponent *= 0.20

  let needMultiplier = 0.3
  if (player.position === opts.biggestNeed) needMultiplier = 1.0
  else if (player.position === opts.secondaryNeed) needMultiplier = 0.7

  if (opts.isSF && player.position === 'QB') needMultiplier = Math.max(needMultiplier, 0.85)
  if (opts.isTEP && player.position === 'TE') needMultiplier = Math.max(needMultiplier, 0.6)

  const leagueNeedComponent = (needMultiplier * 100) * 0.20

  const teams = opts.totalTeams || 12
  const positionCounts: Record<string, number> = { QB: 4, RB: 8, WR: 10, TE: 4 }
  const posSupply = positionCounts[player.position] || 6
  const scarcityRaw = Math.max(0, 100 - (posSupply / teams) * 100)
  // An unknown round earns no early-round scarcity bonus rather than a guessed one.
  const projectedRound = metrics.projectedDraftRound
  const earlyRoundBonus = projectedRound != null && projectedRound <= 2 ? 20 : 0
  const scarcityComponent = Math.min(100, scarcityRaw + earlyRoundBonus) * 0.10

  const volatilityComponent = (100 - metrics.volatilityScore) * 0.10

  const finalScore = draftProjectionComponent + adpMarketComponent + leagueNeedComponent + scarcityComponent + volatilityComponent

  return {
    finalScore: Math.round(Math.min(100, Math.max(0, finalScore)) * 100) / 100,
    draftProjectionComponent: Math.round(draftProjectionComponent * 100) / 100,
    adpMarketComponent: Math.round(adpMarketComponent * 100) / 100,
    leagueNeedComponent: Math.round(leagueNeedComponent * 100) / 100,
    scarcityComponent: Math.round(scarcityComponent * 100) / 100,
    volatilityComponent: Math.round(volatilityComponent * 100) / 100,
  }
}

export function computeDevyDynastyValue(
  player: DevyPlayer,
  teamDirection: 'Contender' | 'Rebuilder',
): number | null {
  const metrics = computeAllDevyIntelMetrics(player)
  const round = metrics.projectedDraftRound
  // A dynasty value is a price. Without a projected round and a score there is
  // nothing to price, and inventing one is worse than showing nothing.
  if (round == null || metrics.draftProjectionScore == null) return null
  const rangeForRound = DYNASTY_VALUE_BY_ROUND[round] || { min: 100, max: 199 }

  const positionInRound = (metrics.draftProjectionScore / 100)
  let dynastyValue = rangeForRound.min + (rangeForRound.max - rangeForRound.min) * positionInRound

  const yearsOut = Math.max(0, (player.draftEligibleYear || 2028) - new Date().getFullYear())

  if (teamDirection === 'Contender') {
    dynastyValue *= Math.max(0.5, 1 - yearsOut * 0.15)
  } else {
    dynastyValue *= Math.min(1.3, 1 + yearsOut * 0.08)
  }

  if (metrics.volatilityScore > 60) dynastyValue *= 0.85
  if (metrics.injurySeverityScore > 50) dynastyValue *= 0.90

  if (metrics.ppaScore >= 80) dynastyValue *= 1.08
  else if (metrics.ppaScore >= 65) dynastyValue *= 1.04

  if (metrics.wepaScore >= 80) dynastyValue *= 1.05
  else if (metrics.wepaScore >= 65) dynastyValue *= 1.02

  if (metrics.transferRisk > 20) dynastyValue *= 0.92
  else if (metrics.transferRisk > 10) dynastyValue *= 0.96

  if (metrics.teamContextBoost > 0) {
    dynastyValue *= Math.min(1.10, 1 + metrics.teamContextBoost * 0.005)
  } else if (metrics.teamContextBoost < 0) {
    dynastyValue *= Math.max(0.92, 1 + metrics.teamContextBoost * 0.005)
  }

  return Math.round(dynastyValue)
}

export function computeDevyAcceptDrivers(
  player: DevyPlayer,
  partnerArchetype: string | null,
  leagueLdiPick: number | null
): { driver: string; delta: number; direction: 'boost' | 'penalty' }[] {
  const drivers: { driver: string; delta: number; direction: 'boost' | 'penalty' }[] = []
  const metrics = computeAllDevyIntelMetrics(player)

  if (partnerArchetype === 'FutureFocused' || partnerArchetype === 'future_focused') {
    drivers.push({ driver: 'Partner loves youth/future assets', delta: 0.08, direction: 'boost' })
  }

  if (leagueLdiPick != null && leagueLdiPick > 65) {
    drivers.push({ driver: 'League heavily invests in draft capital', delta: 0.05, direction: 'boost' })
  }

  const breakoutAge = computeBreakoutAge(player)
  if (breakoutAge != null && breakoutAge <= 20) {
    drivers.push({ driver: `Early breakout age (${breakoutAge})`, delta: 0.03, direction: 'boost' })
  }

  // A driver is a stated reason. Without a projected round there is no reason
  // to state, so none is pushed.
  if (metrics.projectedDraftRound == null) {
    // no round-based driver
  } else if (metrics.projectedDraftRound <= 1) {
    drivers.push({ driver: 'Projected Round 1 NFL pick', delta: 0.06, direction: 'boost' })
  } else if (metrics.projectedDraftRound <= 2) {
    drivers.push({ driver: 'Projected Day 1-2 NFL pick', delta: 0.03, direction: 'boost' })
  }

  if (metrics.injurySeverityScore > 70) {
    drivers.push({ driver: 'Significant injury concern', delta: 0.07, direction: 'penalty' })
  } else if (metrics.injurySeverityScore > 40) {
    drivers.push({ driver: 'Moderate injury risk', delta: 0.03, direction: 'penalty' })
  }

  if (metrics.volatilityScore > 70) {
    drivers.push({ driver: 'High volatility prospect', delta: 0.04, direction: 'penalty' })
  }

  if (metrics.ppaScore >= 80) {
    drivers.push({ driver: 'Elite efficiency (PPA)', delta: 0.04, direction: 'boost' })
  } else if (metrics.ppaScore >= 65) {
    drivers.push({ driver: 'Above-average efficiency (PPA)', delta: 0.02, direction: 'boost' })
  }

  if (metrics.wepaScore >= 80) {
    drivers.push({ driver: 'Strong opponent-adjusted production (WEPA)', delta: 0.03, direction: 'boost' })
  }

  if (metrics.transferRisk > 20) {
    drivers.push({ driver: 'High transfer risk / uncertain landing spot', delta: 0.05, direction: 'penalty' })
  } else if (metrics.transferRisk > 10) {
    drivers.push({ driver: 'Transfer portal entrant', delta: 0.02, direction: 'penalty' })
  }

  if (metrics.teamContextBoost >= 8) {
    drivers.push({ driver: 'Elite program context (SP+)', delta: 0.03, direction: 'boost' })
  } else if (metrics.teamContextBoost <= -5) {
    drivers.push({ driver: 'Weak program context', delta: 0.02, direction: 'penalty' })
  }

  return drivers
}

export function computeAvailabilityPctV2(
  player: DevyPlayer,
  pickNumber: number,
  totalTeams: number
): number {
  const metrics = computeAllDevyIntelMetrics(player)
  const adp = player.devyAdp

  let baseAvailability: number

  if (adp != null && adp > 0) {
    const adpPosition = adp / totalTeams
    if (pickNumber <= adp) {
      baseAvailability = Math.min(95, 50 + (adp - pickNumber) * 5)
    } else {
      baseAvailability = Math.max(5, 50 - (pickNumber - adp) * 8)
    }
  } else {
    // With no ADP and no projection there is nothing to infer availability
    // from, so start neutral rather than pretending a value percentile exists.
    const valuePercentile =
      metrics.draftProjectionScore == null ? null : Math.min(1, metrics.draftProjectionScore / 100)
    baseAvailability = valuePercentile == null ? 50 : (1 - valuePercentile) * 80 + 10
  }

  const yearsOut = Math.max(0, (player.draftEligibleYear || 2028) - new Date().getFullYear())
  if (yearsOut >= 2) baseAvailability = Math.min(95, baseAvailability + 10)
  else if (yearsOut === 0) baseAvailability = Math.max(5, baseAvailability - 15)

  const positionRunPenalty =
    metrics.projectedDraftRound != null && metrics.projectedDraftRound <= 1 ? 10 : 0
  baseAvailability -= positionRunPenalty

  return Math.round(Math.min(95, Math.max(5, baseAvailability)))
}

export async function enrichDevyWithAnalytics(player: DevyPlayer): Promise<DevyPlayer> {
  try {
    const analytics = await getPlayerAnalytics(player.name)
    if (!analytics) return player

    const enriched = { ...player }

    if (enriched.breakoutAge == null && analytics.college.breakoutAge != null) {
      enriched.breakoutAge = analytics.college.breakoutAge
    }

    if (enriched.athleticProfileScore == null && analytics.combine.athleticismScore != null) {
      const rawScore = analytics.combine.athleticismScore
      enriched.athleticProfileScore = Math.round(Math.min(100, Math.max(10, (rawScore / 140) * 100)) * 100) / 100
    }

    if (enriched.heightInches == null && analytics.physical.heightIn != null) {
      enriched.heightInches = analytics.physical.heightIn
    }
    if (enriched.weightLbs == null && analytics.physical.weightLb != null) {
      enriched.weightLbs = analytics.physical.weightLb
    }

    if (enriched.nflDraftRound == null && analytics.draft.draftYear != null && analytics.draft.draftPick != null) {
      const pick = analytics.draft.draftPick
      if (pick <= 32) enriched.nflDraftRound = 1
      else if (pick <= 64) enriched.nflDraftRound = 2
      else if (pick <= 100) enriched.nflDraftRound = 3
      else if (pick <= 135) enriched.nflDraftRound = 4
      else if (pick <= 176) enriched.nflDraftRound = 5
      else if (pick <= 220) enriched.nflDraftRound = 6
      else enriched.nflDraftRound = 7
    }

    return enriched
  } catch {
    return player
  }
}

export async function getPlayerComparables(name: string): Promise<string[]> {
  try {
    const analytics = await getPlayerAnalytics(name)
    return analytics?.comparablePlayers || []
  } catch {
    return []
  }
}

export async function getPlayerCombineProfile(name: string): Promise<{
  fortyYardDash: number | null
  benchPress: number | null
  broadJump: number | null
  verticalJump: number | null
  threeConeDrill: number | null
  twentyYardShuttle: number | null
  athleticismScore: number | null
  speedScore: number | null
  burstScore: number | null
  agilityScore: number | null
  sparqX: number | null
  armLength: number | null
  handSize: number | null
  throwVelocity: number | null
} | null> {
  try {
    const analytics = await getPlayerAnalytics(name)
    if (!analytics) return null
    return {
      fortyYardDash: analytics.combine.fortyYardDash,
      benchPress: analytics.combine.benchPress,
      broadJump: analytics.combine.broadJump,
      verticalJump: analytics.combine.verticalJump,
      threeConeDrill: analytics.combine.threeConeDrill,
      twentyYardShuttle: analytics.combine.twentyYardShuttle,
      athleticismScore: analytics.combine.athleticismScore,
      speedScore: analytics.combine.speedScore,
      burstScore: analytics.combine.burstScore,
      agilityScore: analytics.combine.agilityScore,
      sparqX: analytics.combine.sparqX,
      armLength: analytics.physical.armLengthIn,
      handSize: analytics.physical.handSizeIn,
      throwVelocity: analytics.physical.throwVelocityMph,
    }
  } catch {
    return null
  }
}
