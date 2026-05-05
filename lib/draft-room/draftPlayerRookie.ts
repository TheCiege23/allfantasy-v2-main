/**
 * Draft room rookie detection — explicit metadata + safe inference for NFL/NCAAF.
 * Does not invent players; only classifies rows already in the pool.
 */

import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

export type DraftRoomRookiePlayerLike = {
  isRookie?: boolean
  rookie?: boolean
  yearsExp?: number | null
  experience?: number | null
  draftYear?: number | null
  nflDraftYear?: number | null
  isDevy?: boolean
  classYearLabel?: string | null
  display?: { metadata?: Record<string, unknown> } | null
  /** Loose provider keys (pool JSON) */
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type DraftRoomRookieOptions = {
  sport: string
  /** Primary season year for draft-class matching (e.g. 2026 NFL season / rookie class). */
  seasonYear?: number
  leagueSeasonYear?: number
  draftYear?: number
  devyEnabled?: boolean
  c2cEnabled?: boolean
}

export type DraftRoomRookieDataReason =
  | 'rookies_found'
  | 'no_rookie_metadata'
  | 'no_rookies_for_context'
  | 'empty_pool'

export type DraftRoomRookieDataState = {
  hasExplicitRookieData: boolean
  hasInferableRookies: boolean
  rookieCount: number
  reason: DraftRoomRookieDataReason
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function readLoose(player: DraftRoomRookiePlayerLike, key: string): unknown {
  const top = player[key]
  if (top !== undefined && top !== null) return top
  const m = player.metadata
  if (m && typeof m === 'object' && key in m) return (m as Record<string, unknown>)[key]
  const dm = player.display?.metadata
  if (dm && typeof dm === 'object' && key in dm) return (dm as Record<string, unknown>)[key]
  return undefined
}

function effectiveSeasonYear(options: DraftRoomRookieOptions): number {
  const y =
    options.seasonYear ??
    options.leagueSeasonYear ??
    options.draftYear ??
    new Date().getUTCFullYear()
  return Number.isFinite(y) ? y : new Date().getUTCFullYear()
}

/**
 * True when the pool row carries fields that can feed rookie logic (not necessarily a rookie).
 */
export function poolRowHasRookieSignals(player: DraftRoomRookiePlayerLike): boolean {
  if (player.yearsExp != null && Number.isFinite(Number(player.yearsExp))) return true
  if (player.isRookie != null) return true
  if (player.rookie != null) return true
  if (player.draftYear != null && Number.isFinite(Number(player.draftYear))) return true
  if (player.nflDraftYear != null && Number.isFinite(Number(player.nflDraftYear))) return true
  if (readLoose(player, 'isRookie') != null) return true
  if (readLoose(player, 'rookie') != null) return true
  if (readLoose(player, 'yearsExperience') != null) return true
  if (readLoose(player, 'years_exp') != null) return true
  if (readLoose(player, 'experience') != null) return true
  if (readLoose(player, 'draftYear') != null) return true
  if (readLoose(player, 'nflDraftYear') != null) return true
  if (player.classYearLabel != null && String(player.classYearLabel).trim() !== '') return true
  if (player.isDevy === true) return true
  return false
}

/**
 * True when any classification field suggests "we know rookie status" from source (not inference).
 */
export function hasExplicitRookieClassification(player: DraftRoomRookiePlayerLike): boolean {
  if (player.isRookie === true || player.rookie === true) return true
  if (readLoose(player, 'isRookie') === true || readLoose(player, 'rookie') === true) return true
  if (player.yearsExp != null && Number.isFinite(Number(player.yearsExp))) return true
  if (readLoose(player, 'yearsExperience') != null || readLoose(player, 'years_exp') != null) return true
  if (readLoose(player, 'experience') != null) return true
  return false
}

/**
 * Whether draft-year matching can infer rookie without yearsExp (NFL/NCAAF only).
 */
function draftYearMatchesSeason(player: DraftRoomRookiePlayerLike, season: number): boolean {
  const looseMeta = readLoose(player, 'metadata')
  let metaDraft: number | null = null
  if (looseMeta && typeof looseMeta === 'object') {
    const o = looseMeta as Record<string, unknown>
    metaDraft = num(o.draftYear) ?? num(o.nflDraftYear)
  }
  const dm = player.display?.metadata as Record<string, unknown> | undefined
  const displayDraft =
    dm && typeof dm === 'object' ? num(dm.draftYear) ?? num(dm.nflDraftYear) : null

  const candidates = [
    num(player.draftYear),
    num(player.nflDraftYear),
    num(readLoose(player, 'draftYear')),
    num(readLoose(player, 'nflDraftYear')),
    metaDraft,
    displayDraft,
  ].filter((n): n is number => n != null)
  return candidates.some((n) => n === season)
}

export function isDraftRoomRookie(
  player: DraftRoomRookiePlayerLike,
  options: DraftRoomRookieOptions,
): boolean {
  const sport = normalizeToSupportedSport(options.sport) as SupportedSport
  const season = effectiveSeasonYear(options)

  if (player.isRookie === true || player.rookie === true) return true
  if (readLoose(player, 'isRookie') === true || readLoose(player, 'rookie') === true) return true

  const ye =
    num(player.yearsExp) ??
    num(readLoose(player, 'yearsExperience')) ??
    num(readLoose(player, 'years_exp'))
  const exp = num(player.experience) ?? num(readLoose(player, 'experience'))
  if (ye === 0 || exp === 0) return true

  if (sport === 'NFL' || sport === 'NCAAF') {
    if (draftYearMatchesSeason(player, season)) return true
  }

  if (options.devyEnabled || options.c2cEnabled) {
    if (player.isDevy === true) return true
    const yr = String(player.classYearLabel ?? '').toLowerCase()
    if (
      yr.includes('rookie') ||
      yr.includes('fr') ||
      yr.includes('so') ||
      yr.includes('jr') ||
      yr.includes('sr')
    ) {
      return true
    }
  }

  return false
}

export function getDraftRoomRookieDataState(
  players: DraftRoomRookiePlayerLike[],
  options: DraftRoomRookieOptions,
): DraftRoomRookieDataState {
  if (!players.length) {
    return {
      hasExplicitRookieData: false,
      hasInferableRookies: false,
      rookieCount: 0,
      reason: 'empty_pool',
    }
  }

  let rookieCount = 0
  let explicit = false
  let inferable = false

  for (const p of players) {
    if (hasExplicitRookieClassification(p)) explicit = true
    const isR = isDraftRoomRookie(p, options)
    if (isR) {
      rookieCount += 1
      if (!hasExplicitRookieClassification(p)) inferable = true
    }
  }

  const poolSignals = players.some((p) => poolRowHasRookieSignals(p))

  if (rookieCount > 0) {
    return {
      hasExplicitRookieData: explicit,
      hasInferableRookies: inferable,
      rookieCount,
      reason: 'rookies_found',
    }
  }

  if (!poolSignals) {
    return {
      hasExplicitRookieData: false,
      hasInferableRookies: false,
      rookieCount: 0,
      reason: 'no_rookie_metadata',
    }
  }

  return {
    hasExplicitRookieData: explicit,
    hasInferableRookies: false,
    rookieCount: 0,
    reason: 'no_rookies_for_context',
  }
}
