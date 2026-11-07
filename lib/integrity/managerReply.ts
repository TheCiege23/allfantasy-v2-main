import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { logAction } from '@/server/services/auditService'
import { resolveTankingTeam } from './tankingPenaltyService'

/**
 * The flagged manager's side of a tanking case: they see what was flagged and can explain it before the
 * commissioner rules (owner decision 2026-11-06). "My QB was a game-time scratch" is exactly the context
 * a lineup rule cannot see, and a commissioner deciding whether to take a draft pick should read it first.
 *
 * ⚠ STORED ON THE FLAG, IN `evidenceJson.managerReply`, SO IT NEEDS NO MIGRATION. It travels with every
 * read of the flag the commissioner page already does. The tanking scan rebuilds `evidenceJson` when a
 * repeat week extends a case, and carries `managerReply` across (TankingDetectionEngine.ts) — a reply
 * must never be erased by the next week's scan.
 *
 * ⚠ ONLY THE MANAGER NAMED ON THE FLAG. A tanking flag is private to commissioners until they act; the
 * one other person who may see it is the manager it accuses, who has already been told about it. Every
 * other caller gets `not_found`, never a hint the flag exists. Collusion flags are never shown here:
 * those managers are not notified, so revealing a collusion case would tip off the people it is about.
 */

export const MANAGER_REPLY_MAX = 1000
export const TANKING_REPLY_ACTION = 'integrity.tanking_manager_reply'

export type ManagerReply = { userId: string; text: string; submittedAt: string }

export type ManagerFlagView = {
  id: string
  status: string
  summary: string
  createdAt: string
  starts: { week: number | null; slot: string; player: string; status: string; bench: string | null }[]
  weeksFlagged: number[]
  reply: ManagerReply | null
  canReply: boolean
}

export type ReplyError = 'not_found' | 'closed' | 'empty' | 'too_long'
export const REPLY_ERROR_STATUS: Record<ReplyError, number> = { not_found: 404, closed: 409, empty: 400, too_long: 400 }

type FlagRow = {
  id: string
  leagueId: string
  flagType: string
  status: string
  summary: string
  createdAt: Date
  affectedRosterIds: string[]
  evidenceJson: unknown
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function readManagerReply(evidence: unknown): ManagerReply | null {
  const r = record(record(evidence).managerReply)
  return typeof r.userId === 'string' && typeof r.text === 'string' && typeof r.submittedAt === 'string'
    ? { userId: r.userId, text: r.text, submittedAt: r.submittedAt }
    : null
}

/** The flag, only when this user manages a team on it. Anything else reads as absent. */
async function flagForManager(leagueId: string, flagId: string, userId: string): Promise<FlagRow | null> {
  const flag = (await prisma.integrityFlag.findFirst({
    where: { id: flagId, leagueId, flagType: 'tanking' },
    select: { id: true, leagueId: true, flagType: true, status: true, summary: true, createdAt: true, affectedRosterIds: true, evidenceJson: true },
  })) as FlagRow | null
  if (!flag) return null
  for (const rosterId of flag.affectedRosterIds) {
    const team = await resolveTankingTeam(leagueId, rosterId)
    if (team.userId === userId) return flag
  }
  return null
}

function viewOf(flag: FlagRow): ManagerFlagView {
  const ev = record(flag.evidenceJson)
  const starts = Array.isArray(ev.illegalOrSuspiciousStarters) ? ev.illegalOrSuspiciousStarters : []
  return {
    id: flag.id,
    status: flag.status,
    summary: flag.summary,
    createdAt: flag.createdAt.toISOString(),
    starts: starts.map((s) => {
      const o = record(s)
      return {
        week: typeof o.week === 'number' ? o.week : typeof ev.weekNumber === 'number' ? ev.weekNumber : null,
        slot: typeof o.slotPosition === 'string' ? o.slotPosition : '',
        player: typeof o.startedPlayerName === 'string' ? o.startedPlayerName : '',
        status: typeof o.startedPlayerStatus === 'string' ? o.startedPlayerStatus : '',
        bench: typeof o.benchedBetterOption === 'string' ? o.benchedBetterOption : null,
      }
    }),
    weeksFlagged: Array.isArray(ev.weeksFlagged) ? ev.weeksFlagged.filter((w): w is number => typeof w === 'number') : [],
    reply: readManagerReply(flag.evidenceJson),
    canReply: flag.status === 'open',
  }
}

export async function loadFlagForManager(leagueId: string, flagId: string, userId: string): Promise<ManagerFlagView | null> {
  const flag = await flagForManager(leagueId, flagId, userId)
  return flag ? viewOf(flag) : null
}

/**
 * Save (or replace) the manager's reply while the case is open. The commissioner is told, with a link
 * straight to the flag. A ruled case is closed to replies: the explanation was for before the ruling.
 */
export async function submitManagerReply(
  leagueId: string,
  flagId: string,
  userId: string,
  rawText: unknown,
): Promise<{ ok: true; view: ManagerFlagView } | { ok: false; error: ReplyError }> {
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text) return { ok: false, error: 'empty' }
  if (text.length > MANAGER_REPLY_MAX) return { ok: false, error: 'too_long' }

  const flag = await flagForManager(leagueId, flagId, userId)
  if (!flag) return { ok: false, error: 'not_found' }
  if (flag.status !== 'open') return { ok: false, error: 'closed' }

  const reply: ManagerReply = { userId, text, submittedAt: new Date().toISOString() }
  // Merge onto the evidence as it is NOW, inside one transaction, so a scan writing the same row is not lost.
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.integrityFlag.findFirst({ where: { id: flagId, leagueId }, select: { evidenceJson: true, status: true } })
    if (!fresh || fresh.status !== 'open') return null
    const evidenceJson = { ...record(fresh.evidenceJson), managerReply: reply } as unknown as Prisma.InputJsonValue
    return tx.integrityFlag.update({
      where: { id: flagId },
      data: { evidenceJson },
      select: { id: true, leagueId: true, flagType: true, status: true, summary: true, createdAt: true, affectedRosterIds: true, evidenceJson: true },
    })
  })
  if (!updated) return { ok: false, error: 'closed' }

  await logAction({
    leagueId,
    userId,
    actionType: TANKING_REPLY_ACTION,
    entityType: 'integrity_flag',
    entityId: flagId,
    metadata: { length: text.length },
  }).catch(() => undefined)

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }).catch(() => null)
  if (league?.userId && league.userId !== userId) {
    await dispatchNotification({
      userIds: [league.userId],
      category: 'commissioner_alerts',
      type: 'integrity_tanking_reply',
      title: 'A manager replied to a tanking flag',
      body: 'Read their explanation before you rule on it.',
      severity: 'medium',
      leagueId,
      actionHref: `/league/${leagueId}/commissioner/integrity?flag=${encodeURIComponent(flagId)}`,
      actionLabel: 'Read reply',
      meta: { leagueId, flagId },
    }).catch((err) => console.error('[integrity] reply alert failed', err))
  }

  return { ok: true, view: viewOf(updated as FlagRow) }
}
