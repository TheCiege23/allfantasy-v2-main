import type { AdaptivePlayerRank } from './adaptive-rankings'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

export interface TeamFitScoreBreakdown {
  slotNeedFit: number
  volatilityBalance: number
  ageCurveFit: number
  byeClusterRelief: number
  raw: number
  scaled: number
}

export interface GoalAlignmentScore {
  goal: 'win-now' | 'balanced' | 'rebuild'
  alignmentScore: number
  reasoning: string
}

export interface RiskFitScore {
  riskScore: number
  volatility: number
  ageRisk: number
}

export interface PositionalStrength {
  position: string
  userValue: number
  leagueAvgValue: number
  leagueMaxValue: number
  strengthPct: number
  playerCount: number
}

export interface UserRankScoreOutput {
  leagueRankScore: number
  teamFitScore: number
  goalAlignmentScore: number
  riskFitScore: number
  userRankScore: number
  tfsBreakdown: TeamFitScoreBreakdown
  goalDetails: GoalAlignmentScore
  riskDetails: RiskFitScore
}

interface SlotGap {
  slot: string
  position: string
  gap: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

const AGE_CURVES: Record<string, { peak: number; dropoff: number }> = {
  QB: { peak: 28, dropoff: 34 },
  RB: { peak: 24, dropoff: 28 },
  WR: { peak: 26, dropoff: 31 },
  TE: { peak: 27, dropoff: 31 },
}

/**
 * Club → bye week for the season being ranked, from `resolveByeWeekMap` (`lib/core-app/byeWeekMap`).
 *
 * 🛑 THIS WAS A HARD-CODED `NFL_BYE_WEEKS_2025` TABLE, READ IN 2026. Every bye-cluster score it
 * produced was last season's slate — the same defect `byeWeekMap.ts` records retiring from
 * `waiver-engine/team-needs.ts`. This module is pure, so the map is passed IN by the caller, which
 * can read the schedule. A club missing from the map is "bye unknown" and scores neutral; an empty
 * map is no bye opinion at all, never last year's.
 */
export type TeamByeWeeks = Readonly<Record<string, number>>

function byeOf(team: string | null | undefined, byeWeeks: TeamByeWeeks): number | null {
  if (!team) return null
  const club = normalizeTeamAbbrev(team)
  return club ? byeWeeks[club] ?? null : null
}

export function computeTeamFitScore(
  player: AdaptivePlayerRank,
  weakestSlots: SlotGap[],
  rosterPlayers: AdaptivePlayerRank[],
  goal: 'win-now' | 'balanced' | 'rebuild',
  byeWeeks: TeamByeWeeks = {},
): TeamFitScoreBreakdown {
  const slotNeedFit = computeSlotNeedFit(player, weakestSlots)
  const volatilityBalance = computeVolatilityBalance(player, rosterPlayers)
  const ageCurveFit = computeAgeCurvePreferenceFit(player, rosterPlayers, goal)
  const byeClusterRelief = computeByeClusterRelief(player, rosterPlayers, byeWeeks)

  const raw = slotNeedFit * 0.40 + volatilityBalance * 0.20 + ageCurveFit * 0.25 + byeClusterRelief * 0.15
  const scaled = Math.round(clamp(raw, 0, 100))

  return { slotNeedFit, volatilityBalance, ageCurveFit, byeClusterRelief, raw, scaled }
}

function computeSlotNeedFit(player: AdaptivePlayerRank, weakestSlots: SlotGap[]): number {
  const pos = player.position
  const matchingSlot = weakestSlots.find(s => s.position === pos)
  if (!matchingSlot) {
    const anyMatch = weakestSlots.some(s => {
      if (s.slot === 'FLEX' || s.slot === 'RB/WR/TE') return ['RB', 'WR', 'TE'].includes(pos)
      if (s.slot === 'SUPER_FLEX') return ['QB', 'RB', 'WR', 'TE'].includes(pos)
      return false
    })
    return anyMatch ? 45 : 20
  }
  const gapNorm = clamp(matchingSlot.gap / 3000, 0, 1)
  return Math.round(30 + gapNorm * 70)
}

function computeVolatilityBalance(player: AdaptivePlayerRank, rosterPlayers: AdaptivePlayerRank[]): number {
  const samePos = rosterPlayers.filter(p => p.position === player.position)
  const avgVolatility = samePos.length > 0
    ? samePos.reduce((sum, p) => sum + (p.scarcityFactors?.volatilityFit ?? 50), 0) / samePos.length
    : 50
  const playerVolatility = player.scarcityFactors?.volatilityFit ?? 50
  const volatilityGap = Math.abs(playerVolatility - avgVolatility)
  if (volatilityGap < 15) return 80
  if (volatilityGap < 30) return 60
  return 40
}

function computeAgeCurvePreferenceFit(
  player: AdaptivePlayerRank,
  rosterPlayers: AdaptivePlayerRank[],
  goal: 'win-now' | 'balanced' | 'rebuild',
): number {
  const age = player.age ?? 25
  const pos = player.position
  const curve = AGE_CURVES[pos] || { peak: 26, dropoff: 30 }

  if (goal === 'win-now') {
    if (age >= curve.peak - 2 && age <= curve.dropoff) return 90
    if (age < curve.peak - 2) return 55
    return 30
  }
  if (goal === 'rebuild') {
    if (age <= curve.peak - 1) return 90
    if (age <= curve.peak + 1) return 65
    return 25
  }
  if (age <= curve.peak + 2) return 75
  return 45
}

function computeByeClusterRelief(
  player: AdaptivePlayerRank,
  rosterPlayers: AdaptivePlayerRank[],
  teamByes: TeamByeWeeks,
): number {
  const playerBye = byeOf(player.team, teamByes)
  if (!playerBye) return 50

  const samePos = rosterPlayers.filter(p => p.position === player.position)
  const byeWeeks = samePos
    .map(p => byeOf(p.team, teamByes))
    .filter((w): w is number => w !== null)

  const byeCount = byeWeeks.filter(w => w === playerBye).length
  if (byeCount >= 2) return 25
  if (byeCount === 1) return 50
  return 75
}

export function computeGoalAlignment(
  player: AdaptivePlayerRank,
  goal: 'win-now' | 'balanced' | 'rebuild',
): GoalAlignmentScore {
  const age = player.age ?? 25
  const pos = player.position
  const curve = AGE_CURVES[pos] || { peak: 26, dropoff: 30 }
  const ms = player.marketValue
  const is = player.impactScore

  let score = 50
  let reasoning = ''

  if (goal === 'win-now') {
    const impactWeight = clamp(is / 80, 0, 1) * 50
    const ageBonus = (age >= curve.peak - 1 && age <= curve.dropoff) ? 30 : age < curve.peak ? 15 : 5
    score = Math.round(impactWeight + ageBonus)
    reasoning = score >= 70 ? 'Elite starter in prime window' : score >= 45 ? 'Solid contributor this year' : 'Limited win-now impact'
  } else if (goal === 'rebuild') {
    const valueWeight = clamp(ms / 8000, 0, 1) * 40
    const ageBonus = age <= curve.peak - 2 ? 40 : age <= curve.peak ? 20 : 0
    score = Math.round(valueWeight + ageBonus)
    reasoning = score >= 70 ? 'High-ceiling rebuild asset' : score >= 45 ? 'Solid long-term value' : 'Aging asset, declining trajectory'
  } else {
    const blend = (clamp(is / 80, 0, 1) * 25) + (clamp(ms / 8000, 0, 1) * 25)
    const ageMod = age <= curve.peak + 1 ? 20 : 10
    score = Math.round(blend + ageMod)
    reasoning = score >= 60 ? 'Well-rounded asset' : 'Moderate fit'
  }

  return { goal, alignmentScore: clamp(score, 0, 100), reasoning }
}

export function computeRiskFit(
  player: AdaptivePlayerRank,
  goal: 'win-now' | 'balanced' | 'rebuild',
): RiskFitScore {
  const volatility = player.scarcityFactors?.volatilityFit ?? 50
  const age = player.age ?? 25
  const pos = player.position
  const curve = AGE_CURVES[pos] || { peak: 26, dropoff: 30 }

  let ageRisk: number
  if (age <= curve.peak) ageRisk = 15
  else if (age <= curve.dropoff) ageRisk = 15 + ((age - curve.peak) / (curve.dropoff - curve.peak)) * 50
  else ageRisk = 65 + Math.min(35, (age - curve.dropoff) * 10)

  const volRisk = 100 - volatility
  const rawRisk = volRisk * 0.5 + ageRisk * 0.5

  let goalPenalty = 0
  if (goal === 'win-now' && ageRisk > 60) goalPenalty = 15
  if (goal === 'rebuild' && ageRisk < 20) goalPenalty = -10

  const riskScore = clamp(Math.round(100 - rawRisk - goalPenalty), 0, 100)

  return { riskScore, volatility: Math.round(volRisk), ageRisk: Math.round(ageRisk) }
}

export function computeUserRankScore(
  player: AdaptivePlayerRank,
  leagueRankScore: number,
  tfs: number,
  goalAlignment: number,
  riskFit: number,
): number {
  return Math.round(
    leagueRankScore * 0.30 +
    tfs * 0.35 +
    goalAlignment * 0.20 +
    riskFit * 0.15
  )
}

export function computeLeagueRankScore(player: AdaptivePlayerRank): number {
  const ms = clamp(player.marketValue / 100, 0, 100)
  const is = clamp(player.impactScore, 0, 100)
  const ss = clamp(player.scarcityScore, 0, 100)
  const ds = clamp(player.demandScore, 0, 100)
  return Math.round(ms * 0.35 + is * 0.30 + ss * 0.15 + ds * 0.20)
}

export function computePositionalStrength(
  userRoster: AdaptivePlayerRank[],
  allPlayers: AdaptivePlayerRank[],
  numTeams: number,
): PositionalStrength[] {
  const positions = ['QB', 'RB', 'WR', 'TE']

  return positions.map(pos => {
    const userPlayers = userRoster.filter(p => p.position === pos)
    const userValue = userPlayers.reduce((sum, p) => sum + p.marketValue, 0)

    const allPosPlayers = allPlayers.filter(p => p.position === pos)
    const allValues = allPosPlayers.map(p => p.marketValue)
    const totalPoolValue = allValues.reduce((a, b) => a + b, 0)
    const avgValue = numTeams > 0 ? totalPoolValue / numTeams : 0
    const maxValue = Math.max(...allValues, 1)

    return {
      position: pos,
      userValue,
      leagueAvgValue: Math.round(avgValue),
      leagueMaxValue: maxValue,
      strengthPct: avgValue > 0 ? Math.round((userValue / avgValue) * 100) : 50,
      playerCount: userPlayers.length,
    }
  })
}

export function computeRosterProfile(roster: AdaptivePlayerRank[]) {
  const ages = roster.filter(p => p.age).map(p => p.age!) 
  const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 25
  const youngCount = ages.filter(a => a <= 24).length
  const primeCount = ages.filter(a => a >= 25 && a <= 28).length
  const veteranCount = ages.filter(a => a >= 29).length

  const totalValue = roster.reduce((sum, p) => sum + p.marketValue, 0)
  const posValues: Record<string, number> = {}
  const posCounts: Record<string, number> = {}
  for (const p of roster) {
    posValues[p.position] = (posValues[p.position] || 0) + p.marketValue
    posCounts[p.position] = (posCounts[p.position] || 0) + 1
  }

  const topPlayers = [...roster].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5)
  const concentration = topPlayers.reduce((s, p) => s + p.marketValue, 0) / Math.max(totalValue, 1)

  return {
    avgAge: Math.round(avgAge * 10) / 10,
    youngCount,
    primeCount,
    veteranCount,
    totalValue,
    posValues,
    posCounts,
    assetConcentration: Math.round(concentration * 100),
    rosterSize: roster.length,
  }
}
