import { readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { tournamentRoundEnds, isNativeTournamentLeague } from '@/lib/bestball/tournamentCalendar'
import { readConferenceSeasonPlan } from '@/lib/tournament/divisions/conferenceSeasonPlan'
import { readChampionshipLength, weeksForPlayoffRound } from '@/lib/playoff-runtime/playoffRoundWeeks'
/** Respect a dynasty commissioner's regular season length when materializing the first season. */
export function resolveCreatedSeasonWeeks(league: {
  bestBallMode?: boolean | null
  bbContestId?: string | null
  settings?: unknown
  dynastyConfig?: { regularSeasonWeeks: number } | null
  playoffTeams?: number | null
  playoffWeeksPerRound?: number | null
}, sportDefaultWeeks: number): number {
  const survivorPlan = readSurvivorFullSeasonPlan(league.settings)
  if (survivorPlan) return survivorPlan.endWeek
  // A divisions-tournament conference league plays through the tournament's championship week.
  const conferencePlan = readConferenceSeasonPlan(league.settings)
  if (conferencePlan) return conferencePlan.lastWeek
  if (isNativeTournamentLeague(league)) {
    const settings = (league.settings as { best_ball_settings?: { regularSeasonLength: number; tournamentAdvancementRounds: number; roundEndWeeks?: number[] } } | null)?.best_ball_settings
    if (settings) return tournamentRoundEnds(settings).at(-1)!
  }
  const regularWeeks = league.dynastyConfig?.regularSeasonWeeks
  if (!Number.isInteger(regularWeeks) || Number(regularWeeks) < 1) return sportDefaultWeeks
  const teams = league.playoffTeams ?? 0
  const rounds = teams >= 2 ? Math.ceil(Math.log2(teams)) : 0
  const perRound = Math.max(1, league.playoffWeeksPerRound ?? 1)
  if (rounds === 0) return Number(regularWeeks)
  // The final can run longer than the other rounds (`championship_length`, 2 for MLB/NHL); size the
  // season to the weeks the bracket will actually be played in (lib/playoff-runtime/playoffRoundWeeks.ts).
  const finalWeeks = weeksForPlayoffRound({
    roundNumber: rounds,
    weeksPerRound: perRound,
    finalRoundNumber: rounds,
    championshipLength: readChampionshipLength(league.settings),
  })
  return Number(regularWeeks) + (rounds - 1) * perRound + finalWeeks
}

/** A guillotine season ends at its last chop week; without one, the created length stands. */
export function resolveGuillotineSeasonWeeks(eliminationEndWeek: number | null | undefined, createdWeeks: number): number {
  return Number.isInteger(eliminationEndWeek) && Number(eliminationEndWeek) >= 1 ? Number(eliminationEndWeek) : createdWeeks
}
