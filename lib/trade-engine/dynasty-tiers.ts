// lib/trade-engine/dynasty-tiers.ts
import { Asset, LeagueContext } from './types'
import { nonNflCornerstoneSport } from './league-intelligence'

export type Thresholds = {
  QB_CORNERSTONE_SF: number
  QB_CORNERSTONE_1QB: number
  TE_CORNERSTONE_TEP: number
  TE_CORNERSTONE_STD: number
  SKILL_CORNERSTONE: number
  IDP_CORNERSTONE?: number
}

export function defaultThresholds(): Thresholds {
  return {
    QB_CORNERSTONE_SF: 7500,
    QB_CORNERSTONE_1QB: 9500,
    TE_CORNERSTONE_TEP: 6500,
    TE_CORNERSTONE_STD: 8000,
    SKILL_CORNERSTONE: 9000,
    IDP_CORNERSTONE: 6500,
  }
}

/**
 * NOTE: the live trade engine classifies with `classifyCornerstone` in `./league-intelligence`
 * (this module had no importers when it was made sport-aware); both apply the same rule.
 *
 * `league.sport` NBA/MLB/NHL: those sports have no SF-QB/TEP-style positional premium, so one
 * position-agnostic bar (`SKILL_CORNERSTONE`) applies to every player. NFL/unset is unchanged.
 */
export function classifyCornerstone(asset: Asset, league: LeagueContext & { sport?: string | null }, t: Thresholds): Asset {
  if (asset.type === 'FAAB') return { ...asset, isCornerstone: false }
  if (asset.type === 'PICK') {
    // early 1st cornerstone only
    if (asset.round === 1 && asset.projected === 'early') {
      return { ...asset, isCornerstone: true, cornerstoneReason: 'Early 1st is a cornerstone pick.' }
    }
    return { ...asset, isCornerstone: false }
  }

  const nonNfl = nonNflCornerstoneSport(league.sport)
  if (nonNfl) {
    if (asset.value >= t.SKILL_CORNERSTONE) {
      return { ...asset, isCornerstone: true, cornerstoneReason: `Elite ${nonNfl} cornerstone.` }
    }
    return { ...asset, isCornerstone: false }
  }

  const pos = (asset.pos || '').toUpperCase()
  const sf = !!league.isSF
  const tep = !!league.isTEP && (league.tepBonus ?? 0) >= 0.25

  // IDP: only treat as cornerstone if you have tuned values
  if (asset.isIdp) {
    const thr = t.IDP_CORNERSTONE ?? 999999
    if (asset.value >= thr) {
      return { ...asset, isCornerstone: true, cornerstoneReason: 'Elite IDP cornerstone (scoring-aware).' }
    }
    return { ...asset, isCornerstone: false }
  }

  if (pos === 'QB') {
    const thr = sf ? t.QB_CORNERSTONE_SF : t.QB_CORNERSTONE_1QB
    if (asset.value >= thr) return { ...asset, isCornerstone: true, cornerstoneReason: sf ? 'Elite SF QB cornerstone.' : 'Elite 1QB QB cornerstone.' }
  }
  if (pos === 'TE') {
    const thr = tep ? t.TE_CORNERSTONE_TEP : t.TE_CORNERSTONE_STD
    if (asset.value >= thr) return { ...asset, isCornerstone: true, cornerstoneReason: tep ? 'Elite TE in TEP.' : 'Elite TE cornerstone.' }
  }
  if (pos === 'WR' || pos === 'RB') {
    if (asset.value >= t.SKILL_CORNERSTONE) return { ...asset, isCornerstone: true, cornerstoneReason: 'Elite skill cornerstone.' }
  }
  return { ...asset, isCornerstone: false }
}
