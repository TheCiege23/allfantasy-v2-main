// ============================================
// LAYER A: LEAGUE INTELLIGENCE (Deterministic)
// ============================================

import {
  Asset,
  ManagerProfile,
  LeagueSettings,
  LeagueIntelligence,
  Thresholds,
  Constraints,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONSTRAINTS,
  PickProjected,
  ContenderTier
} from './types'
import { normalizedFaabValue } from '@/lib/trade-value/faabValue'

// ============================================
// HELPERS
// ============================================

export function isIdpPos(pos?: string): boolean {
  const p = (pos || '').toUpperCase()
  return (
    p === 'DL' || p === 'LB' || p === 'DB' || p === 'EDGE' || p === 'IDP' ||
    p === 'DE' || p === 'DT' || p === 'CB' || p === 'S' || p === 'SS' || p === 'FS'
  )
}

export function computeStarterStrengthIndex(assets: Asset[], starterSlots: number): number {
  const starters = assets
    .filter(a => a.type === 'PLAYER' && a.value >= 2000)
    .sort((a, b) => b.value - a.value)
    .slice(0, starterSlots)
  return starters.reduce((sum, a) => sum + a.value, 0)
}

// ============================================
// CORNERSTONE CLASSIFICATION
// ============================================

export function classifyCornerstone(
  asset: Asset,
  settings: LeagueSettings,
  thresholds: Thresholds = DEFAULT_THRESHOLDS
): Asset {
  if (asset.isCornerstone !== undefined) return asset

  let isCornerstone = false
  let reason = ''

  if (asset.type === 'FAAB') {
    return { ...asset, isCornerstone: false, cornerstoneReason: '' }
  }

  if (asset.type === 'PICK') {
    if (asset.round === 1 && asset.projected === 'early' && thresholds.EARLY_1ST_CORNERSTONE) {
      isCornerstone = true
      reason = 'Early 1st is a cornerstone pick.'
    }
    return { ...asset, isCornerstone, cornerstoneReason: reason }
  }

  const pos = (asset.pos || '').toUpperCase()

  if (pos === 'QB') {
    const threshold = settings.isSF ? thresholds.QB_CORNERSTONE_SF : thresholds.QB_CORNERSTONE_1QB
    if (asset.value >= threshold) {
      isCornerstone = true
      reason = settings.isSF ? 'Elite SF QB cornerstone.' : 'Elite 1QB QB cornerstone.'
    }
  }

  if (pos === 'TE') {
    const threshold = settings.isTEP ? thresholds.TE_CORNERSTONE_TEP : thresholds.TE_CORNERSTONE_STD
    if (asset.value >= threshold) {
      isCornerstone = true
      reason = settings.isTEP ? 'Elite TE in TE premium.' : 'Elite TE cornerstone.'
    }
  }

  if ((pos === 'WR' || pos === 'RB') && asset.value >= thresholds.SKILL_CORNERSTONE) {
    isCornerstone = true
    reason = 'Elite skill cornerstone.'
  }

  if (isIdpPos(pos) && settings.idpEnabled) {
    const idpThreshold =
      pos === 'LB' ? 4000 : pos === 'DL' || pos === 'DE' || pos === 'DT' ? 4500 : 5000
    if (asset.value >= idpThreshold) {
      isCornerstone = true
      reason = `Elite IDP ${pos} cornerstone.`
    }
  }

  return { ...asset, isCornerstone, cornerstoneReason: reason }
}

// ============================================
// PICK PROJECTIONS
// ============================================

export function inferPickProjection(teamRank: number, numTeams: number): PickProjected {
  if (!Number.isFinite(teamRank) || teamRank <= 0) return 'unknown'
  const third = Math.ceil(numTeams / 3)
  if (teamRank > numTeams - third) return 'early'
  if (teamRank > third) return 'mid'
  return 'late'
}

export function computePickProjections(
  managers: Array<{ odId: string; wins: number; pointsFor: number }>,
  numTeams: number
): Record<string, PickProjected> {
  const sorted = [...managers].sort((a, b) => {
    const winDiff = b.wins - a.wins
    if (winDiff !== 0) return winDiff
    return b.pointsFor - a.pointsFor
  })

  const projections: Record<string, PickProjected> = {}
  sorted.forEach((m, idx) => {
    projections[m.odId] = inferPickProjection(idx + 1, numTeams)
  })
  return projections
}

// ============================================
// CONTENDER TIER
// ============================================

