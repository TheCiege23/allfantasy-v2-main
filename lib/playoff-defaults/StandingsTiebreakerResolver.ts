/**
 * Resolves standings tiebreaker order for a league. Used by standings display and playoff seeding.
 */
import { prisma } from '@/lib/prisma'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import { getDefaultLeagueSettingsForVariant } from '@/lib/sport-defaults/LeagueDefaultSettingsService'

interface StandingsTiebreakerConfig {
  tiebreakers: string[]
  sport: string
  variant: string | null
}

/**
 * Get standings tiebreaker order for a league. Uses League.settings.standings_tiebreakers when present; else sport defaults.
 */
export async function getStandingsTiebreakersForLeague(leagueId: string): Promise<StandingsTiebreakerConfig | null> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { sport: true, leagueVariant: true, settings: true },
  })
  if (!league) return null

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const sport = (league.sport as string) || DEFAULT_SPORT
  const variant = league.leagueVariant ?? null

  const stored = settings.standings_tiebreakers
  const structure = settings.playoff_structure != null && typeof settings.playoff_structure === 'object'
    ? (settings.playoff_structure as Record<string, unknown>)
    : {}
  const structureRules = Array.isArray(structure.tiebreaker_rules)
    ? (structure.tiebreaker_rules as string[])
    : null
  const tiebreakers = Array.isArray(stored) && stored.length > 0
    ? (stored as string[])
    : (structureRules && structureRules.length > 0)
      ? structureRules
      : getDefaultLeagueSettingsForVariant(sport, variant).standings_tiebreakers

  return {
    tiebreakers,
    sport,
    variant,
  }
}
