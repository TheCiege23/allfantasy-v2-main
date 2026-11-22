type KeeperWaiverRec = {
  playerId: string
  isKeeperTargetFlag: boolean
  keeperRoundProjection: number | null
  nextSeasonOutlook: string
  immediateValue: number
  keeperReasoning: string
}

export async function generateKeeperWaiverTargets(
  _rosterId: string,
  _leagueId: string,
  _week: number,
): Promise<KeeperWaiverRec[]> {
  return []
}
