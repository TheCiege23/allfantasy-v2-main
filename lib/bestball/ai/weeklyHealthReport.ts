type WeeklyHealthReport = {
  projectedOptimalScore: number
  riskPlayers: { name: string; risk: string; reason: string }[]
  byeWeekImpact: string | null
  topProjectedStarters: { name: string; position: string }[]
  rosterHealthGrade: string
  addSuggestions: string[]
  dropSuggestions: string[]
  narrative: string
}

export async function generateWeeklyHealthReport(
  _rosterId: string,
  _leagueId: string,
  week: number,
  sport: string,
): Promise<WeeklyHealthReport> {
  return {
    projectedOptimalScore: 0,
    riskPlayers: [],
    byeWeekImpact:
      sport === 'NFL'
        ? 'Preview only — bye week scan is not production-ready yet because live stats wiring is still pending.'
        : null,
    topProjectedStarters: [],
    rosterHealthGrade: 'B',
    addSuggestions: [],
    dropSuggestions: [],
    narrative: `Preview only — Best Ball weekly health for week ${week} is not production-ready yet. This surface is still waiting on live projection and risk wiring.`,
  }
}
