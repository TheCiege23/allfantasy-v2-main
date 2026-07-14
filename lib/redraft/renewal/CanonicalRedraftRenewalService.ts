import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { EVENT, getPlatformEvents } from '@/lib/events'
import { publishLeagueFanoutEvent } from '@/lib/league-events/publisher'
import { transitionLeagueStateInTransaction } from '@/server/services/leagueLifecycleService'

export async function openRedraftRenewal(input: { leagueId: string; seasonId: string; actorUserId: string; deadline: Date }) {
  const league = await prisma.league.findUnique({ where: { id: input.leagueId }, select: { lifecycleState: true, userId: true, season: true, teams: { where: { isOrphan: false, platformUserId: { not: null } }, select: { id: true, platformUserId: true } } } })
  if (!league || league.userId !== input.actorUserId) throw new Error('FORBIDDEN')
  if (league.lifecycleState !== 'offseason') throw new Error('LEAGUE_NOT_OFFSEASON')
  const snapshot = await prisma.leagueSeason.findUnique({ where: { leagueId_season: { leagueId: input.leagueId, season: league.season } }, select: { id: true } })
  if (!snapshot) throw new Error('SNAPSHOT_REQUIRED')
  const existing = await prisma.leagueRenewal.findUnique({ where: { leagueId_season: { leagueId: input.leagueId, season: league.season } }, include: { slots: true } })
  if (existing) return { renewal: existing, created: false }

  const renewal = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const row = await tx.leagueRenewal.create({ data: { leagueId: input.leagueId, season: league.season, renewalKind: 'redraft_reset', status: 'in_progress', initiatedBy: input.actorUserId, createdByUserId: input.actorUserId, priorSeasonId: input.seasonId, windowClosesAt: input.deadline, deadlineAt: input.deadline } })
    await tx.leagueRenewalSlot.createMany({ data: league.teams.filter((t) => t.platformUserId).map((t) => ({ renewalId: row.id, leagueId: input.leagueId, userId: t.platformUserId!, franchiseId: t.id, priorManagerId: t.platformUserId!, status: 'invited', isReturning: true })) })
    await transitionLeagueStateInTransaction(tx, { leagueId: input.leagueId, nextState: 'renewal_pending', actorUserId: input.actorUserId, source: 'engine:redraft-renewal', idempotencyKey: `renewal-open:${input.leagueId}:${input.seasonId}`, metadata: { renewalId: row.id, snapshotId: snapshot.id } })
    await tx.leagueAuditLog.create({ data: { leagueId: input.leagueId, userId: input.actorUserId, actionType: 'renewal_opened', entityType: 'league_renewal', entityId: row.id, metadata: { idempotencyKey: `renewal-open:${input.leagueId}:${input.seasonId}`, deadline: input.deadline.toISOString() } } })
    await getPlatformEvents().emitInTx(tx, EVENT.RENEWAL_OPENED, { leagueId: input.leagueId, seasonId: input.seasonId, actor: { type: 'commissioner', id: input.actorUserId }, idempotencyKey: `renewal-opened:${row.id}`, source: 'engine:redraft-renewal', subjects: [{ kind: 'renewal', id: row.id }], payload: { renewalId: row.id, seasonId: input.seasonId } })
    return tx.leagueRenewal.findUniqueOrThrow({ where: { id: row.id }, include: { slots: true } })
  })
  await publishLeagueFanoutEvent({ leagueId: input.leagueId, eventType: 'renewal_opened', title: 'Renewal is open', message: 'Renewal is open for the next season. Managers can now reserve or release their franchises.', category: 'league_announcements', visibility: 'all_members', actorUserId: input.actorUserId, dedupeKey: `renewal-open:${renewal.id}`, meta: { renewalId: renewal.id, seasonId: input.seasonId } })
  return { renewal, created: true }
}

export async function decideRedraftRenewal(input: { renewalId: string; userId: string; decision: 'renew' | 'decline' }) {
  const slot = await prisma.leagueRenewalSlot.findUnique({ where: { renewalId_userId: { renewalId: input.renewalId, userId: input.userId } }, include: { renewal: true } })
  if (!slot) throw new Error('SLOT_NOT_FOUND')
  if (slot.renewal.status !== 'in_progress') throw new Error('RENEWAL_LOCKED')
  const status = input.decision === 'renew' ? 'confirmed' : 'declined'
  if (slot.status === status) return { slot, changed: false }
  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const decisionAt = new Date()
    const row = await tx.leagueRenewalSlot.update({ where: { id: slot.id }, data: { status, isReturning: input.decision === 'renew', candidateManagerId: input.decision === 'renew' ? input.userId : null, respondedAt: decisionAt, decisionAt } })
    await tx.leagueAuditLog.create({ data: { leagueId: slot.leagueId, userId: input.userId, actionType: input.decision === 'renew' ? 'manager_renewed' : 'manager_declined', entityType: 'league_renewal_slot', entityId: slot.id, beforeState: { status: slot.status }, afterState: { status }, metadata: { renewalId: input.renewalId } } })
    const event = input.decision === 'renew' ? EVENT.MANAGER_RENEWED : EVENT.MANAGER_DECLINED
    await getPlatformEvents().emitInTx(tx, event, { leagueId: slot.leagueId, actor: { type: 'user', id: input.userId }, idempotencyKey: `renewal-decision:${input.renewalId}:${input.userId}:${status}`, source: 'engine:redraft-renewal', subjects: [{ kind: 'renewal_slot', id: slot.id }], payload: { renewalId: input.renewalId, userId: input.userId } })
    return row
  })
  return { slot: updated, changed: true }
}
