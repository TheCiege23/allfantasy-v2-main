/**
 * Resolves league creation preset by sport and optional league variant.
 * For NFL + IDP/DYNASTY_IDP returns roster with IDP slots and IDP scoring; otherwise uses sport defaults.
 */
import type { LeagueSport } from '@prisma/client'
import { getRosterOverlayForVariant, getFormatTypeForVariant } from './LeagueVariantRegistry'
import { getRosterDefaults } from './SportDefaultsRegistry'
import type { SportType, RosterDefaults } from './types'
import { leagueSportToSportType } from '@/lib/multi-sport/SportConfigResolver'
import { getRosterTemplate, type RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'
import { getScoringTemplate, type ScoringTemplateDto } from '@/lib/multi-sport/ScoringTemplateResolver'
import { supportsIdpLeagueSport } from '@/lib/sport-scope'

export interface ResolvedLeaguePreset {
  sport: LeagueSport
  leagueVariant: string | null
  formatType: string
  rosterDefaults: RosterDefaults
  rosterTemplate: RosterTemplateDto
  scoringTemplate: ScoringTemplateDto
  isIdp: boolean
}

/**
 * Resolve full preset for league creation using sport and optional variant.
 * When variant is IDP/DYNASTY_IDP, merges IDP roster overlay and uses IDP scoring format.
 */
export async function resolveLeaguePreset(
  leagueSport: LeagueSport,
  leagueVariant: string | null | undefined
): Promise<ResolvedLeaguePreset> {
  const sportType = leagueSportToSportType(leagueSport) as SportType
  const variant = leagueVariant ?? null
  const upperVariant = String(variant ?? '').toUpperCase()
  const formatType = getFormatTypeForVariant(sportType, variant)
  const overlay = getRosterOverlayForVariant(sportType, variant)
  const isIdp =
    supportsIdpLeagueSport(sportType) &&
    (upperVariant === 'IDP' || upperVariant === 'DYNASTY_IDP')

  let rosterDefaults: RosterDefaults = getRosterDefaults(sportType, formatType)
  if (formatType !== 'devy_dynasty' && overlay && Object.keys(overlay).length > 0) {
    rosterDefaults = {
      ...rosterDefaults,
      starter_slots: { ...rosterDefaults.starter_slots, ...overlay },
    }
  }

  const [rosterTemplate, scoringTemplate] = await Promise.all([
    getRosterTemplate(sportType, formatType),
    getScoringTemplate(sportType, formatType),
  ])

  return {
    sport: leagueSport,
    leagueVariant: variant,
    formatType,
    rosterDefaults,
    rosterTemplate,
    scoringTemplate,
    isIdp,
  }
}

/**
 * Get scoring format type for a league (sport + variant). Used by roster/scoring resolution.
 */
export function getScoringFormatForLeague(
  leagueSport: LeagueSport,
  leagueVariant: string | null | undefined
): string {
  const sportType = leagueSportToSportType(leagueSport)
  return getFormatTypeForVariant(sportType, leagueVariant)
}
