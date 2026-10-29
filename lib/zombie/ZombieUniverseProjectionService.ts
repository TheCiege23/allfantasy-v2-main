import { getUniverseStandings } from './ZombieUniverseStandingsService'
import { getMovementProjections, upsertMovementProjection } from './ZombieMovementEngine'
import { planUniverseMovement } from './universeMovementPlan'
import { prisma } from '@/lib/prisma'

export async function refreshMovementProjections(universeId: string, season?: number): Promise<void> {
  const universe = await prisma.zombieUniverse.findUniqueOrThrow({ where: { id: universeId }, include: { levels: true } })
  const se = season ?? new Date().getUTCFullYear()
  const standings = await getUniverseStandings(universeId, se)
  const plan = planUniverseMovement(standings, universe.levels, universe)
  for (const row of plan) await upsertMovementProjection(universeId, row.rosterId, row.leagueId, {
    currentLevelId: row.currentLevelId, projectedLevelId: row.projectedLevelId, reason: row.reason, season: se,
  })
}
export async function getMovementOutlook(universeId: string, season?: number) {
  return getMovementProjections(universeId, season)
}
