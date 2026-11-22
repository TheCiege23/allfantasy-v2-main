import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import type { PlatformChatMessage } from '@/types/platform-shared'

/**
 * "Share with league" for a private @chimmy answer — 2026-11-16, owner's decision.
 *
 * @chimmy in league chat answers PRIVATELY (only the asker sees the question and the answer; the room
 * says so). That stays the default. This lets the asker post one of those answers publicly, on a tap,
 * as one league message: "<name> asked Chimmy: "<question>"" and the answer.
 *
 * 🛑 WHAT MAY BE SHARED: only a general Chimmy answer, which the chat route marks `chimmyShareable` when
 * it writes the reply. A Survivor vote, an idol or token play, or a Survivor host reply is a secret game
 * move and is never marked, so it can never be shared. Rows written before the mark existed are not
 * shareable either — refusing an old answer costs nothing; leaking a vote costs the game.
 *
 * Only the asker, only while they are still in the league, and only once per answer (a claim row, so two
 * taps or two tabs post one message).
 */

export type ShareChimmyResult =
  | { ok: true; alreadyShared: boolean; message: PlatformChatMessage | null; sharedMessageId: string }
  | { ok: false; status: number; error: string }

const CLAIM_PREFIX = 'chimmy-share:'
const CLAIM_RETENTION_MS = 365 * 24 * 3600 * 1000

/** The question as the league reads it: no leading "@chimmy", one line, capped. */
export function questionForLeague(raw: string): string {
  return raw
    .replace(/^\s*@chimmy\b[\s,:]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
}

export function sharedAnswerBody(askerName: string, question: string, answer: string): string {
  const q = questionForLeague(question)
  return q ? `${askerName} asked Chimmy: "${q}"\n\n${answer.trim()}` : `${askerName} shared a Chimmy answer:\n\n${answer.trim()}`
}

const meta = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: unknown }).code === 'P2002')
}

export async function shareChimmyAnswer(args: { leagueId: string; userId: string; messageId: string; now?: Date }): Promise<ShareChimmyResult> {
  const now = args.now ?? new Date()
  if (!args.leagueId || !args.messageId) return { ok: false, status: 400, error: 'leagueId and messageId are required.' }

  const reply = await prisma.leagueChatMessage.findUnique({
    where: { id: args.messageId },
    select: { id: true, leagueId: true, message: true, isPrivate: true, visibleToUserId: true, messageSubtype: true, metadata: true },
  })
  // Never say whether someone else's private row exists: every miss reads the same.
  if (!reply || reply.leagueId !== args.leagueId || !reply.isPrivate || reply.visibleToUserId !== args.userId) {
    return { ok: false, status: 404, error: 'That answer could not be found.' }
  }
  const m = meta(reply.metadata)
  if (m.chimmyPrivateReply !== true || reply.messageSubtype !== 'chimmy_private') {
    return { ok: false, status: 404, error: 'That answer could not be found.' }
  }
  if (m.chimmyShareable !== true || typeof m.questionMessageId !== 'string') {
    return { ok: false, status: 409, error: 'This answer is private to you and cannot be shared.' }
  }
  if (!(await resolveLeagueAccess(args.leagueId, args.userId))) {
    return { ok: false, status: 403, error: 'You are no longer in this league.' }
  }

  const key = `${CLAIM_PREFIX}${reply.id}`
  try {
    await prisma.sportsDataCache.create({
      data: {
        cacheKey: key,
        expiresAt: new Date(now.getTime() + CLAIM_RETENTION_MS),
        data: { status: 'sharing', userId: args.userId, at: now.toISOString() } as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (e) {
    if (!isUniqueViolation(e)) return { ok: false, status: 503, error: 'Sharing is unavailable right now. Try again in a moment.' }
    const prior = meta((await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } }).catch(() => null))?.data)
    if (typeof prior.sharedMessageId === 'string') return { ok: true, alreadyShared: true, message: null, sharedMessageId: prior.sharedMessageId }
    return { ok: false, status: 409, error: 'This answer is already being shared.' }
  }

  const [question, asker, league] = await Promise.all([
    prisma.leagueChatMessage.findUnique({
      where: { id: m.questionMessageId },
      select: { message: true, leagueId: true, visibleToUserId: true, userId: true },
    }),
    prisma.appUser.findUnique({ where: { id: args.userId }, select: { displayName: true, username: true } }),
    prisma.league.findUnique({ where: { id: args.leagueId }, select: { userId: true } }),
  ])
  // The linked question must be this user's own private @chimmy row in this league.
  const questionText =
    question && question.leagueId === args.leagueId && question.visibleToUserId === args.userId && question.userId === args.userId ? question.message : ''
  const askerName = asker?.displayName?.trim() || asker?.username || 'A league member'

  const posted = await createLeagueChatMessage(args.leagueId, league?.userId ?? args.userId, sharedAnswerBody(askerName, questionText, reply.message), {
    type: 'system',
    metadata: {
      isSystem: true,
      chimmy: true,
      sharedChimmyAnswer: { askedByUserId: args.userId, askedByName: askerName, sourceMessageId: reply.id },
    },
  })
  if (!posted) {
    await prisma.sportsDataCache.delete({ where: { cacheKey: key } }).catch(() => null)
    return { ok: false, status: 500, error: 'The answer could not be posted. Try again.' }
  }

  await Promise.all([
    prisma.sportsDataCache
      .update({ where: { cacheKey: key }, data: { data: { status: 'shared', userId: args.userId, sharedMessageId: posted.id, at: now.toISOString() } as unknown as Prisma.InputJsonValue } })
      .catch(() => null),
    // The private bubble learns it was shared, so the button turns into "Shared" on every device.
    prisma.leagueChatMessage
      .update({ where: { id: reply.id }, data: { metadata: { ...m, sharedMessageId: posted.id } as unknown as Prisma.InputJsonValue } })
      .catch(() => null),
  ])
  return { ok: true, alreadyShared: false, message: posted, sharedMessageId: posted.id }
}
