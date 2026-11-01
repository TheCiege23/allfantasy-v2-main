/**
 * Zombie movement engine: promotion/relegation between levels (PROMPT 353). Deterministic.
 */

import { prisma } from '@/lib/prisma'

export interface MovementRule {
  promoteCount: number
  relegateCount: number
  tieBreakers: string[] // e.g. ['points_for', 'head_to_head']
}

export async function getMovementProjections(
  universeId: string,
  season?: number
): Promise<{ rosterId: string; leagueId: string; currentLevelId: string; projectedLevelId: string; reason: string }[]> {
  const selectedSeason = season ?? (await prisma.zombieLeague.aggregate({ where: { universeId }, _max: { season: true } }))._max.season
  const rows = await prisma.zombieMovementProjection.findMany({
    where: { universeId, ...(selectedSeason != null ? { season: selectedSeason } : {}) },
    select: { rosterId: true, leagueId: true, currentLevelId: true, projectedLevelId: true, reason: true },
  })
  return rows.map((r) => ({
    rosterId: r.rosterId,
    leagueId: r.leagueId,
    currentLevelId: r.currentLevelId ?? '',
    projectedLevelId: r.projectedLevelId ?? '',
    reason: r.reason ?? '',
  }))
}

export async function upsertMovementProjection(
  universeId: string,
  rosterId: string,
  leagueId: string,
  payload: { currentLevelId?: string | null; projectedLevelId?: string | null; reason?: string | null; season?: number }
): Promise<void> {
  const season = payload.season ?? new Date().getFullYear()
  await prisma.zombieMovementProjection.upsert({
    where: {
      universeId_rosterId_season: { universeId, rosterId, season },
    },
    create: {
      universeId,
      rosterId,
      leagueId,
      currentLevelId: payload.currentLevelId ?? null,
      projectedLevelId: payload.projectedLevelId ?? null,
      reason: payload.reason ?? null,
      season,
    },
    update: {
      ...(payload.currentLevelId !== undefined && { currentLevelId: payload.currentLevelId }),
      ...(payload.projectedLevelId !== undefined && { projectedLevelId: payload.projectedLevelId }),
      ...(payload.reason !== undefined && { reason: payload.reason }),
    },
  })
}
