type KeeperStrengthRanking = {
  rosterId: string
  keeperStrengthScore: number
  keeperSurplusTotal: number
  bestKeeper: { name: string; surplusLabel: string }
  worstKeeper: { name: string; surplusLabel: string }
  keeperTier: 'Keeper Advantage' | 'Balanced' | 'Keeper Disadvantage'
  narrative: string
}

export async function generateKeeperStrengthRankings(
  _leagueId: string,
  _seasonId: string,
): Promise<KeeperStrengthRanking[]> {
  return []
}
