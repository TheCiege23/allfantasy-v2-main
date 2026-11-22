type StartSitRec = { playerId: string; action: string; confidence: number; reasoning: string }

export async function generateStartSitRecs(
  _rosterId: string,
  _week: number,
  _leagueId: string,
): Promise<StartSitRec[]> {
  return []
}
