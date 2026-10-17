export function tournamentRoundEnds(settings: { regularSeasonLength: number; tournamentAdvancementRounds: number; roundEndWeeks?: number[] }): number[] {
  if (!Number.isInteger(settings.tournamentAdvancementRounds) || settings.tournamentAdvancementRounds < 0 || settings.tournamentAdvancementRounds > 10 || !Number.isInteger(settings.regularSeasonLength) || settings.regularSeasonLength < 1) throw new Error('Invalid tournament round settings')
  const ends = settings.roundEndWeeks?.length ? settings.roundEndWeeks : Array.from({ length: settings.tournamentAdvancementRounds + 1 }, (_, i) => settings.regularSeasonLength + i)
  if (ends.length !== settings.tournamentAdvancementRounds + 1 || ends.some((week, i) => !Number.isInteger(week) || week < 1 || (i > 0 && week <= ends[i - 1]!))) throw new Error('Tournament round ends must be increasing scoring periods, one per round')
  return ends
}


export function isNativeTournamentLeague(league: { bbContestId?: string | null; bestBallMode?: boolean | null; settings?: unknown } | null | undefined): boolean {
  const settings = league?.settings as { best_ball_settings?: { contestStructure?: string } } | null
  return Boolean(league?.bbContestId && league.bestBallMode && settings?.best_ball_settings?.contestStructure === 'tournament')
}
