import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

function readReturnedMainRosterId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const json = metadata as Prisma.JsonObject
  const mainRosterId = typeof json.mainRosterId === 'string' ? json.mainRosterId.trim() : ''
  if (mainRosterId) return mainRosterId
  const rosterId = typeof json.rosterId === 'string' ? json.rosterId.trim() : ''
  return rosterId || null
}

export async function getReturnedRosterIds(leagueId: string): Promise<Set<string>> {
  const rows = await prisma.survivorAuditLog.findMany({
    where: {
      leagueId,
      eventType: 'return_to_island',
    },
    orderBy: { createdAt: 'asc' },
    select: { metadata: true },
  })

  const returnedRosterIds = new Set<string>()
  for (const row of rows) {
    const mainRosterId = readReturnedMainRosterId(row.metadata)
    if (mainRosterId) {
      returnedRosterIds.add(mainRosterId)
    }
  }
  return returnedRosterIds
}

export async function getCurrentlyEliminatedRosterIds(leagueId: string): Promise<Set<string>> {
  // The canonical cast state changes only when elimination commits, not when a private tally
  // has merely selected a candidate. It also survives return-to-island transitions.
  const cast = await prisma.survivorPlayer.findMany({ where: { leagueId }, select: { redraftRosterId: true, playerState: true } })
  if (cast.length) {
    const ids = cast.filter(player => player.playerState !== 'active' && player.playerState !== 'survivor_winner').map(player => player.redraftRosterId).filter((id): id is string => Boolean(id))
    const links = ids.length ? await prisma.roster.findMany({ where: { leagueId, id: { in: ids } }, select: { redraftRosterId: true } }) : []
    return new Set([...ids, ...links.map(row => row.redraftRosterId).filter((id): id is string => Boolean(id))])
  }
  const [eliminatedRows, returnedRosterIds] = await Promise.all([
    prisma.survivorTribalCouncil.findMany({
      where: {
        leagueId,
        eliminatedRosterId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      select: { eliminatedRosterId: true },
    }),
    getReturnedRosterIds(leagueId),
  ])

  const eliminatedRosterIds = new Set<string>()
  for (const row of eliminatedRows) {
    const rosterId = row.eliminatedRosterId?.trim()
    if (rosterId) {
      eliminatedRosterIds.add(rosterId)
    }
  }
  for (const rosterId of returnedRosterIds) {
    eliminatedRosterIds.delete(rosterId)
  }
  return eliminatedRosterIds
}

export async function getActiveRosterIdsForLeague(leagueId: string): Promise<string[]> {
  const [rosters, eliminatedRosterIds] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true },
    }),
    getCurrentlyEliminatedRosterIds(leagueId),
  ])

  return rosters
    .map((roster) => roster.id)
    .filter((rosterId) => !eliminatedRosterIds.has(rosterId))
}

export async function isRosterCurrentlyEliminated(leagueId: string, rosterId: string): Promise<boolean> {
  const eliminatedRosterIds = await getCurrentlyEliminatedRosterIds(leagueId)
  return eliminatedRosterIds.has(rosterId)
}

export async function getExcludedRosterIdsForSurvivor(leagueId: string): Promise<string[]> {
  return [...(await getCurrentlyEliminatedRosterIds(leagueId))]
}
