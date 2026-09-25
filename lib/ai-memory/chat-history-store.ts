/**
 * PROMPT 234 — chat_history table service for Chimmy memory context.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'

export interface ChatHistoryMessage {
  role: string
  content: string
  createdAt?: Date
  /**
   * Whatever the writer stamped on the turn. The prompt-context caller ignores it; the drawer
   * reads `display` out of it so a rehydrated answer can still say what it was grounded on.
   *
   * ⚠ WIDENED RATHER THAN GIVEN ITS OWN READER. Two functions selecting near-identical columns
   * from one table is the shape that drifts — one gets a fix and the other does not. The extra
   * column costs the existing caller nothing.
   */
  meta?: unknown
  /**
   * Which league this turn was about, or null when it was asked with no league in scope.
   *
   * 🛑 LOAD-BEARING NOW THAT ONE THREAD SPANS LEAGUES. Without it the prompt would hand Chimmy a
   * Cream Bowl exchange and a KBFL exchange as undifferentiated "recent chat", and it would answer
   * a question about one using facts from the other. The column was always written; nothing read it.
   */
  leagueId?: string | null
}

export interface AppendChatHistoryInput {
  conversationId: string
  role: 'user' | 'assistant' | string
  content: string
  userId?: string | null
  leagueId?: string | null
  meta?: Record<string, unknown> | null
}

/**
 * ONE thread per user — user's decision, 2026-09-20.
 *
 * This used to key on `(userId, leagueId)`, which meant a manager with five leagues had five
 * separate transcripts and no way to reach the others. Reported as "my previous conversation from
 * mobile is not showing up on PC" — and the read was working fine; mobile had been in league
 * `ff59b139…` and the PC was in `7614a51d…`, so they were simply different threads.
 *
 * ⚠ THE `leagueId` PARAMETER IS KEPT AND DELIBERATELY UNUSED. Every caller passes it, and the
 * turns it writes still record their league on the ROW (`chat_history.leagueId`) — which is what
 * `getRecentChatHistory` renders so a cross-league thread cannot be read as one league's. Dropping
 * the parameter would force five call sites to change for no behavioural gain and would lose the
 * documentation of what the key deliberately no longer does.
 *
 * ⚠ AND OLD ROWS ARE NOT RE-KEYED. They stay under their `chimmy:<user>:<league>` ids and remain
 * visible, because the read below is scoped by USER rather than by conversation. Re-keying would
 * have been a migration over live data to gain nothing a `WHERE userId` does for free.
 */
export function buildChimmyConversationId(input: {
  userId?: string | null
  leagueId?: string | null
  explicitConversationId?: string | null
}): string {
  if (input.explicitConversationId && input.explicitConversationId.trim().length > 0) {
    return input.explicitConversationId.trim()
  }
  if (input.userId) return `chimmy:${input.userId}`
  return `chimmy:anon:${randomUUID()}`
}

export async function appendChatHistory(input: AppendChatHistoryInput): Promise<void> {
  const content = input.content.trim()
  if (!content) return

  // conversationId is caller-suppliable (form field / JSON field), so before writing anything
  // into it, confirm it either doesn't exist yet or already belongs to this same user. Without
  // this, one user's turns could be appended into — and silently bump the counters of — another
  // user's conversation record just by guessing/reusing that user's conversationId.
  let existing: { id: string; messageCount: number; userId: string | null } | null = null
  if (input.userId) {
    try {
      existing = await prisma.chatConversation.findUnique({
        where: { id: input.conversationId },
        select: { id: true, messageCount: true, userId: true },
      })
    } catch (error) {
      console.warn('[ChatHistory] failed to check conversation ownership:', String(error))
      return
    }
    if (existing && existing.userId !== input.userId) {
      console.warn('[ChatHistory] refused to append to a conversation owned by a different user')
      return
    }
  }

  const id = randomUUID()
  try {
    await prisma.$executeRaw`
      INSERT INTO "chat_history"
        ("id", "conversationId", "userId", "leagueId", "role", "content", "meta", "createdAt")
      VALUES
        (${id}, ${input.conversationId}, ${input.userId ?? null}, ${input.leagueId ?? null}, ${input.role}, ${content}, ${input.meta ? JSON.stringify(input.meta) : null}::jsonb, NOW())
    `
  } catch (error) {
    console.warn('[ChatHistory] failed to append chat_history:', String(error))
    return
  }

  // Keep chat_conversations fresh for existing UIs that rely on conversation rollups.
  if (input.userId) {
    try {
      if (!existing) {
        await prisma.chatConversation.create({
          data: {
            id: input.conversationId,
            userId: input.userId,
            messageCount: 1,
            lastMessageAt: new Date(),
          },
        })
      } else {
        await prisma.chatConversation.update({
          where: { id: input.conversationId },
          data: {
            messageCount: existing.messageCount + 1,
            lastMessageAt: new Date(),
          },
        })
      }
    } catch (error) {
      console.warn('[ChatHistory] failed to maintain chat_conversations:', String(error))
    }
  }
}

