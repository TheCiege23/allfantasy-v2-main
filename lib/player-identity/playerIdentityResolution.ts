/**
 * Shared player identity helpers for draft enrichment, audit, and repair scripts.
 * Keeps sport in composite keys to prevent cross-sport collisions.
 *
 * Player names use the same canonical pipeline as `player-canonical-identity.ts`
 * (suffix-safe, apostrophe-safe) — do not duplicate looser normalization here.
 */

import { canonicalName, canonicalPosition } from '@/lib/draft-room/player-canonical-identity'
import { isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'

/** NFL — preserved legacy aliases (LA/STL → LAR, etc.). */
const NFL_TEAM_CODE_ALIASES: Record<string, string> = {
  JAC: 'JAX',
  JAX: 'JAX',
  WSH: 'WAS',
  WAS: 'WAS',
  ARZ: 'ARI',
  ARI: 'ARI',
  OAK: 'LV',
  LV: 'LV',
  SD: 'LAC',
  LAC: 'LAC',
  STL: 'LAR',
  LA: 'LAR',
  LAR: 'LAR',
}

const NBA_TEAM_CODE_ALIASES: Record<string, string> = {
  GS: 'GSW',
  GWS: 'GSW',
  GSW: 'GSW',
  NY: 'NYK',
  NYK: 'NYK',
  NO: 'NOP',
  NOP: 'NOP',
  NOLA: 'NOP',
  SA: 'SAS',
  SAS: 'SAS',
  PHO: 'PHX',
  PHX: 'PHX',
  UTA: 'UTA',
  UTH: 'UTA',
}

/** MLB — distinct from NFL/NHL city codes where needed (e.g. TB/TBR, LA/LAD). */
const MLB_TEAM_CODE_ALIASES: Record<string, string> = {
  ARZ: 'ARI',
  ARI: 'ARI',
  CWS: 'CHW',
  CHW: 'CHW',
  KC: 'KC',
  KCR: 'KC',
  SD: 'SD',
  SDP: 'SD',
  SF: 'SF',
  SFG: 'SF',
  TB: 'TB',
  TBR: 'TB',
  WSH: 'WSH',
  WAS: 'WSH',
  LA: 'LAD',
  LAD: 'LAD',
  NYM: 'NYM',
  NYMETS: 'NYM',
  NYY: 'NYY',
  NYYANKEES: 'NYY',
}

const NHL_TEAM_CODE_ALIASES: Record<string, string> = {
  LA: 'LAK',
  LAK: 'LAK',
  NJ: 'NJD',
  NJD: 'NJD',
  TB: 'TBL',
  TBL: 'TBL',
  SJ: 'SJS',
  SJS: 'SJS',
  VGK: 'VGK',
  LV: 'VGK',
  WSH: 'WSH',
  WAS: 'WSH',
  ARZ: 'ARI',
  ARI: 'ARI',
  UTA: 'UTA',
  UTH: 'UTA',
}

/**
 * MLS / league soccer — tokens without NFL/NHL/MLB collision inside this branch only.
 * Multi-word inputs normalized to compact uppercase keys where listed.
 */
const SOCCER_TEAM_COMPACT_ALIASES: Record<string, string> = {
  LAFC: 'LAFC',
  LAF: 'LAFC',
  LAG: 'LAG',
  LA: 'LAG',
  NYC: 'NYC',
  NYCFC: 'NYC',
  NYRB: 'NYRB',
  RBNY: 'NYRB',
  SKC: 'SKC',
  KC: 'SKC',
  STL: 'STL',
  STLCITY: 'STL',
  ATL: 'ATL',
  ATLUTD: 'ATL',
  MIA: 'MIA',
  INTERMIAMI: 'MIA',
}

/** Sports that do not use team abbreviations for player identity — ignore team field for keys. */
const NON_TEAM_ABBR_SPORTS = new Set(['PGA', 'NASCAR', 'WWE'])

const CRICKET_SPORTS = new Set(['CRICKET'])

const NCAA_SPORTS = new Set(['NCAAF', 'NCAAB'])

export type SportInput = string | null | undefined

function isFaMarkerCompact(u: string): boolean {
  return (
    u === 'FA' ||
    u === 'F/A' ||
    u === 'NONE' ||
    u === 'N/A' ||
    u === 'FREE_AGENT' ||
    u === 'FREEAGENT' ||
    u.startsWith('FA.') ||
    u.startsWith('FA_')
  )
}

function isFaMarkerRaw(raw: string): boolean {
  return /^FREE[\s_]?AGENT$/i.test(raw.trim())
}

/** Uppercase, trim, collapse internal whitespace — NCAA / Cricket (no school/conference alias tables). */
function conservativeUpperTrimTeam(raw: string): string {
  const t = String(raw).trim()
  if (!t) return ''
  return t.replace(/\s+/g, ' ').toUpperCase()
}

function compactNoSpaces(s: string): string {
  return s.toUpperCase().replace(/\s+/g, '')
}

/**
 * Resolve sport string for normalization: supports LeagueSport plus extended tokens
 * (PGA, NASCAR, WWE, CRICKET) without coercing them to NFL via `normalizeToSupportedSport`.
 */
function resolveSportUpper(sport: SportInput): string {
  const u = String(sport ?? 'NFL').trim().toUpperCase()
  if (NON_TEAM_ABBR_SPORTS.has(u) || CRICKET_SPORTS.has(u)) return u
  if (NCAA_SPORTS.has(u)) return u
  if (u === 'SOCCER' || isSupportedSport(u)) return u
  return normalizeToSupportedSport(sport).toUpperCase()
}

/**
 * Sport suffix for strict/loose keys — preserves PGA/NASCAR/WWE/CRICKET (not in `LeagueSport`)
 * so they never coalesce to NFL. AllFantasy `LeagueSport` values pass through unchanged.
 */
export function sportSegmentForIdentityKeys(sport: string | null | undefined): string {
  const u = String(sport ?? 'NFL').trim().toUpperCase()
  if (NON_TEAM_ABBR_SPORTS.has(u) || CRICKET_SPORTS.has(u)) return u
  return normalizeToSupportedSport(sport).toUpperCase()
}

function normalizeSoccerTeamInternal(raw: string): string {
  const spaced = raw.trim().replace(/\s+/g, ' ').toUpperCase()
  const compact = compactNoSpaces(spaced)
  if (SOCCER_TEAM_COMPACT_ALIASES[compact]) return SOCCER_TEAM_COMPACT_ALIASES[compact]!
  return compact || spaced
}

/**
 * Uppercase team code; FA markers → empty string.
 * Sport-aware alias tables for NFL, NBA, MLB, NHL, SOCCER; conservative paths for NCAA/Cricket;
 * non-team sports (PGA, NASCAR, WWE) ignore team for identity; Cricket uppercase/trim only.
 */
export function normalizeTeamAbbr(team: string | null | undefined, sport?: SportInput): string {
  const raw = String(team ?? '').trim()
  if (!raw) return ''

  const u = raw.toUpperCase().replace(/\s+/g, '')
  if (isFaMarkerCompact(u)) return ''
  if (isFaMarkerRaw(raw)) return ''

  const s = resolveSportUpper(sport)

  if (NON_TEAM_ABBR_SPORTS.has(s)) {
    return ''
  }

  if (CRICKET_SPORTS.has(s)) {
    return conservativeUpperTrimTeam(raw)
  }

  if (NCAA_SPORTS.has(s)) {
    return conservativeUpperTrimTeam(raw)
  }

  if (s === 'NFL') {
    return NFL_TEAM_CODE_ALIASES[u] ?? u
  }

  if (s === 'NBA') {
    return NBA_TEAM_CODE_ALIASES[u] ?? u
  }

  if (s === 'MLB') {
    return MLB_TEAM_CODE_ALIASES[u] ?? u
  }

  if (s === 'NHL') {
    return NHL_TEAM_CODE_ALIASES[u] ?? u
  }

  if (s === 'SOCCER') {
    return normalizeSoccerTeamInternal(raw)
  }

  const leagueSport = normalizeToSupportedSport(sport)
  const fallback = leagueSport.toUpperCase()
  if (fallback === 'NFL') return NFL_TEAM_CODE_ALIASES[u] ?? u
  return u
}

/**
 * Lowercase, trimmed, collapsed whitespace; delegates core identity to `canonicalName`
 * so Ja'Marr / Marvin Harrison Jr. rules stay aligned with the draft pool.
 */
export function normalizePlayerName(name: string | null | undefined): string {
  const base = canonicalName(name ?? '')
  return base.replace(/\s+/g, ' ').trim()
}

const POSITION_COMBO_SPLIT = /[/\\|]/

/** Primary segment for combo eligibility strings; preserves FLEX/SUPERFLEX/SF as-is. */
export function normalizePosition(position: string | null | undefined, _sport?: SportInput): string {
  const p = String(position ?? '').trim()
  if (!p) return ''
  const upper = p.toUpperCase()
  const flexLike = /^(FLEX|SUPER_FLEX|SUPERFLEX|SF|OP)$/i
  if (flexLike.test(upper)) return canonicalPosition(upper)
  if (POSITION_COMBO_SPLIT.test(upper)) {
    const first = upper.split(POSITION_COMBO_SPLIT)[0]?.trim()
    return canonicalPosition(first ?? upper)
  }
  return canonicalPosition(upper)
}

/**
 * True when the team string should be treated as FA / no roster (aligned with
 * `normalizeTeamAbbr` FA markers: FA.*, FREE_AGENT, FREE AGENT, etc.).
 */
export function isFreeAgentTeam(team: string | null | undefined, sport?: SportInput): boolean {
  if (team == null || !String(team).trim()) return true
  return normalizeTeamAbbr(team, sport) === ''
}

export type StrictPlayerKeyParams = {
  name: string | null | undefined
  position: string | null | undefined
  team: string | null | undefined
  sport: string | null | undefined
}

export type LoosePlayerKeyParams = {
  name: string | null | undefined
  position: string | null | undefined
  sport: string | null | undefined
}

/** canonicalName | position | normalizedTeam | SPORT — never merge across sports. */
export function buildStrictPlayerKey(params: StrictPlayerKeyParams): string {
  const sportU = sportSegmentForIdentityKeys(params.sport)
  const nm = normalizePlayerName(params.name)
  const pos = normalizePosition(params.position, sportU)
  const tm = normalizeTeamAbbr(params.team, sportU)
  return `${nm}|${pos}|${tm}|${sportU}`
}

/** canonicalName | position | SPORT */
export function buildLoosePlayerKey(params: LoosePlayerKeyParams): string {
  const sportU = sportSegmentForIdentityKeys(params.sport)
  const nm = normalizePlayerName(params.name)
  const pos = normalizePosition(params.position, sportU)
  return `${nm}|${pos}|${sportU}`
}

export type IdentityMatchType = 'id' | 'strict' | 'loose' | 'none'

export function resolvePlayerIdentityConfidence(matchType: IdentityMatchType): number {
  switch (matchType) {
    case 'id':
      return 1
    case 'strict':
      return 0.9
    case 'loose':
      return 0.5
    default:
      return 0
  }
}

export type IdentityMatchMetadata = {
  matchType: IdentityMatchType
  confidence: number
  reason: string
}

export function buildIdentityMetadata(
  matchType: IdentityMatchType,
  reason: string,
): IdentityMatchMetadata {
  return {
    matchType,
    confidence: resolvePlayerIdentityConfidence(matchType),
    reason,
  }
}
