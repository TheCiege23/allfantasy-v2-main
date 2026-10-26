/**
 * Resolves full playoff bracket config for a league: teams, rounds, byes, consolation, championship.
 */
import { prisma } from '@/lib/prisma'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import type { SportType } from '@/lib/sport-defaults/types'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'
import { firstRoundByesForTeams, playoffRoundsForTeams } from '@/lib/playoff-runtime/playoffFit'
import { readThirdPlaceGameEnabled } from '@/lib/playoff-runtime/thirdPlaceGame'
import {
  leagueDraftOrderCarriesOver,
  readConsolationPickGoesTo,
  readConsolationPlaysFor,
} from '@/lib/playoff-runtime/consolationPlaysFor'

export interface PlayoffBracketConfig {
  playoff_team_count: number
  playoff_weeks: number
  playoff_start_week: number | null
  playoff_start_point: number | null
  first_round_byes: number
  bracket_type: string
  matchup_length: number
  total_rounds: number | null
  consolation_bracket_enabled: boolean
  third_place_game_enabled: boolean
  toilet_bowl_enabled: boolean
  championship_length: number
  consolation_plays_for: string
  /** Toilet bowl: which finalist takes pick 1 when it plays for the pick ('loser' | 'winner'). */
  consolation_pick_goes_to: string
  /** False for a redraft league: its lower bracket never moves next season's draft order. */
  draft_order_carries_over: boolean
  sport: string
  variant: string | null
}

/**
 * Get bracket config for a league (for playoff displays and matchup generation).
 */
export async function getBracketConfigForLeague(leagueId: string): Promise<PlayoffBracketConfig | null> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: {
      sport: true,
      leagueVariant: true,
      settings: true,
      playoffStartWeek: true,
      playoffTeams: true,
      playoffWeeksPerRound: true,
      playoffSeedingRule: true,
      playoffLowerBracket: true,
      leagueType: true,
      isDynasty: true,
    },
  })
  if (!league) return null

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const sport = (league.sport as string) || DEFAULT_SPORT
  const variant = league.leagueVariant ?? null
  const sportType = toSportType(sport) as SportType
  const defaults = resolveDefaultPlayoffConfig(sportType, variant ?? undefined)

  const structure = settings.playoff_structure != null && typeof settings.playoff_structure === 'object'
    ? (settings.playoff_structure as Record<string, unknown>)
    : {}
  const fromSettings = <T>(key: string, fallback: T): T => {
    const valueInStructure = structure[key]
    if (valueInStructure !== undefined && valueInStructure !== null) return valueInStructure as T
    const valueInTopLevel = settings[key]
    if (valueInTopLevel !== undefined && valueInTopLevel !== null) return valueInTopLevel as T
    return fallback
  }
  const teamCountFromJson = fromSettings<number>(
    'playoff_team_count',
    defaults.playoff_team_count
  )
  const teamCount =
    league.playoffTeams != null && Number.isFinite(Number(league.playoffTeams))
      ? Number(league.playoffTeams)
      : teamCountFromJson

  const playoffStartFromJson = fromSettings<number | null>(
    'playoff_start_week',
    defaults.playoff_start_week ?? null
  )
  const playoffStart =
    league.playoffStartWeek != null && Number.isFinite(Number(league.playoffStartWeek))
      ? Number(league.playoffStartWeek)
      : playoffStartFromJson
  const playoffStartPoint = fromSettings<number | null>('playoff_start_point', playoffStart)

  const matchupLengthFromJson = fromSettings<number>('matchup_length', defaults.matchup_length ?? 1)
  const matchupLength =
    league.playoffWeeksPerRound != null && Number.isFinite(Number(league.playoffWeeksPerRound))
      ? Number(league.playoffWeeksPerRound)
      : matchupLengthFromJson

  const toiletFromJson = fromSettings<boolean>(
    'toilet_bowl_enabled',
    defaults.toilet_bowl_enabled ?? false,
  )
  const consolationFromJson = fromSettings<boolean>(
    'consolation_bracket_enabled',
    defaults.consolation_bracket_enabled ?? defaults.consolation_plays_for !== 'none',
  )
  const lb = String(league.playoffLowerBracket ?? '').toLowerCase()
  const toiletBowlEnabled = lb ? lb === 'toilet' : toiletFromJson
  const consolationEnabled = lb ? lb === 'consolation' || lb === 'consolation_bracket' : consolationFromJson

  /*
   * ⚠ BYES AND ROUNDS FOLLOW FROM THE FIELD, NOT FROM THE JSON BESIDE IT. Creation used to store the
   * registry's 2 byes / 3 rounds next to a 4-team column, so this screen showed a bracket the runtime
   * would never play. The runtime's rule (canonicalNflRedraftPlayoffRuntime.resolveSettings): byes are
   * the gap to the next power of two, a stated `first_round_byes` can only lower it, and the rounds
   * are ceil(log2(teams)). A league with no field (0 or 1 teams) keeps what it stores.
   */
  const rounds = playoffRoundsForTeams(teamCount)
  const storedByes = Number(fromSettings<number>('first_round_byes', defaults.first_round_byes))
  const gap = firstRoundByesForTeams(teamCount)
  const firstRoundByes = rounds === 0 ? storedByes : Number.isFinite(storedByes) && storedByes >= 0 ? Math.min(Math.floor(storedByes), gap) : gap
  const totalRounds = rounds === 0 ? fromSettings<number | null>('total_rounds', defaults.total_rounds ?? null) : rounds

  return {
    playoff_team_count: teamCount as number,
    playoff_weeks: fromSettings<number>('playoff_weeks', defaults.playoff_weeks),
    playoff_start_week: playoffStart,
    playoff_start_point: playoffStartPoint,
    first_round_byes: firstRoundByes,
    bracket_type: fromSettings<string>('bracket_type', defaults.bracket_type),
    matchup_length: matchupLength,
    total_rounds: totalRounds,
    consolation_bracket_enabled: consolationEnabled,
    // The reader the settings screen uses too (lib/playoff-runtime/thirdPlaceGame.ts).
    third_place_game_enabled: readThirdPlaceGameEnabled(settings, sport, variant),
    toilet_bowl_enabled: toiletBowlEnabled,
    championship_length: fromSettings<number>(
      'championship_length',
      defaults.championship_length ?? 1
    ),
    // The reader next season's draft order uses too (lib/playoff-runtime/consolationPlaysFor.ts).
    consolation_plays_for: readConsolationPlaysFor(settings, sport, variant),
    consolation_pick_goes_to: readConsolationPickGoesTo(settings),
    draft_order_carries_over: leagueDraftOrderCarriesOver({ leagueType: league.leagueType, isDynasty: league.isDynasty }),
    sport,
    variant,
  }
}
