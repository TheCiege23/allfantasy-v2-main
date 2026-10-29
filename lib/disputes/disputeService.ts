import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import {
  fileDispute,
  readDisputes,
  ruleDispute,
  rulingChatMessage,
  visibleDisputes,
  withDisputes,
  withdrawDispute,
  type DisputeError,
  type LeagueDispute,
} from './disputeStore'

/**
 * Dispute desk service: the locked read-merge-write on `League.settings.league_disputes`, plus the
 * side effects of filing and ruling. Pure rules live in ./disputeStore.
 *
 * ⚠ THE WRITE HOLDS A ROW LOCK. `League.settings` is one JSON blob shared by every settings writer;
 * two concurrent filings read-merge-written without a lock would drop one of them. Same pattern as
 * `lib/league-join/classRequests.ts`.
 *
 * ⚠ SIDE EFFECTS RUN AFTER THE COMMIT AND NEVER UNDO IT. A ruling the commissioner made stands
 * whether or not the notification, chat post or audit row then succeeds.
 */

export type DisputeViewer = { userId: string; isCommissioner: boolean }

export async function resolveDisputeViewer(leagueId: string, userId: string): Promise<DisputeViewer> {
  const role = await getLeagueRole(leagueId, userId)
  return { userId, isCommissioner: role === 'commissioner' || role === 'co_commissioner' }
}

export async function listDisputes(leagueId: string, viewer: DisputeViewer): Promise<LeagueDispute[]> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  return visibleDisputes(readDisputes(league?.settings), viewer.userId, viewer.isCommissioner)
}

type Mutation = { ok: true; dispute: LeagueDispute; disputes: LeagueDispute[] } | { ok: false; error: DisputeError }

async function mutateLocked(leagueId: string, mutate: (current: LeagueDispute[]) => Mutation): Promise<Mutation> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league) return { ok: false, error: 'not_found' } as const
    const result = mutate(readDisputes(league.settings))
    if (!result.ok) return result
    await tx.league.update({
      where: { id: leagueId },
      data: { settings: withDisputes(league.settings, result.disputes) as Prisma.InputJsonValue },
    })
    return result
  })
}

async function displayName(userId: string): Promise<string | null> {
  const u = await prisma.appUser.findUnique({ where: { id: userId }, select: { displayName: true, username: true } })
  return u?.displayName ?? u?.username ?? null
}

async function commissionerIds(leagueId: string): Promise<string[]> {
  const [league, teams] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId, claimedByUserId: { not: null }, OR: [{ isCommissioner: true }, { isCoCommissioner: true }] },
      select: { claimedByUserId: true },
    }),
  ])
  const ids = new Set<string>()
  if (league?.userId) ids.add(league.userId)
  for (const t of teams) if (t.claimedByUserId) ids.add(t.claimedByUserId)
  return [...ids]
}

async function notify(params: { userIds: string[]; leagueId: string; type: string; title: string; body: string }) {
  if (params.userIds.length === 0) return
  try {
    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    await dispatchNotification({
      userIds: params.userIds,
      category: 'commissioner_alerts',
      type: params.type,
      title: params.title,
      body: params.body,
      actionHref: `/league/${encodeURIComponent(params.leagueId)}/disputes`,
      actionLabel: 'Open dispute desk',
      leagueId: params.leagueId,
      severity: 'medium',
    })
  } catch (e) {
    console.warn('[disputes] notification failed', e instanceof Error ? e.message : e)
  }
}

async function audit(leagueId: string, userId: string, actionType: string, before: LeagueDispute | null, after: LeagueDispute) {
  try {
    await prisma.leagueAuditLog.create({
      data: {
        leagueId,
        userId,
        actionType,
        entityType: 'league_dispute',
        entityId: after.id,
        beforeState: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        afterState: after as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (e) {
    console.warn('[disputes] audit write failed', e instanceof Error ? e.message : e)
  }
}

export async function fileLeagueDispute(
  leagueId: string,
  userId: string,
  body: { category?: unknown; subject?: unknown; details?: unknown },
): Promise<Mutation> {
  const name = await displayName(userId)
  const result = await mutateLocked(leagueId, (current) =>
    fileDispute(current, { category: body.category, subject: body.subject, details: body.details, filedByUserId: userId, filedByName: name }, new Date(), randomUUID()),
  )
  if (!result.ok) return result
  const d = result.dispute
  // The filer may themselves be a commissioner; they do not need telling about their own filing.
  const recipients = (await commissionerIds(leagueId)).filter((id) => id !== userId)
  await notify({
    userIds: recipients,
    leagueId,
    type: 'league_dispute_filed',
    title: 'A dispute needs your ruling',
    body: `${name ?? 'A manager'} filed: ${d.subject}`,
  })
  await audit(leagueId, userId, 'dispute_filed', null, d)
  return result
}

export async function ruleLeagueDispute(
  leagueId: string,
  userId: string,
  disputeId: string,
  body: { outcome?: unknown; text?: unknown; postToChat?: unknown },
): Promise<Mutation> {
  const name = await displayName(userId)
  let before: LeagueDispute | null = null
  const result = await mutateLocked(leagueId, (current) => {
    before = current.find((d) => d.id === disputeId) ?? null
    return ruleDispute(current, disputeId, { outcome: body.outcome, text: body.text, postToChat: body.postToChat === true, ruledByUserId: userId, ruledByName: name }, new Date())
  })
  if (!result.ok) return result
  const d = result.dispute
  if (d.filedByUserId !== userId) {
    await notify({
      userIds: [d.filedByUserId],
      leagueId,
      type: 'league_dispute_ruled',
      title: 'Your dispute has a ruling',
      body: `${d.subject} — ${d.ruling?.outcome ?? 'ruled'}`,
    })
  }
  if (d.ruling?.postedToChat) {
    try {
      const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
      await createLeagueChatMessage(leagueId, userId, rulingChatMessage(d), {
        idempotencyKey: `dispute-ruling:${d.id}`,
        type: 'text',
        source: null,
        metadata: { kind: 'dispute_ruling', disputeId: d.id, outcome: d.ruling.outcome },
      })
    } catch (e) {
      console.warn('[disputes] chat post failed', e instanceof Error ? e.message : e)
    }
  }
  await audit(leagueId, userId, 'dispute_ruled', before, d)
  return result
}

export async function withdrawLeagueDispute(leagueId: string, userId: string, disputeId: string): Promise<Mutation> {
  let before: LeagueDispute | null = null
  const result = await mutateLocked(leagueId, (current) => {
    before = current.find((d) => d.id === disputeId) ?? null
    return withdrawDispute(current, disputeId, userId, new Date())
  })
  if (result.ok) await audit(leagueId, userId, 'dispute_withdrawn', before, result.dispute)
  return result
}
