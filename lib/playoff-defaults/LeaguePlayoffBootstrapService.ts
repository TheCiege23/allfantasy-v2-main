/**
 * Ensures a league has playoff config in League.settings (sport- and variant-aware).
 * Idempotent: creates/merges only missing playoff keys while preserving commissioner overrides.
 */
import { resolveConfiguredPlayoffSeedingRule } from './seedingRule'
import { prisma } from '@/lib/prisma'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import { getDefaultLeagueSettingsForVariant } from '@/lib/sport-defaults/LeagueDefaultSettingsService'

export interface LeaguePlayoffBootstrapResult {
  leagueId: string
  playoffConfigApplied: boolean
  sport: string
  variant: string | null
}

/**
 * Ensure league has playoff config in League.settings. Missing keys are backfilled from defaults.
 */
export async function bootstrapLeaguePlayoffConfig(leagueId: string): Promise<LeaguePlayoffBootstrapResult> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, leagueVariant: true, settings: true, playoffSeedingRule: true },
  })
  if (!league) {
    return { leagueId, playoffConfigApplied: false, sport: '', variant: null }
  }

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const sport = (league.sport as string) || DEFAULT_SPORT
  const variant = league.leagueVariant ?? null

  const def = getDefaultLeagueSettingsForVariant(sport, variant)
  const currentStructure = settings.playoff_structure != null && typeof settings.playoff_structure === 'object'
    ? (settings.playoff_structure as Record<string, unknown>)
    : {}
  const defaultStructure = (def.playoff_structure ?? {}) as Record<string, unknown>

  const nextStructure: Record<string, unknown> = { ...currentStructure }
  let applied = false

  for (const [key, value] of Object.entries(defaultStructure)) {
    if (nextStructure[key] === undefined || nextStructure[key] === null) {
      nextStructure[key] = key === 'seeding_rules' ? resolveConfiguredPlayoffSeedingRule(league, String(value)) : value
      applied = true
    }
  }

  const nextSettings: Record<string, unknown> = { ...settings }
  if (nextSettings.playoff_team_count === undefined || nextSettings.playoff_team_count === null) {
    nextSettings.playoff_team_count = def.playoff_team_count
    applied = true
  }
  if (nextSettings.standings_tiebreakers === undefined || nextSettings.standings_tiebreakers === null) {
    nextSettings.standings_tiebreakers = def.standings_tiebreakers
    applied = true
  }

  if (currentStructure !== nextStructure || Object.keys(nextStructure).length > 0) {
    nextSettings.playoff_structure = nextStructure
  }

  if (!applied) {
    return { leagueId, playoffConfigApplied: false, sport, variant }
  }

  await (prisma as any).league.update({
    where: { id: leagueId },
    data: { settings: nextSettings },
  })

  return { leagueId, playoffConfigApplied: true, sport, variant }
}
