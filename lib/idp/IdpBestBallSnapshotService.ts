/**
 * IDP best-ball lineup snapshots: write, read, regenerate per roster/period.
 * Includes IDP slots; starterIds is array of { playerId, slotName }.
 * PROMPT 5/6.
 */

import { prisma } from '@/lib/prisma'

interface IdpBestBallStarterEntry {
  playerId: string
  slotName: string
}

export async function upsertIdpBestBallSnapshot(
  leagueId: string,
  configId: string,
  rosterId: string,
  periodKey: string,
  starterIds: IdpBestBallStarterEntry[],
  totalPoints?: number
): Promise<void> {
  await prisma.idpBestBallLineupSnapshot.upsert({
    where: {
      leagueId_rosterId_periodKey: { leagueId, rosterId, periodKey },
    },
    create: {
      leagueId,
      configId,
      rosterId,
      periodKey,
      totalPoints: totalPoints ?? null,
      starterIds: starterIds as object,
    },
    update: {
      configId,
      totalPoints: totalPoints ?? undefined,
      starterIds: starterIds as object,
    },
  })
}

export async function getIdpBestBallSnapshots(
  leagueId: string,
  options: { rosterId?: string; periodKey?: string } = {}
): Promise<
  Array<{
    rosterId: string
    periodKey: string
    totalPoints: number | null
    starterIds: IdpBestBallStarterEntry[]
    createdAt: Date
  }>
> {
  const rows = await prisma.idpBestBallLineupSnapshot.findMany({
    where: { leagueId, ...(options.rosterId && { rosterId: options.rosterId }), ...(options.periodKey && { periodKey: options.periodKey }) },
    orderBy: { createdAt: 'desc' },
    select: { rosterId: true, periodKey: true, totalPoints: true, starterIds: true, createdAt: true },
  })
  return rows.map((r) => ({
    rosterId: r.rosterId,
    periodKey: r.periodKey,
    totalPoints: r.totalPoints,
    starterIds: (r.starterIds as unknown as IdpBestBallStarterEntry[]) ?? [],
    createdAt: r.createdAt,
  }))
}

/**
 * Regenerate best-ball snapshots for an IDP league (all rosters, given period keys).
 * Caller should run optimizer to compute optimal lineups; this only persists results.
 */
export async function regenerateIdpBestBallSnapshots(
  leagueId: string,
  configId: string,
  inputs: Array<{ rosterId: string; periodKey: string; starters: IdpBestBallStarterEntry[]; totalPoints?: number }>
): Promise<number> {
  let count = 0
  for (const { rosterId, periodKey, starters, totalPoints } of inputs) {
    await upsertIdpBestBallSnapshot(leagueId, configId, rosterId, periodKey, starters, totalPoints)
    count++
  }
  return count
}
