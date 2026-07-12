import type { FantasyCalcPlayer } from '@/lib/player-valuations/canonicalPlayerValuations'
import { computePlayerVorp, estimatePPGFromValue, type LeagueRosterConfig } from '@/lib/vorp-engine'
import { computePlayerDemandScore, type LeagueDemandIndex } from './league-demand-index'

export type RankingView = 'global' | 'league' | 'team' | 'win_now' | 'rebuild' | 'consolidate'

export interface AdaptivePlayerRank {
  playerId: string
  name: string
  position: string
  team: string | null
  age: number | null

  marketRank: number
  marketValue: number

  impactRank: number
  impactScore: number
  estimatedPPG: number

  scarcityRank: number
  scarcityScore: number
  scarcityFactors: {
    volatilityFit: number
    ageCurveFit: number
    positionalScarcity: number
    rosterNeedFit: number
  }

  demandRank: number
  demandScore: number

  compositeRank: number
  compositeScore: number

  trend30Day: number
  positionRank: number
  isOnUserRoster: boolean
}

export interface AdaptiveRankingsOutput {
  players: AdaptivePlayerRank[]
  viewMode: RankingView
  leagueConfig: LeagueRosterConfig
  totalPlayers: number
  userRosterSize: number
}

interface RosterProfile {
  avgAge: number
  positionCounts: Record<string, number>
  positionValues: Record<string, number>
  totalValue: number
  playerIds: Set<string>
}

const VIEW_WEIGHTS: Record<string, { market: number; impact: number; portfolio: number; demand: number }> = {
  global:      { market: 0.45, impact: 0.35, portfolio: 0.20, demand: 0.00 },
  league:      { market: 0.35, impact: 0.30, portfolio: 0.15, demand: 0.20 },
  team:        { market: 0.15, impact: 0.35, portfolio: 0.35, demand: 0.15 },
  win_now:     { market: 0.20, impact: 0.55, portfolio: 0.20, demand: 0.05 },
  rebuild:     { market: 0.55, impact: 0.15, portfolio: 0.10, demand: 0.20 },
  consolidate: { market: 0.00, impact: 0.30, portfolio: 0.15, demand: 0.00 },
}

const POSITION_SCARCITY_BASE: Record<string, number> = {
  QB: 0.60,
  RB: 0.75,
  WR: 0.50,
  TE: 0.80,
}

const AGE_CURVES: Record<string, { peak: number; dropoff: number }> = {
  QB: { peak: 28, dropoff: 34 },
  RB: { peak: 24, dropoff: 28 },
  WR: { peak: 26, dropoff: 31 },
  TE: { peak: 27, dropoff: 31 },
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

export function percentileScore(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 50
  const below = allValues.filter(v => v < value).length
  const equal = allValues.filter(v => v === value).length
  return ((below + equal * 0.5) / allValues.length) * 100
}

function buildRosterProfile(
  userPlayerIds: string[],
  fcPlayers: FantasyCalcPlayer[],
): RosterProfile {
  const ids = new Set(userPlayerIds)
  const positionCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  const positionValues: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  let totalValue = 0
  let ageSum = 0
  let ageCount = 0

  for (const fc of fcPlayers) {
    if (!ids.has(fc.player.sleeperId)) continue
    const pos = fc.player.position?.toUpperCase() || ''
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue

    positionCounts[pos] = (positionCounts[pos] || 0) + 1
    positionValues[pos] = (positionValues[pos] || 0) + fc.value
    totalValue += fc.value

    if (fc.player.maybeAge) {
      ageSum += fc.player.maybeAge
      ageCount++
    }
  }

  return {
    avgAge: ageCount > 0 ? ageSum / ageCount : 25,
    positionCounts,
    positionValues,
    totalValue,
    playerIds: ids,
  }
}

function computeImpactScore(
  fc: FantasyCalcPlayer,
  config: LeagueRosterConfig,
  allPlayers: FantasyCalcPlayer[],
): number {
  const pos = fc.player.position?.toUpperCase() || ''
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) return 0

  const ppg = estimatePPGFromValue(pos, fc.value, fc.redraftValue, allPlayers)
  const vorp = computePlayerVorp(pos, fc.positionRank, fc.redraftValue, config, allPlayers)

  let sfBonus = 0
  if (pos === 'QB' && config.superflex) {
    sfBonus = Math.min(20, fc.value * 0.001)
  }

  let tepBonus = 0
  if (pos === 'TE') {
    tepBonus = Math.min(10, fc.value * 0.0005)
  }

  return Math.round(ppg * 3 + vorp * 0.01 + sfBonus + tepBonus)
}

function computeCompositeScore(
  view: RankingView,
  ms: number,
  is: number,
  ss: number,
  ds: number,
): number {
  if (view === 'consolidate') {
    return Math.round(0.55 * ((ms + ds) / 2) + 0.30 * is + 0.15 * ss)
  }

  const weights = VIEW_WEIGHTS[view] || VIEW_WEIGHTS['global']
  return Math.round(
    ms * weights.market +
    is * weights.impact +
    ss * weights.portfolio +
    ds * weights.demand
  )
}

