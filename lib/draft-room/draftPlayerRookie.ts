/**
 * Draft room rookie detection — explicit metadata + safe inference for NFL/NCAAF.
 * Does not invent players; only classifies rows already in the pool.
 */

import { isFreshmanClass } from '@/lib/draft-room/collegeClass'
import { resolveNflRookieSource } from '@/lib/providers/nflRookieSourcePolicy'
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
  if (readLoose(player, 'class') != null || readLoose(player, 'collegeClass') != null) return true
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
/** Operator-facing diagnostic label for where NFL rookie *signals* came from (not ISO timestamps). */
export type NflRookieDiagnosticSource =
  | 'rolling_insights_imported'
  | 'sleeper_years_exp'
  | 'sleeper_cache'
  | 'unknown'

function readCollegeClassLabel(player: DraftRoomRookiePlayerLike): string | null {
  const v =
    readLoose(player, 'class') ??
    readLoose(player, 'collegeClass') ??
    player.classYearLabel ??
    null
  if (v == null || v === '') return null
  return String(v).trim()
}

/** NCAA football — Rolling Insights `class`; freshmen ~= pool “rookies” filter; never Sleeper years_exp. */
function isDraftRoomRookieNcaaFb(
  player: DraftRoomRookiePlayerLike,
  options: DraftRoomRookieOptions,
): boolean {
  const cc = readCollegeClassLabel(player)
  if (cc && isFreshmanClass(cc)) return true

  if (options.devyEnabled || options.c2cEnabled) {
    if (player.isDevy === true) return true
  }

  return false
}

function isDraftRoomRookieNfl(
  player: DraftRoomRookiePlayerLike,
  season: number,
  options: DraftRoomRookieOptions,
): boolean {
  const res = resolveNflRookieSource({ ...player, seasonYear: season })
  if (res.isRookie === true) return true
  if (res.isRookie === false) return false

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

export function resolveNflRookieDiagnosticSource(
  player: DraftRoomRookiePlayerLike,
): NflRookieDiagnosticSource {
  const dm = player.display?.metadata as Record<string, unknown> | undefined
  const prov = dm?.rookieYearsExpSource
  if (prov === 'explicit_imported') return 'rolling_insights_imported'
  if (prov === 'sleeper_live') return 'sleeper_years_exp'
  if (prov === 'sleeper_db_cache') return 'sleeper_cache'
  if (
    player.isRookie === true ||
    player.rookie === true ||
    readLoose(player, 'isRookie') === true ||
    readLoose(player, 'rookie') === true ||
    player.draftYear != null ||
    player.nflDraftYear != null ||
    readLoose(player, 'draftYear') != null ||
    readLoose(player, 'nflDraftYear') != null
  ) {
    return 'rolling_insights_imported'
  }
  if (
    num(player.yearsExp) != null ||
    num(readLoose(player, 'yearsExperience')) != null ||
    num(readLoose(player, 'years_exp')) != null
  ) {
    return 'sleeper_years_exp'
  }
  return 'unknown'
}

export function isDraftRoomRookie(
  player: DraftRoomRookiePlayerLike,
  options: DraftRoomRookieOptions,
): boolean {
  const sport = normalizeToSupportedSport(options.sport) as SupportedSport
  const season = effectiveSeasonYear(options)

  if (player.isRookie === true || player.rookie === true) return true
  if (readLoose(player, 'isRookie') === true || readLoose(player, 'rookie') === true) return true

  if (sport === 'NFL') {
    return isDraftRoomRookieNfl(player, season, options)
  }

  if (sport === 'NCAAF') {
    return isDraftRoomRookieNcaaFb(player, options)
  }

  const ye =
    num(player.yearsExp) ??
    num(readLoose(player, 'yearsExperience')) ??
    num(readLoose(player, 'years_exp'))
  const exp = num(player.experience) ?? num(readLoose(player, 'experience'))
  if (ye === 0 || exp === 0) return true

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