/**
 * This user's recent turns — ONE thread, across every league.
 *
 * 🛑 SCOPED BY USER, NOT BY CONVERSATION, AND THAT IS WHAT SAVES THE EXISTING HISTORY.
 * Turns written before 2026-09-20 sit under `chimmy:<user>:<leagueId>` keys, one per league.
 * Keying the read on a single new conversation id would have made every one of them invisible
 * overnight — the user would have watched their history disappear in the change that was supposed
 * to unify it. `chat_history.userId` is stamped on every row, by both halves of every exchange, so
 * a `WHERE "userId"` unions the old per-league rows and the new single-thread rows for free, with
 * no migration over live data.
 *
 * ⚠ `userId` WAS ALREADY THE REAL SECURITY BOUNDARY, which is why dropping the conversation filter
 * is safe. The previous note on this function spells it out: `conversationId` is caller-suppliable,
 * so it never constrained anything an attacker could not also supply — the `userId` clause is what
 * stopped one user reading another's turns, and it is untouched.
 *
 * Pass `conversationId` only to read one specific thread (the World Cup reply path supplies its
 * own id); omit it for the ordinary "everything this user has said" read.
 */
export async function getRecentChatHistory(
  conversationIdOrOptions:
    | string
    | {
        userId: string
        limit: number
        conversationId?: string | null
        /**
         * Rethrow a failed read instead of answering `[]`. A surface that SHOWS the transcript needs
         * this: `[]` renders as "Nothing asked yet." for someone who has asked plenty (E2, 2026-09-25).
         * Prompt memory leaves it off — an answer with no memory beats no answer at all.
         */
        throwOnError?: boolean
      },
  limitArg?: number,
  userIdArg?: string
): Promise<ChatHistoryMessage[]> {
  /*
   * ⚠ BOTH SHAPES ON PURPOSE. The positional form has two live callers outside this change and a
   * suite that pins it; widening in place keeps ONE implementation of the query rather than
   * leaving a second near-identical reader to drift out of step with this one.
   */
  const positional = typeof conversationIdOrOptions === 'string'
  const opts = positional
    ? { userId: userIdArg ?? '', limit: limitArg ?? 0, conversationId: conversationIdOrOptions }
    : conversationIdOrOptions
  const { userId, limit } = opts
  const conversationId = opts.conversationId?.trim() || null
  /*
   * ⚠ AN EMPTY `conversationId` MEANS DIFFERENT THINGS IN THE TWO SHAPES, AND CONFLATING THEM
   * WOULD WIDEN A CALLER'S READ WITHOUT ASKING. The positional form always named a conversation,
   * so an empty one was a caller with nothing to look up and returned nothing; silently promoting
   * that to "every turn this user has ever written" is the kind of scope creep a caller would
   * never see. Omitting the key in the options form is the deliberate way to ask for the thread.
   */
  if (positional && !conversationId) return []
  if (limit <= 0 || !userId) return []
  try {
    const rows = await prisma.$queryRaw<
      Array<{ role: string; content: string; createdAt: Date; meta: unknown; leagueId: string | null }>
    >`
      SELECT "role", "content", "createdAt", "meta", "leagueId"
      FROM "chat_history"
      WHERE "userId" = ${userId}
        AND (${conversationId}::text IS NULL OR "conversationId" = ${conversationId})
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `
    return rows
      .map(
        (row: {
          role: string
          content: string
          createdAt?: Date
          meta?: unknown
          leagueId?: string | null
        }) => ({
          role: row.role,
          content: row.content,
          createdAt: row.createdAt,
          meta: row.meta ?? null,
          leagueId: row.leagueId ?? null,
        }),
      )
      .reverse()
  } catch (error) {
    if (!positional && conversationIdOrOptions.throwOnError) throw error
    console.warn('[ChatHistory] failed to query chat_history:', String(error))
    return []
  }
}
