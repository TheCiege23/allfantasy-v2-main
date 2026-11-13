import { prisma } from '@/lib/prisma'
import { getBaselineWeights, type ComponentWeights } from './adaptive-weight-learning'

export async function getActiveWeightsForSegment(segmentKey: string): Promise<ComponentWeights> {
  const row = await prisma.rankingWeightsWeekly.findFirst({
    where: { segmentKey, status: 'APPLIED' },
    orderBy: { weekStart: 'desc' },
  })

  if (!row) return getBaselineWeights(segmentKey)
  const f = row.finalJson as Record<string, number>
  return {
    market: f.market ?? 0.25,
    impact: f.impact ?? 0.25,
    scarcity: f.scarcity ?? 0.25,
    demand: f.demand ?? 0.25,
  }
}

