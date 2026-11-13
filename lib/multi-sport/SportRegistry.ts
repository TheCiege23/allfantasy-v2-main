/**
 * Central registry of supported sports: positions, default format, and display config.
 * Used by SportConfigResolver and template loaders.
 */
import type { SportType } from './sport-types'
import { SPORT_DISPLAY_NAMES, SPORT_EMOJI } from './sport-types'
import { getPositionsForSport as getPositionsFromRosterDefaults } from '@/lib/roster-defaults/PositionEligibilityResolver'
import { supportsIdpLeagueSport } from '@/lib/sport-scope'

const NFL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const
const NBA_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const
const MLB_POSITIONS = ['SP', 'RP', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'UTIL'] as const
const NHL_POSITIONS = ['C', 'LW', 'RW', 'D', 'G', 'UTIL'] as const
const NCAAF_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'SUPERFLEX'] as const
const NCAAB_POSITIONS = ['G', 'F', 'C', 'UTIL'] as const
/** GKP = Goalkeeper (GK is common display alias). */
const SOCCER_POSITIONS = ['GKP', 'DEF', 'MID', 'FWD', 'UTIL'] as const

type SportPositionsMap = Record<SportType, readonly string[]>

const SPORT_POSITIONS: SportPositionsMap = {
  NFL: NFL_POSITIONS,
  NBA: NBA_POSITIONS,
  MLB: MLB_POSITIONS,
  NHL: NHL_POSITIONS,
  NCAAF: NCAAF_POSITIONS,
  NCAAB: NCAAB_POSITIONS,
  SOCCER: SOCCER_POSITIONS,
}

/** App-wide default scoring/roster format per sport. League creation loads these as standard defaults. */
const DEFAULT_FORMAT_BY_SPORT: Record<SportType, string> = {
  NFL: 'standard',
  NBA: 'points',
  MLB: 'standard',
  NHL: 'standard',
  NCAAF: 'PPR',
  NCAAB: 'points',
  SOCCER: 'standard',
}

export interface SportConfig {
  sportType: SportType
  displayName: string
  emoji: string
  positions: readonly string[]
  defaultFormat: string
}

export function getSportConfig(sportType: SportType): SportConfig {
  return {
    sportType,
    displayName: SPORT_DISPLAY_NAMES[sportType],
    emoji: SPORT_EMOJI[sportType],
    positions: SPORT_POSITIONS[sportType] ?? [],
    defaultFormat: DEFAULT_FORMAT_BY_SPORT[sportType] ?? 'standard',
  }
}

/**
 * Get positions for a sport. For IDP football formats, returns offensive + IDP positions.
 */
export function getPositionsForSport(sportType: SportType, formatType?: string): string[] {
  const positions = getPositionsFromRosterDefaults(sportType, formatType)
  if (positions.length > 0) return positions

  const fallback = SPORT_POSITIONS[sportType] ?? []
  const normalizedFormat = (formatType ?? '').toUpperCase()
  if (supportsIdpLeagueSport(sportType) && (normalizedFormat === 'IDP' || normalizedFormat === 'DYNASTY_IDP')) {
    const baseFootballPositions = fallback.filter((pos) => pos !== 'SUPERFLEX')
    return [...new Set([...baseFootballPositions, 'DE', 'DT', 'LB', 'CB', 'S'])]
  }
  return [...fallback]
}