export function computeContenderTier(
  wins: number,
  losses: number,
  pointsFor: number,
  leagueAvgPoints: number,
  starterCount: number,
  youngAssetCount: number,
  pickCount: number,
  isChampion: boolean
): ContenderTier {
  if (isChampion) return 'champion'
  
  const winPct = wins / Math.max(wins + losses, 1)
  const pointsAboveAvg = pointsFor > leagueAvgPoints * 1.05
  const hasStarters = starterCount >= 6
  const hasFuture = youngAssetCount >= 3 || pickCount >= 3

  if (winPct >= 0.6 && pointsAboveAvg && hasStarters) return 'contender'
  if (winPct <= 0.4 || (!hasStarters && hasFuture)) return 'rebuild'
  return 'middle'
}

// ============================================
// NEEDS/SURPLUS
// ============================================

export function computeNeedsSurplus(
  assets: Asset[],
  settings: LeagueSettings
): { needs: string[]; surplus: string[] } {
  const posCount: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  const startableByPos: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }

  for (const asset of assets) {
    if (asset.type === 'PLAYER' && asset.pos) {
      const pos = asset.pos.toUpperCase()
      posCount[pos] = (posCount[pos] || 0) + 1
      if (asset.value >= 2000) {
        startableByPos[pos] = (startableByPos[pos] || 0) + 1
      }
    }
  }

  const needs: string[] = []
  const surplus: string[] = []

  const requirements: Record<string, number> = {
    QB: settings.startingQB ?? 1,
    RB: (settings.startingRB ?? 2) + Math.floor((settings.startingFlex ?? 1) * 0.4),
    WR: (settings.startingWR ?? 2) + Math.floor((settings.startingFlex ?? 1) * 0.5),
    TE: settings.startingTE ?? 1,
  }

  if (settings.idpEnabled && Array.isArray(settings.rosterPositions)) {
    const rp = (settings.rosterPositions as string[]).map((p) => (p || '').toUpperCase())
    for (const pos of ['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB', 'IDP_FLEX']) {
      const count = rp.filter((p) => p === pos).length
      if (count > 0) requirements[pos] = count
    }
    for (const pos of ['DE', 'DT', 'LB', 'CB', 'S', 'SS', 'FS']) {
      posCount[pos] = posCount[pos] ?? 0
      startableByPos[pos] = startableByPos[pos] ?? 0
    }
    const idpFlexCount = rp.filter((p) => p === 'IDP_FLEX').length
    const dlCount = rp.filter((p) => p === 'DL').length
    const dbCount = rp.filter((p) => p === 'DB').length
    if (idpFlexCount > 0 || dlCount > 0 || dbCount > 0) {
      const idpStartable =
        (startableByPos['DE'] || 0) + (startableByPos['DT'] || 0) + (startableByPos['LB'] || 0) +
        (startableByPos['CB'] || 0) + (startableByPos['S'] || 0) + (startableByPos['SS'] || 0) + (startableByPos['FS'] || 0)
      const idpRequired =
        (requirements['DE'] || 0) + (requirements['DT'] || 0) + (requirements['LB'] || 0) +
        (requirements['CB'] || 0) + (requirements['S'] || 0) + (requirements['DL'] || 0) * 2 +
        (requirements['DB'] || 0) * 2 + (requirements['IDP_FLEX'] || 0)
      if (idpStartable < idpRequired) needs.push('IDP')
      if (idpStartable > idpRequired + 4) surplus.push('IDP')
    }
  }

  for (const [pos, required] of Object.entries(requirements)) {
    if (pos === 'DL' || pos === 'DB' || pos === 'IDP_FLEX') continue
    const startable = startableByPos[pos] || 0
    if (startable < required) needs.push(pos)
    if (startable > required + 2) surplus.push(pos)
  }

  return { needs, surplus }
}

// ============================================
// PICK VALUE
// ============================================

export function estimatePickValue(round: number, projected: PickProjected, seasonOffset: number = 0): number {
  const baseValues: Record<number, Record<PickProjected, number>> = {
    1: { early: 8500, mid: 6500, late: 5000, unknown: 6500 },
    2: { early: 4000, mid: 3000, late: 2000, unknown: 3000 },
    3: { early: 1800, mid: 1400, late: 1000, unknown: 1400 },
    4: { early: 800, mid: 600, late: 400, unknown: 600 }
  }

  let value = baseValues[round]?.[projected] || 500
  if (seasonOffset > 0) value = Math.round(value * Math.pow(0.90, seasonOffset))
  else if (seasonOffset < 0) value = Math.round(value * 0.5)
  return value
}