export function computeAdaptiveRankings(
  fcPlayers: FantasyCalcPlayer[],
  userPlayerIds: string[],
  config: LeagueRosterConfig,
  ldi: LeagueDemandIndex,
  view: RankingView = 'global',
  limit: number = 200,
): AdaptiveRankingsOutput {
  const profile = buildRosterProfile(userPlayerIds, fcPlayers)

  const skillPlayers = fcPlayers
    .filter(fc => {
      const pos = fc.player.position?.toUpperCase() || ''
      return ['QB', 'RB', 'WR', 'TE'].includes(pos) && fc.value > 0
    })
    .sort((a, b) => b.value - a.value)

  const allMarketValues = skillPlayers.map(fc => fc.value)
  const allPPGs: number[] = []
  const allVORPs: number[] = []

  for (const fc of skillPlayers) {
    const pos = fc.player.position?.toUpperCase() || ''
    const ppg = estimatePPGFromValue(pos, fc.value, fc.redraftValue, fcPlayers)
    allPPGs.push(ppg)
    const vorp = computePlayerVorp(pos, fc.positionRank, fc.redraftValue, config, fcPlayers)
    allVORPs.push(vorp)
  }

  const ranked: AdaptivePlayerRank[] = skillPlayers.map((fc, idx) => {
    const pos = fc.player.position?.toUpperCase() || ''
    const impactScore = computeImpactScore(fc, config, fcPlayers)
    const demandScore = computePlayerDemandScore(fc.player.name, pos, ldi)
    const ppg = estimatePPGFromValue(pos, fc.value, fc.redraftValue, fcPlayers)
    const vorp = computePlayerVorp(pos, fc.positionRank, fc.redraftValue, config, fcPlayers)

    const ms = clamp(percentileScore(fc.value, allMarketValues), 0, 100)
    const is = clamp(percentileScore(ppg, allPPGs), 0, 100)
    const ss = clamp(percentileScore(vorp, allVORPs), 0, 100)
    const ds = clamp(demandScore, 0, 100)

    const compositeScore = computeCompositeScore(view, ms, is, ss, ds)

    return {
      playerId: fc.player.sleeperId,
      name: fc.player.name,
      position: pos,
      team: fc.player.maybeTeam || null,
      age: fc.player.maybeAge || null,
      marketRank: idx + 1,
      marketValue: fc.value,
      impactRank: 0,
      impactScore,
      estimatedPPG: Math.round(ppg * 10) / 10,
      scarcityRank: 0,
      scarcityScore: Math.round(ss),
      scarcityFactors: {
        volatilityFit: clamp(100 - (fc.maybeMovingStandardDeviationPerc ?? 15) * 2, 0, 100),
        ageCurveFit: computeAgeCurveFit(fc),
        positionalScarcity: Math.round((POSITION_SCARCITY_BASE[pos] || 0.5) * 100),
        rosterNeedFit: profile.playerIds.has(fc.player.sleeperId) ? 50 : 70,
      },
      demandRank: 0,
      demandScore,
      compositeRank: 0,
      compositeScore,
      trend30Day: fc.trend30Day,
      positionRank: fc.positionRank,
      isOnUserRoster: profile.playerIds.has(fc.player.sleeperId),
    }
  })

  ranked.sort((a, b) => b.impactScore - a.impactScore)
  ranked.forEach((r, i) => { r.impactRank = i + 1 })

  ranked.sort((a, b) => b.scarcityScore - a.scarcityScore)
  ranked.forEach((r, i) => { r.scarcityRank = i + 1 })

  ranked.sort((a, b) => b.demandScore - a.demandScore)
  ranked.forEach((r, i) => { r.demandRank = i + 1 })

  ranked.sort((a, b) => b.compositeScore - a.compositeScore)
  ranked.forEach((r, i) => { r.compositeRank = i + 1 })

  return {
    players: ranked.slice(0, limit),
    viewMode: view,
    leagueConfig: config,
    totalPlayers: ranked.length,
    userRosterSize: profile.playerIds.size,
  }
}

function computeAgeCurveFit(fc: FantasyCalcPlayer): number {
  const pos = fc.player.position?.toUpperCase() || ''
  const age = fc.player.maybeAge ?? 25
  const curve = AGE_CURVES[pos] || { peak: 26, dropoff: 30 }
  let fit: number
  if (age <= curve.peak) {
    fit = 80 + (curve.peak - age) * 2
  } else if (age <= curve.dropoff) {
    fit = 80 - ((age - curve.peak) / (curve.dropoff - curve.peak)) * 40
  } else {
    fit = Math.max(10, 40 - (age - curve.dropoff) * 10)
  }
  return Math.round(clamp(fit, 0, 100))
}
