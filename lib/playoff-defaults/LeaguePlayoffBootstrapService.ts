/**
 * Ensures a league has playoff config in League.settings (sport- and variant-aware).
 * Idempotent: creates/merges only missing playoff keys while preserving commissioner overrides.
 */
import { resolveConfiguredPlayoffSeedingRule } from './seedingRule'
import { prisma } from '@/lib/prisma'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import { getDefaultLeagueSettingsForVariant } from '@/lib/sport-defaults/LeagueDefaultSettingsService'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { firstRoundByesForTeams, playoffRoundsForTeams } from '@/lib/playoff-runtime/playoffFit'
import { CONSOLATION_PLAYS_FOR_DRAFT_ORDER_KEY, CONSOLATION_PLAYS_FOR_SETTINGS_KEY } from '@/lib/playoff-runtime/consolationPlaysFor'

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
    select: { id: true, sport: true, leagueVariant: true, settings: true, playoffSeedingRule: true, playoffTeams: true, playoffStartWeek: true, platform: true },
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
  /*
   * ⚠ A GAP IS FILLED FROM THE LEAGUE'S OWN COLUMNS FIRST. The registry says 6 teams / 2 byes / 3
   * rounds for every league; a 4-team league's `League.playoffTeams` is 4, and backfilling the
   * registry's 6 beside it is how the standings came to show six teams and two byes for a bracket
   * of four. Byes and rounds follow from the column's field size; anything else from the registry.
   * Native leagues only: an importer never sets the columns, so on an import they are schema defaults.
   */
  const native = isNativePlatform(league.platform)
  const columnTeams = native && Number.isInteger(league.playoffTeams) && league.playoffTeams >= 2 ? Number(league.playoffTeams) : null
  const columnStart = native && Number.isInteger(league.playoffStartWeek) && league.playoffStartWeek >= 1 ? Number(league.playoffStartWeek) : null
  const defaultStructure: Record<string, unknown> = {
    ...((def.playoff_structure ?? {}) as Record<string, unknown>),
    ...(columnTeams != null
      ? {
          playoff_team_count: columnTeams,
          first_round_byes: firstRoundByesForTeams(columnTeams),
          total_rounds: playoffRoundsForTeams(columnTeams),
        }
      : {}),
    ...(columnStart != null ? { playoff_start_week: columnStart } : {}),
  }

  const nextStructure: Record<string, unknown> = { ...currentStructure }
  let applied = false

  for (const [key, value] of Object.entries(defaultStructure)) {
    if (nextStructure[key] === undefined || nextStructure[key] === null) {
      nextStructure[key] = key === 'seeding_rules' ? resolveConfiguredPlayoffSeedingRule(league, String(value)) : value
      applied = true
    }
  }
  /*
   * 🛑 THE DRAFT-ORDER FLAG ONLY COMES WITH A "PLAYS FOR" THIS CALL IS FILLING IN — i.e. on a league
   * being created. A league that already stores `consolation_plays_for` was set up before that setting
   * moved the draft order, and must keep its order until its commissioner saves it
   * (lib/playoff-runtime/consolationPlaysFor.ts).
   */
  if (currentStructure[CONSOLATION_PLAYS_FOR_SETTINGS_KEY] == null && nextStructure[CONSOLATION_PLAYS_FOR_DRAFT_ORDER_KEY] == null) {
    nextStructure[CONSOLATION_PLAYS_FOR_DRAFT_ORDER_KEY] = true
    applied = true
  }

  const nextSettings: Record<string, unknown> = { ...settings }
  if (nextSettings.playoff_team_count === undefined || nextSettings.playoff_team_count === null) {
    nextSettings.playoff_team_count = columnTeams ?? def.playoff_team_count
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
