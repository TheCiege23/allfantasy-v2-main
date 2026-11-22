type LeagueKeeperAnalysis = {
  teams: { rosterId: string; strongest: string[]; weakest: string[]; narrative: string }[]
  leagueNarrative: string
}

export async function analyzeLeagueKeeperValues(
  _leagueId: string,
  _outgoingSeasonId: string,
): Promise<LeagueKeeperAnalysis> {
  return {
    teams: [],
    leagueNarrative: 'Placeholder — Chimmy league-wide keeper analysis.',
  }
}
