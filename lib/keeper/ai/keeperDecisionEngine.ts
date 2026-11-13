import { prisma } from '@/lib/prisma'

type KeeperRecommendation = {
  playerId: string
  recommendation: 'definite_keep' | 'keep' | 'borderline' | 'let_go'
  surplusValue: number
  reasoning: string
  confidence: number
}

export async function generateKeeperRecommendations(
  rosterId: string,
  leagueId: string,
  outgoingSeasonId: string,
): Promise<{
  keeperRanking: KeeperRecommendation[]
  finalPicks: string[]
  keyInsight: string
  opportunityCost: string
}> {
  const elig = await prisma.keeperEligibility.findMany({
    where: { rosterId, leagueId, seasonId: outgoingSeasonId, isEligible: true },
  })
  const ranking: KeeperRecommendation[] = elig.map((e) => ({
    playerId: e.playerId,
    recommendation: 'borderline',
    surplusValue: 0,
    reasoning: 'Placeholder — wire OpenAI + projections.',
    confidence: 50,
  }))
  return {
    keeperRanking: ranking,
    finalPicks: ranking.slice(0, 3).map((r) => r.playerId),
    keyInsight: 'Connect RI projections and ADP pick values for full analysis.',
    opportunityCost: 'TBD',
  }
}
