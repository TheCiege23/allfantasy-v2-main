type TeamRisk = {
  rosterId: string
  teamName: string
  elimRisk: number
  riskLabel: 'Hot Seat' | 'Nervous' | 'Comfortable' | 'Dominant'
  riskReason: string
}

type EliminationRiskRankings = {
  teams: TeamRisk[]
  mostLikelyEliminated: string | null
  biggestUpsetRisk: string | null
  safest: string | null
}

export async function generateLeagueRiskRankings(
  seasonId: string,
  scoringPeriod: number,
): Promise<EliminationRiskRankings> {
  void seasonId
  void scoringPeriod
  return {
    teams: [],
    mostLikelyEliminated: null,
    biggestUpsetRisk: null,
    safest: null,
  }
}
