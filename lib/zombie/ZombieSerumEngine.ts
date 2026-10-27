/**
 * Zombie serum engine: award, use, revive (PROMPT 353). Deterministic.
 */

import { prisma } from '@/lib/prisma'
import { getZombieLeagueConfig } from './ZombieLeagueConfig'
import { getStatus } from './ZombieOwnerStatusService'
import { appendZombieAudit } from './ZombieAuditLog'

export async function getSerumBalance(leagueId: string, rosterId: string): Promise<number> {
  const row = await prisma.zombieResourceLedger.findFirst({
    where: { leagueId, rosterId, resourceType: 'serum' },
    select: { balance: true },
  })
  return row?.balance ?? 0
}

/** Award serum (e.g. high score of week, or bash/maul). */
export async function awardSerum(
  leagueId: string,
  rosterId: string,
  reason: string,
  week?: number,
  zombieLeagueId?: string | null
): Promise<void> {
  const existing = await prisma.zombieResourceLedger.findFirst({
    where: { leagueId, rosterId, resourceType: 'serum' },
  })
  if (existing) {
    await prisma.zombieResourceLedger.update({
      where: { id: existing.id },
      data: {
        balance: existing.balance + 1,
        awardedInWeek: week ?? undefined,
        updatedAt: new Date(),
      },
    })
  } else {
    await prisma.zombieResourceLedger.create({
      data: {
        leagueId,
        zombieLeagueId: zombieLeagueId ?? null,
        rosterId,
        resourceType: 'serum',
        balance: 1,
        awardedInWeek: week ?? null,
      },
    })
  }
  await prisma.zombieResourceLedgerEntry.create({
    data: {
      leagueId,
      rosterId,
      resourceType: 'serum',
      delta: 1,
      reason,
      week: week ?? null,
    },
  })
  await appendZombieAudit({
    leagueId,
    zombieLeagueId: zombieLeagueId ?? null,
    eventType: 'serum_award',
    metadata: { rosterId, reason, week },
  })
}

/** Use serums to revive (Zombie -> Survivor). Requires serumReviveCount. Returns true if revived. */
export async function useSerumToRevive(
  leagueId: string,
  rosterId: string,
  zombieLeagueId?: string | null
): Promise<boolean> {
  const config = await getZombieLeagueConfig(leagueId)
  if (!config) return false
  const status = await getStatus(leagueId, rosterId)
  if (status !== 'Zombie') return false

  const cost = config.serumReviveCount
  const spent = await prisma.$transaction(async (tx) => {
    const row = await tx.zombieResourceLedger.findFirst({
      where: { leagueId, rosterId, resourceType: 'serum', balance: { gte: cost } },
    })
    if (!row) return false
    const debit = await tx.zombieResourceLedger.updateMany({
      where: { id: row.id, balance: { gte: cost } },
      data: { balance: { decrement: cost }, spentAt: new Date() },
    })
    if (debit.count !== 1) return false
    const revived = await tx.zombieLeagueTeam.updateMany({
      where: { leagueId, rosterId, status: 'Zombie' },
      data: { status: 'Survivor', revivedAt: new Date(), weekBecameZombie: null, killedByRosterId: null },
    })
    if (revived.count !== 1) throw new Error('Zombie status changed during revival')
    await tx.zombieResourceLedgerEntry.create({
      data: { leagueId, rosterId, resourceType: 'serum', delta: -cost, reason: 'revive', targetRosterId: rosterId },
    })
    return true
  })
  if (!spent) return false
  await appendZombieAudit({
    leagueId,
    zombieLeagueId: zombieLeagueId ?? null,
    eventType: 'revive',
    metadata: { rosterId, serumCount: cost },
  })
  return true
}
