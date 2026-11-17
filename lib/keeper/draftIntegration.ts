import { prisma } from '@/lib/prisma'
import type { DraftOrderWithAdjustments, KeeperDraftPrep } from './types'

export async function prepareKeeperDraft(
  leagueId: string,
  incomingSeasonId: string,
): Promise<KeeperDraftPrep> {
  const locked = await prisma.keeperRecord.findMany({
    where: { leagueId, seasonId: incomingSeasonId, status: 'locked' },
  })
  const playersExcluded = locked.map((k) => k.playerId)
  return {
    teamsProcessed: new Set(locked.map((k) => k.rosterId)).size,
    picksForfeited: await prisma.keeperPickAdjustment.count({
      where: { leagueId, seasonId: incomingSeasonId },
    }),
    playersExcluded,
    summary: `${locked.length} keeper slots applied; ${playersExcluded.length} players excluded from draft pool.`,
  }
}

export async function getKeeperDraftOrder(
  leagueId: string,
  seasonId: string,
): Promise<DraftOrderWithAdjustments> {
  const adjustments = await prisma.keeperPickAdjustment.findMany({
    where: { leagueId, seasonId },
  })
  const byRound = new Map<number, { rosterId: string; forfeited: boolean; reason?: string }[]>()
  for (const a of adjustments) {
    const round = a.pickRoundForfeited
    const list = byRound.get(round) ?? []
    list.push({
      rosterId: a.rosterId,
      forfeited: true,
      reason: a.reason,
    })
    byRound.set(round, list)
  }
  const rounds = [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, picks]) => ({ round, picks }))
  return { rounds }
}

