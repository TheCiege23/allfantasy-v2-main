/**
 * Zombie owner status service: Survivor, Zombie, Whisperer (PROMPT 353).
 * Legal transitions: Survivor->Zombie, Zombie->Survivor (revive), Whisperer->Zombie, optional Survivor->Whisperer / Zombie->Whisperer.
 */

import { prisma } from '@/lib/prisma'
import type { ZombieOwnerStatus } from './types'
import { syncZombieTeamNames } from './zombieTeamNames'

export async function getStatus(leagueId: string, rosterId: string): Promise<ZombieOwnerStatus | null> {
  const row = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId } },
    select: { status: true },
  })
  return row?.status as ZombieOwnerStatus ?? null
}

export async function getWhispererRosterId(leagueId: string): Promise<string | null> {
  const row = await prisma.zombieLeagueTeam.findFirst({
    where: { leagueId, status: 'Whisperer' },
    select: { rosterId: true },
  })
  return row?.rosterId ?? null
}

export async function getAllStatuses(leagueId: string): Promise<{ rosterId: string; status: ZombieOwnerStatus }[]> {
  const rows = await prisma.zombieLeagueTeam.findMany({
    where: { leagueId },
    select: { rosterId: true, status: true },
  })
  return rows.map((r) => ({ rosterId: r.rosterId, status: r.status as ZombieOwnerStatus }))
}

/** Ensure ZombieLeagueTeam rows exist for all rosters; one Whisperer, rest Survivors. Call after draft. */
export async function initializeLeagueTeams(
  leagueId: string,
  whispererRosterId: string,
  zombieLeagueId?: string | null
): Promise<void> {
  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true },
  })
  for (const r of rosters) {
    await prisma.zombieLeagueTeam.upsert({
      where: { leagueId_rosterId: { leagueId, rosterId: r.id } },
      create: {
        leagueId,
        zombieLeagueId: zombieLeagueId ?? null,
        rosterId: r.id,
        status: r.id === whispererRosterId ? 'Whisperer' : 'Survivor',
      },
      update: {},
    })
  }
}

/** Set status to Zombie (infection). */
export async function setZombie(
  leagueId: string,
  rosterId: string,
  week: number,
  killedByRosterId: string,
  zombieLeagueId?: string | null
): Promise<void> {
  await prisma.zombieLeagueTeam.update({
    where: { leagueId_rosterId: { leagueId, rosterId } },
    data: {
      status: 'Zombie',
      weekBecameZombie: week,
      killedByRosterId,
      revivedAt: null,
      zombieLeagueId: zombieLeagueId ?? undefined,
    },
  })
}

/** Revive Zombie -> Survivor (serum use). */
export async function setRevived(leagueId: string, rosterId: string): Promise<void> {
  await prisma.zombieLeagueTeam.update({
    where: { leagueId_rosterId: { leagueId, rosterId } },
    data: { status: 'Survivor', revivedAt: new Date(), weekBecameZombie: null, killedByRosterId: null },
  })
}

/** Optional: set Whisperer (e.g. vacancy fill). */
export async function setWhisperer(leagueId: string, rosterId: string): Promise<void> {
  const current = await getWhispererRosterId(leagueId)
  if (current) {
    await prisma.zombieLeagueTeam.update({
      where: { leagueId_rosterId: { leagueId, rosterId: current } },
      data: { status: 'Survivor' },
    })
  }
  await prisma.zombieLeagueTeam.update({
    where: { leagueId_rosterId: { leagueId, rosterId } },
    data: { status: 'Whisperer', weekBecameZombie: null, killedByRosterId: null, revivedAt: null },
  })
}

/** Ensure every roster in league has a ZombieLeagueTeam row (Survivor by default). Used when adding config. */
export async function ensureLeagueTeamRows(leagueId: string, zombieLeagueId?: string | null): Promise<void> {
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true } })
  const existing = await prisma.zombieLeagueTeam.findMany({
    where: { leagueId },
    select: { rosterId: true },
  })
  const existingSet = new Set(existing.map((e) => e.rosterId))
  for (const r of rosters) {
    if (existingSet.has(r.id)) continue
    await prisma.zombieLeagueTeam.create({
      data: {
        leagueId,
        zombieLeagueId: zombieLeagueId ?? null,
        rosterId: r.id,
        status: 'Survivor',
      },
    })
  }
  // Name the rows: without this every hub screen falls back to printing the roster id.
  await syncZombieTeamNames(leagueId).catch(() => 0)
}