// ============================================
// BUILD LEAGUE INTELLIGENCE
// ============================================

export type SleeperRosterInput = {
  rosterId: number
  ownerId: string
  ownerUsername?: string
  ownerName: string
  avatar?: string
  players: Array<{
    id: string
    name: string
    pos: string
    team?: string
    age?: number
    slot: 'Starter' | 'Bench' | 'IR' | 'Taxi'
  }>
  picks: Array<{
    season: number
    round: number
    originalOwner: string
    isOwnPick: boolean
    displayName: string
  }>
  faabRemaining?: number
  wins: number
  losses: number
  ties?: number
  pointsFor: number
  tradeHistory?: {
    totalTrades: number
    prefersYouth: boolean
    prefersPicks: boolean
    prefersConsolidation: boolean
  }
}

export type FantasyCalcValueMap = Record<string, { value: number; overallRank?: number; trend30Day?: number }>

export function buildLeagueIntelligence(
  settings: LeagueSettings,
  rosters: SleeperRosterInput[],
  fantasyCalcValues: FantasyCalcValueMap,
  previousChampionId?: string,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  constraints: Constraints = DEFAULT_CONSTRAINTS
): LeagueIntelligence {
  const leagueAvgPoints = rosters.reduce((sum, r) => sum + r.pointsFor, 0) / rosters.length
  const currentYear = new Date().getFullYear()

  // Build standings
  const sorted = [...rosters].sort((a, b) => {
    const winDiff = b.wins - a.wins
    if (winDiff !== 0) return winDiff
    return b.pointsFor - a.pointsFor
  })
  const standingsMap = new Map<string, number>()
  sorted.forEach((r, idx) => standingsMap.set(r.ownerId, idx + 1))

  const topTwoIds = new Set([sorted[0]?.ownerId, sorted[1]?.ownerId])

  // Build pick projections
  const pickProjections: Record<string, PickProjected> = {}
  sorted.forEach((r, idx) => {
    pickProjections[r.ownerId] = inferPickProjection(idx + 1, settings.numTeams)
  })

  const assetsByRosterId: Record<number, Asset[]> = {}
  const managerProfiles: Record<number, ManagerProfile> = {}

  for (const roster of rosters) {
    const assets: Asset[] = []

    // Players
    for (const player of roster.players) {
      const fcData = fantasyCalcValues[player.name.toLowerCase()]
      let asset: Asset = {
        id: `player:${player.id}`,
        type: 'PLAYER',
        value: fcData?.value || 200,
        name: player.name,
        pos: player.pos,
        team: player.team,
        age: player.age,
        slot: player.slot,
        isIdp: isIdpPos(player.pos),
        tags: [player.slot.toLowerCase()]
      }
      asset = classifyCornerstone(asset, settings, thresholds)
      assets.push(asset)
    }

    // Picks
    for (const pick of roster.picks) {
      const seasonOffset = pick.season - currentYear
      const projected = pick.isOwnPick
        ? pickProjections[roster.ownerId] || 'mid'
        : pickProjections[pick.originalOwner] || 'unknown'
      const value = estimatePickValue(pick.round, projected, seasonOffset)

      let asset: Asset = {
        id: `pick:${pick.season}_${pick.round}_${pick.originalOwner}`,
        type: 'PICK',
        value,
        pickSeason: pick.season,
        round: pick.round as 1 | 2 | 3 | 4,
        projected,
        displayName: pick.displayName,
        tags: pick.isOwnPick ? ['own'] : ['acquired']
      }
      asset = classifyCornerstone(asset, settings, thresholds)
      assets.push(asset)
    }

    // FAAB
    if (roster.faabRemaining && roster.faabRemaining > 0) {
      assets.push({
        id: `faab:${roster.rosterId}`,
        type: 'FAAB',
        /*
         * 🛑 WAS `* 20` — a FOURTH per-dollar rate for the one conversion, and the only one
         * that never matched any of the others. Players in this same inventory are valued from
         * `fantasyCalcValues` (line ~319), so FAAB sits on the identical 0–10000 scale and the
         * rate had no business differing.
         *
         * ⚠ THIS ONE MOVES A NUMBER, unlike the trade-discovery swap beside it: 20/dollar
         * becomes 18/dollar, so a manager's FAAB asset in the league inventory drops ~10%
         * ($100 remaining: 2000 → 1800). 18 is the rate the canonical engine has always used
         * and the one the other three surfaces now agree on; 20 is unattributed and appears
         * nowhere else.
         *
         * ⚠ `faabRemaining` is a BALANCE, not the league's season budget, so no budget is
         * passed — the default applies, as it does in trade discovery. Accurate today, and one
         * argument away from being league-exact when a budget reaches this layer.
         */
        value: normalizedFaabValue(roster.faabRemaining),
        faabAmount: roster.faabRemaining,
        isCornerstone: false,
        tags: ['faab']
      })
    }

    assetsByRosterId[roster.rosterId] = assets

    const { needs, surplus } = computeNeedsSurplus(assets, settings)
    const youngAssets = assets.filter(a => a.type === 'PLAYER' && a.age && a.age <= 24)
    const picks = assets.filter(a => a.type === 'PICK')
    const starters = assets.filter(a => a.type === 'PLAYER' && a.value >= 3000)
    const isChampion = previousChampionId === roster.ownerId
    const isTopTwo = topTwoIds.has(roster.ownerId)
    const standingsRank = standingsMap.get(roster.ownerId) || 99

    const contenderTier = computeContenderTier(
      roster.wins, roster.losses, roster.pointsFor, leagueAvgPoints,
      starters.length, youngAssets.length, picks.length, isChampion
    )

    const th = roster.tradeHistory
    const tradeAggression = th && th.totalTrades >= 5 ? 'high' :
                            th && th.totalTrades >= 2 ? 'medium' : 'low'

    managerProfiles[roster.rosterId] = {
      rosterId: roster.rosterId,
      userId: roster.ownerId,
      username: roster.ownerUsername,
      displayName: roster.ownerName,
      avatar: roster.avatar,
      record: { wins: roster.wins, losses: roster.losses, ties: roster.ties },
      pointsFor: roster.pointsFor,
      isChampion,
      isTopTwo,
      standingsRank,
      contenderTier,
      starterStrengthIndex: computeStarterStrengthIndex(assets, settings.starterSlots),
      needs,
      surplus,
      tradeAggression,
      prefersYouth: th?.prefersYouth || false,
      prefersPicks: th?.prefersPicks || false,
      prefersConsolidation: th?.prefersConsolidation || false,
      assets,
      faabRemaining: roster.faabRemaining
    }
  }

  const totalTrades = rosters.reduce((sum, r) => sum + (r.tradeHistory?.totalTrades || 0), 0)
  const leagueTradeFrequency = totalTrades >= rosters.length * 3 ? 'high' :
                                totalTrades >= rosters.length ? 'medium' : 'low'

  const mostActiveTraders = Object.values(managerProfiles)
    .filter(m => m.tradeAggression === 'high')
    .map(m => m.displayName)

  return {
    settings,
    assetsByRosterId,
    managerProfiles,
    pickProjections,
    thresholds,
    constraints,
    leagueTradeFrequency,
    mostActiveTraders
  }
}

