/**
 * Bootstraps a league's roster config from sport defaults (template + overrides).
 * Ensures league creation loads the correct roster setup by sport; idempotent.
 */
import type { LeagueSport } from '@prisma/client'
import { getRosterTemplateForLeague, resolveLeagueRosterConfig } from '@/lib/multi-sport/MultiSportRosterService'
import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'

export interface BootstrapResult {
  leagueId: string
  templateId: string
  template: RosterTemplateDto
  created: boolean
}

/**
 * Bootstrap roster config for a league: ensure LeagueRosterConfig exists and return resolved template.
 * Call after league create so draft room, waiver, and lineup use the correct slots.
 */
export async function bootstrapLeagueRoster(
  leagueId: string,
  leagueSport: LeagueSport,
  formatType?: string
): Promise<BootstrapResult> {
  const normalizedFormat =
    leagueSport === 'NFL' && String(formatType ?? '').toUpperCase() === 'DYNASTY_IDP'
      ? 'IDP'
      : (formatType ?? 'standard')
  const { templateId } = await resolveLeagueRosterConfig(
    leagueId,
    leagueSport,
    normalizedFormat
  )
  const template = await getRosterTemplateForLeague(leagueSport, normalizedFormat)
  return {
    leagueId,
    templateId,
    template,
    created: !templateId.startsWith('default-'),
  }
}

/**
 * Get the resolved roster template for a league (for draft room, waiver, lineup UI).
 * Does not create config; use when league already has roster config or you only need template.
 */
export async function getLeagueRosterTemplate(
  leagueSport: LeagueSport,
  formatType?: string
): Promise<RosterTemplateDto> {
  const normalizedFormat =
    leagueSport === 'NFL' && String(formatType ?? '').toUpperCase() === 'DYNASTY_IDP'
      ? 'IDP'
      : formatType
  return getRosterTemplateForLeague(leagueSport, normalizedFormat)
}
