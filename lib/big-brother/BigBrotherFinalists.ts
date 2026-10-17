import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'

export async function getBigBrotherFinalists(leagueId: string): Promise<string[] | null> {
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return null
  const [rosters, cycles] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true } }),
    prisma.bigBrotherCycle.findMany({ where: { leagueId, configId: config.configId, evictedRosterId: { not: null } }, select: { evictedRosterId: true } }),
  ])
  const out = new Set(cycles.map(c => c.evictedRosterId))
  const finalists = rosters.map(r => r.id).filter(id => !out.has(id)).sort()
  return finalists.length === (config.finaleFormat === 'final_3' ? 3 : 2) ? finalists : null
}
