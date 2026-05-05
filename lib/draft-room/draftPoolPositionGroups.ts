/**
 * Position pill counts + filter matching — normalize alias positions (K/PK, DEF/DST).
 */

import { isLikelyIdpFootballPosition } from '@/lib/draft-room/draftSportStatColumns'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type DraftPoolPositionCounts = {
  ALL: number
  QB: number
  RB: number
  WR: number
  TE: number
  K: number
  DST: number
  FLEX: number
  IDP: number
  OFFENSE: number
}

function normPos(position: string | null | undefined): string {
  return String(position ?? '')
    .trim()
    .toUpperCase()
}

/** Map feed quirks to canonical buckets for counting. */
export function normalizeAliasPosition(position: string | null | undefined): string {
  const p = normPos(position)
  if (p === 'PK') return 'K'
  if (p === 'DEF' || p === 'D/ST' || p === 'DST') return 'DST'
  return p
}

export function isFlexEligible(pos: string | null | undefined): boolean {
  const p = normPos(pos)
  return p === 'RB' || p === 'WR' || p === 'TE'
}

export function isDstAlias(pos: string | null | undefined): boolean {
  const p = normPos(pos)
  return p === 'DEF' || p === 'DST' || p === 'D/ST'
}

export function isKickerAlias(pos: string | null | undefined): boolean {
  const p = normPos(pos)
  return p === 'K' || p === 'PK'
}

export function poolPlayerMatchesPositionPill(
  rawPosition: string | null | undefined,
  pillValue: string,
  opts?: { sport?: string; formatType?: string },
): boolean {
  const v = String(pillValue ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
  const pos = normPos(rawPosition)
  const canon = normalizeAliasPosition(rawPosition)
  const sport = opts?.sport ? normalizeToSupportedSport(opts.sport) : 'NFL'
  const fmt = String(opts?.formatType ?? '').toUpperCase()
  const idpMode = sport === 'NFL' && (fmt === 'IDP' || fmt === 'DYNASTY_IDP')

  if (v === 'ALL') return true

  if (v === 'FLEX') return isFlexEligible(pos)

  if (v === 'IDP_FLEX') {
    return (
      isLikelyIdpFootballPosition(pos) &&
      !isDstAlias(pos) &&
      pos !== 'QB' &&
      pos !== 'RB' &&
      pos !== 'WR' &&
      pos !== 'TE' &&
      pos !== 'K' &&
      pos !== 'PK'
    )
  }

  if (v === 'OFFENSE') {
    return (
      pos === 'QB' ||
      pos === 'RB' ||
      pos === 'WR' ||
      pos === 'TE' ||
      isKickerAlias(pos) ||
      isDstAlias(pos)
    )
  }

  if (v === 'DEF' || v === 'DST' || v === 'D/ST') {
    return isDstAlias(pos)
  }

  if (v === 'K') {
    return isKickerAlias(pos)
  }

  if (v === 'IDP' && idpMode) {
    return isLikelyIdpFootballPosition(pos) && !isFlexEligible(pos) && !isDstAlias(pos) && pos !== 'QB'
  }

  return canon === v || pos === v
}

export type PositionCountPlayerLike = { position?: string | null }

export function getDraftRoomPositionGroupCounts(
  players: PositionCountPlayerLike[],
  opts?: { sport?: string; formatType?: string },
): DraftPoolPositionCounts {
  const out: DraftPoolPositionCounts = {
    ALL: players.length,
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DST: 0,
    FLEX: 0,
    IDP: 0,
    OFFENSE: 0,
  }

  for (const p of players) {
    const raw = p.position
    const pos = normPos(raw)
    if (pos === 'QB') out.QB += 1
    if (pos === 'RB') out.RB += 1
    if (pos === 'WR') out.WR += 1
    if (pos === 'TE') out.TE += 1
    if (isKickerAlias(raw)) out.K += 1
    if (isDstAlias(raw)) out.DST += 1
    if (isFlexEligible(raw)) out.FLEX += 1
    if (isLikelyIdpFootballPosition(raw) && !isDstAlias(raw) && pos !== 'QB' && !isFlexEligible(raw)) {
      out.IDP += 1
    }
    if (
      pos === 'QB' ||
      pos === 'RB' ||
      pos === 'WR' ||
      pos === 'TE' ||
      isKickerAlias(raw) ||
      isDstAlias(raw)
    ) {
      out.OFFENSE += 1
    }
  }

  void opts
  return out
}