// ============================================
// LEAGUE INTEL SNAPSHOT (Simplified)
// ============================================

import { buildTradeBlockIndex, TradeBlockEntry } from './tradeBlock'

export type ScoringProfile = {
  ppr: number
  tepBonus: number
  isSF: boolean
  isTEP: boolean
}

export type LeagueIntelSnapshot = {
  assetsByRosterId: Record<number, Asset[]>
  managerProfiles: Record<number, ManagerProfile>
  scoringProfile: ScoringProfile
  tradeBlockIndex: ReturnType<typeof buildTradeBlockIndex>
}

export async function buildLeagueIntel(params: {
  rosters: SleeperRosterInput[]
  fantasyCalcValues: FantasyCalcValueMap
  settings: LeagueSettings
  tradeBlockEntries?: TradeBlockEntry[]
  previousChampionId?: string
}): Promise<LeagueIntelSnapshot> {
  const { rosters, fantasyCalcValues, settings, tradeBlockEntries = [], previousChampionId } = params

  const intel = buildLeagueIntelligence(settings, rosters, fantasyCalcValues, previousChampionId)

  const scoringProfile: ScoringProfile = {
    ppr: settings.ppr ?? 1,
    tepBonus: settings.tepBonus ?? 0,
    isSF: settings.isSF,
    isTEP: settings.isTEP,
  }

  const tradeBlockIndex = buildTradeBlockIndex(tradeBlockEntries)

  return {
    assetsByRosterId: intel.assetsByRosterId,
    managerProfiles: intel.managerProfiles,
    scoringProfile,
    tradeBlockIndex,
  }
}
