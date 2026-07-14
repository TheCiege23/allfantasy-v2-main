import { FantasyCalcPlayer } from '@/lib/player-valuations/canonicalPlayerValuations'

export interface LeagueRosterConfig {
  numTeams: number
  startingQB: number
  startingRB: number
  startingWR: number
  startingTE: number
  startingFlex: number
  superflex: boolean
}

const DEFAULT_LEAGUE_CONFIG: LeagueRosterConfig = {
  numTeams: 12,
  startingQB: 1,
  startingRB: 2,
  startingWR: 2,
  startingTE: 1,
  startingFlex: 2,
  superflex: false,
}

const POSITION_PPG_ANCHORS: Record<string, { top1: number; top12: number; top24: number; top36: number; replacement: number }> = {
  QB: { top1: 25.0, top12: 19.5, top24: 16.0, top36: 13.5, replacement: 11.0 },
  RB: { top1: 22.0, top12: 14.5, top24: 10.0, top36: 7.0, replacement: 4.5 },
  WR: { top1: 20.0, top12: 14.0, top24: 10.5, top36: 7.5, replacement: 4.0 },
  TE: { top1: 17.0, top12: 10.0, top24: 6.5, top36: 4.5, replacement: 3.0 },
}

const FLEX_POSITION_SHARES: Record<string, number> = {
  RB: 0.40,
  WR: 0.40,
  TE: 0.20,
}

const SUPERFLEX_QB_SHARE = 0.55

export function computeReplacementThreshold(
  position: string,
  config: LeagueRosterConfig = DEFAULT_LEAGUE_CONFIG
): number {
  const pos = position.toUpperCase()
  const { numTeams, startingQB, startingRB, startingWR, startingTE, startingFlex, superflex } = config

  const dedicatedStarters: Record<string, number> = {
    QB: startingQB,
    RB: startingRB,
    WR: startingWR,
    TE: startingTE,
  }

  const dedicated = (dedicatedStarters[pos] ?? 0) * numTeams

  let flexContribution = 0
  if (pos === 'QB') {
    if (superflex) {
      flexContribution = Math.round(SUPERFLEX_QB_SHARE * numTeams)
    }
  } else if (FLEX_POSITION_SHARES[pos] != null) {
    const share = FLEX_POSITION_SHARES[pos]
    const regularFlexSlots = superflex ? Math.max(0, startingFlex - 1) : startingFlex
    flexContribution = Math.round(share * regularFlexSlots * numTeams)
  }

  return dedicated + flexContribution
}

export function estimatePPGFromRank(
  position: string,
  positionRank: number,
  totalAtPosition: number
): number {
  const pos = position.toUpperCase()
  const anchors = POSITION_PPG_ANCHORS[pos]
  if (!anchors) return 5.0

  const rank = Math.max(1, positionRank)

  if (rank <= 1) return anchors.top1
  if (rank <= 12) return lerp(anchors.top1, anchors.top12, (rank - 1) / 11)
  if (rank <= 24) return lerp(anchors.top12, anchors.top24, (rank - 12) / 12)
  if (rank <= 36) return lerp(anchors.top24, anchors.top36, (rank - 24) / 12)

  const decay = 0.92
  const stepsBelow36 = rank - 36
  return Math.max(1.0, anchors.top36 * Math.pow(decay, stepsBelow36))
}

export function estimatePPGFromValue(
  position: string,
  dynastyValue: number,
  redraftValue: number,
  fcPlayers: FantasyCalcPlayer[]
): number {
  const pos = position.toUpperCase()
  const anchors = POSITION_PPG_ANCHORS[pos]
  if (!anchors) return 5.0

  const posPlayers = fcPlayers
    .filter(p => p.player.position?.toUpperCase() === pos)
    .sort((a, b) => b.redraftValue - a.redraftValue)

  if (posPlayers.length === 0) {
    const maxRedraft = pos === 'QB' ? 8000 : pos === 'RB' ? 7000 : pos === 'WR' ? 6500 : 4000
    const percentile = Math.min(1, Math.max(0, redraftValue / maxRedraft))
    return lerp(anchors.replacement, anchors.top1, percentile)
  }

  const topValue = posPlayers[0]?.redraftValue ?? 1
  const percentile = Math.min(1, Math.max(0, redraftValue / topValue))

  return lerp(anchors.replacement, anchors.top1, Math.pow(percentile, 0.7))
}

export function computeReplacementPPG(
  position: string,
  config: LeagueRosterConfig,
  fcPlayers: FantasyCalcPlayer[]
): number {
  const pos = position.toUpperCase()
  const threshold = computeReplacementThreshold(pos, config)

  const posPlayers = fcPlayers
    .filter(p => p.player.position?.toUpperCase() === pos)
    .sort((a, b) => b.redraftValue - a.redraftValue)

  if (posPlayers.length === 0) {
    return POSITION_PPG_ANCHORS[pos]?.replacement ?? 4.0
  }

  const windowStart = Math.max(0, threshold - 3)
  const windowEnd = Math.min(posPlayers.length - 1, threshold + 2)

  if (windowStart >= posPlayers.length) {
    const lastRank = posPlayers.length
    return estimatePPGFromRank(pos, lastRank, posPlayers.length)
  }

  let ppgSum = 0
  let count = 0
  for (let i = windowStart; i <= windowEnd; i++) {
    ppgSum += estimatePPGFromRank(pos, i + 1, posPlayers.length)
    count++
  }

  return count > 0 ? ppgSum / count : (POSITION_PPG_ANCHORS[pos]?.replacement ?? 4.0)
}

export function computePlayerVorp(
  position: string,
  positionRank: number,
  redraftValue: number,
  config: LeagueRosterConfig,
  fcPlayers: FantasyCalcPlayer[]
): number {
  const pos = position.toUpperCase()
  const totalAtPos = fcPlayers.filter(p => p.player.position?.toUpperCase() === pos).length

  let playerPPG: number
  if (positionRank > 0 && positionRank <= totalAtPos) {
    playerPPG = estimatePPGFromRank(pos, positionRank, totalAtPos)
  } else {
    playerPPG = estimatePPGFromValue(pos, 0, redraftValue, fcPlayers)
  }

  const replacementPPG = computeReplacementPPG(pos, config, fcPlayers)

  const weeklyVorp = Math.max(0, playerPPG - replacementPPG)
  const seasonWeeks = 17
  return Math.round(weeklyVorp * seasonWeeks * 50)
}

export function computePickVorp(
  impactValue: number,
  round: number
): number {
  const replacementPickImpact: Record<number, number> = { 1: 0, 2: 200, 3: 400, 4: 600 }
  const baseline = replacementPickImpact[round] ?? 800
  return Math.max(0, impactValue - baseline)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

export function describeReplacementLevel(
  position: string,
  config: LeagueRosterConfig,
  fcPlayers: FantasyCalcPlayer[]
): {
  threshold: number
  replacementPPG: number
  replacementPlayerName: string | null
} {
  const pos = position.toUpperCase()
  const threshold = computeReplacementThreshold(pos, config)
  const replacementPPG = computeReplacementPPG(pos, config, fcPlayers)

  const posPlayers = fcPlayers
    .filter(p => p.player.position?.toUpperCase() === pos)
    .sort((a, b) => b.redraftValue - a.redraftValue)

  const replacementPlayerName = posPlayers[threshold - 1]?.player.name ?? null

  return { threshold, replacementPPG, replacementPlayerName }
}
