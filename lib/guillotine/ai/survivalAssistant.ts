import { prisma } from '@/lib/prisma'

type SurvivalAnalysis = {
  survivalProbability: number
  riskTier: 'SAFE' | 'MODERATE' | 'DANGER' | 'CRITICAL'
  projectedScore: number
  safeScoreTarget: number
  currentChopLine: number
  marginAboveLine: number
  biggestThreat: { playerName: string; reason: string; impact: string }
  recommendation: string
  shouldSpendFaab: boolean
  urgencyLevel: 'hold' | 'moderate_spend' | 'all_in'
  narrative: string
}

export async function generateSurvivalAnalysis(
  rosterId: string,
  seasonId: string,
  scoringPeriod: number,
): Promise<SurvivalAnalysis> {
  void rosterId
  const analysis: SurvivalAnalysis = {
    survivalProbability: 72,
    riskTier: 'MODERATE',
    projectedScore: 0,
    safeScoreTarget: 95,
    currentChopLine: 88,
    marginAboveLine: 4,
    biggestThreat: { playerName: '—', reason: 'Wire projections', impact: 'medium' },
    recommendation: 'Prioritize floor starters until chop window passes.',
    shouldSpendFaab: false,
    urgencyLevel: 'hold',
    narrative: 'Survival analysis pending live projection feed.',
  }
  const gs = await prisma.guillotineSeason.findFirst({ where: { id: seasonId }, select: { leagueId: true } })
  if (gs) {
    await prisma.guillotineAIInsight.create({
      data: {
        leagueId: gs.leagueId,
        seasonId,
        rosterId,
        scoringPeriod,
        type: 'survival_probability',
        content: analysis as object,
        narrative: analysis.narrative,
      },
    }).catch(() => {})
  }
  return analysis
}
