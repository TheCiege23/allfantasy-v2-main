// ============================================
// LAYER A: LEAGUE INTELLIGENCE (Deterministic)
// ============================================

import { Asset, LeagueSettings, Thresholds, DEFAULT_THRESHOLDS, PickProjected } from './types'

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

/**
 * Upper-cased sport when it is NBA, MLB or NHL — sports whose cornerstone rule is a single,
 * position-agnostic value bar — else null (NFL and unknown sports keep the positional rules).
 */
function nonNflCornerstoneSport(sport: string | null | undefined): 'NBA' | 'MLB' | 'NHL' | null {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NBA' || s === 'MLB' || s === 'NHL' ? s : null
}

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

  /*
   * NBA/MLB/NHL: the QB/TE/WR/RB/IDP rules below are NFL scarcity rules, so no basketball,
   * baseball or hockey player could ever be a cornerstone — and MLB "SS"/"C" collide with the IDP
   * and NFL tokens. Those sports have no SF-QB/TEP-style positional premium, so one value bar,
   * the same one an elite NFL skill player clears, applies to every position. See
   * `nonNflCornerstoneSport`.
   */
  const nonNfl = nonNflCornerstoneSport(settings.sport)
  if (nonNfl) {
    if (asset.value >= thresholds.SKILL_CORNERSTONE) {
      return { ...asset, isCornerstone: true, cornerstoneReason: `Elite ${nonNfl} cornerstone.` }
    }
    return { ...asset, isCornerstone: false, cornerstoneReason: '' }
  }

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

// ============================================
// CONTENDER TIER
// ============================================

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

// ============================================
// LEAGUE INTEL SNAPSHOT (Simplified)
// ============================================

