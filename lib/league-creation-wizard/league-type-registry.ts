/**
 * League types, draft types, and valid combinations for the creation wizard.
 * Delegates draft-type allowlists to `lib/draft-types/draftTypeRegistry` + format-engine
 * so create flow, imports, defaults, and validation resolve from one shared contract.
 */

import type { LeagueSport } from '@prisma/client'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import {
  DRAFT_TYPE_LABELS as REGISTRY_DRAFT_LABELS,
  listAllFormatDraftTypeIds,
  listCreateLeagueWireDraftTypeIds,
} from '@/lib/draft-types/draftTypeRegistry'
import {
  getAllowedDraftTypesForFormat,
  getFormatsForSport,
  isDraftTypeAllowedForFormat,
  isLeagueFormatAllowedForSport,
  listLeagueFormats,
} from '@/lib/league/format-engine'
import type { LeagueTypeId, DraftTypeId } from './types'
import { isSurvivorCreationSportAvailable, SURVIVOR_CREATION_SPORTS } from '@/lib/survivor/survivorCreationAvailability'

export const LEAGUE_TYPE_IDS: LeagueTypeId[] = listLeagueFormats().map((format) => format.id) as LeagueTypeId[]

export const LEAGUE_TYPE_LABELS: Record<LeagueTypeId, string> = listLeagueFormats().reduce(
  (acc, format) => {
    acc[format.id as LeagueTypeId] = format.label
    return acc
  },
  {} as Record<LeagueTypeId, string>
)

/** All canonical format draft ids (union across formats) — labels for wizard controls. */
export const DRAFT_TYPE_LABELS: Record<DraftTypeId, string> = listAllFormatDraftTypeIds().reduce(
  (acc, id) => {
    acc[id] = REGISTRY_DRAFT_LABELS[id] ?? String(id).replace(/_/g, ' ')
    return acc
  },
  {} as Record<DraftTypeId, string>
)

/**
 * Legacy POST /api/league/create allowlist: canonical format draft ids + execution modes
 * (`offline` | `auto` | `team`).
 */
export const DRAFT_TYPE_IDS: readonly string[] = listCreateLeagueWireDraftTypeIds()

/** League types that imply dynasty (multi-year roster). */
const DYNASTY_LEAGUE_TYPES: LeagueTypeId[] = ['dynasty', 'devy', 'c2c']

/** League types that support keeper config. */
const KEEPER_LEAGUE_TYPES: LeagueTypeId[] = ['keeper', 'dynasty']

/** League types that support devy. */
const DEVY_LEAGUE_TYPES: LeagueTypeId[] = ['devy', 'dynasty']

/** League types that support C2C. */
const C2C_LEAGUE_TYPES: LeagueTypeId[] = ['c2c']

/** Draft types that are "live" league draft (not mock). Excludes mock_draft by design for this helper. */
const LIVE_DRAFT_TYPES: DraftTypeId[] = [
  'snake',
  'linear',
  'auction',
  'slow_draft',
  'devy_snake',
  'devy_auction',
  'c2c_snake',
  'c2c_auction',
]

export function isDynastyLeagueType(leagueType: LeagueTypeId): boolean {
  return DYNASTY_LEAGUE_TYPES.includes(leagueType)
}

/** Standard redraft: seasonal league, no carryover rosters. */
export function isRedraftLeagueType(leagueType: LeagueTypeId): boolean {
  return leagueType === 'redraft'
}

/** Keeper or dynasty: supports keeper retention config (max keepers, round cost, etc.). */
export function isKeeperLeagueType(leagueType: LeagueTypeId): boolean {
  return KEEPER_LEAGUE_TYPES.includes(leagueType)
}

/** True when league type is exactly keeper (hybrid seasonal + retention), not dynasty. */
export function isKeeperOnlyLeagueType(leagueType: LeagueTypeId): boolean {
  return leagueType === 'keeper'
}

export function isDevyLeagueType(leagueType: LeagueTypeId): boolean {
  return DEVY_LEAGUE_TYPES.includes(leagueType)
}

export function isC2CLeagueType(leagueType: LeagueTypeId): boolean {
  return C2C_LEAGUE_TYPES.includes(leagueType)
}

export function isLiveDraftType(draftType: DraftTypeId): boolean {
  return LIVE_DRAFT_TYPES.includes(draftType)
}

export function getAllowedLeagueTypesForSport(sport: LeagueSport | string): LeagueTypeId[] {
  return getFormatsForSport(sport)
    .filter((format) => format.id !== 'survivor' || isSurvivorCreationSportAvailable(sport))
    .map((format) => format.id) as LeagueTypeId[]
}

/** Reverse lookup: which sports does a given league type support? */
export function getAllowedSportsForLeagueType(leagueType: LeagueTypeId): LeagueSport[] {
  if (leagueType === 'survivor') return [...SURVIVOR_CREATION_SPORTS] as LeagueSport[]
  const format = listLeagueFormats().find((f) => f.id === leagueType)
  return format ? (format.supportedSports as LeagueSport[]) : [...SUPPORTED_SPORTS]
}

/**
 * Draft types allowed for a league type and sport.
 * Single source: format-engine resolution matrix (backed by `draftTypeRegistry`).
 */
export function getAllowedDraftTypesForLeagueType(
  leagueType: LeagueTypeId,
  sport: LeagueSport | string = 'NFL'
): DraftTypeId[] {
  return getAllowedDraftTypesForFormat(sport, leagueType) as DraftTypeId[]
}

/**
 * Validate league type for sport.
 */
export function isLeagueTypeAllowedForSport(leagueType: LeagueTypeId, sport: LeagueSport | string): boolean {
  return (leagueType !== 'survivor' || isSurvivorCreationSportAvailable(sport)) &&
    isLeagueFormatAllowedForSport(sport, leagueType)
}

/**
 * Validate draft type for league type.
 */
export function isDraftTypeAllowedForLeagueType(
  draftType: DraftTypeId,
  leagueType: LeagueTypeId,
  sport: LeagueSport | string = 'NFL'
): boolean {
  return isDraftTypeAllowedForFormat(sport, leagueType, draftType)
}

/**
 * All supported sports (from sport-scope).
 */
export function getSupportedSports(): LeagueSport[] {
  return [...SUPPORTED_SPORTS]
}
