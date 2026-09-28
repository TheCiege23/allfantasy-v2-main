import { tournamentRoundEnds, isNativeTournamentLeague } from '@/lib/bestball/tournamentCalendar'
/** Respect a dynasty commissioner's regular season length when materializing the first season. */
export function resolveCreatedSeasonWeeks(league: {
  bestBallMode?: boolean | null
  bbContestId?: string | null
  settings?: unknown
  dynastyConfig?: { regularSeasonWeeks: number } | null
  playoffTeams?: number | null
  playoffWeeksPerRound?: number | null
}, sportDefaultWeeks: number): number {
  if (isNativeTournamentLeague(league)) {
    const settings = (league.settings as { best_ball_settings?: { regularSeasonLength: number; tournamentAdvancementRounds: number; roundEndWeeks?: number[] } } | null)?.best_ball_settings
    if (settings) return tournamentRoundEnds(settings).at(-1)!
  }
  const regularWeeks = league.dynastyConfig?.regularSeasonWeeks
  if (!Number.isInteger(regularWeeks) || Number(regularWeeks) < 1) return sportDefaultWeeks
  const teams = league.playoffTeams ?? 0
  const rounds = teams >= 2 ? Math.ceil(Math.log2(teams)) : 0
  return Number(regularWeeks) + rounds * Math.max(1, league.playoffWeeksPerRound ?? 1)
}
