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
}

export interface AppendChatHistoryInput {
  conversationId: string
  role: 'user' | 'assistant' | string
  content: string
  userId?: string | null
  leagueId?: string | null
  meta?: Record<string, unknown> | null
}

export function buildChimmyConversationId(input: {
  userId?: string | null
  leagueId?: string | null
  explicitConversationId?: string | null
}): string {
  if (input.explicitConversationId && input.explicitConversationId.trim().length > 0) {
    return input.explicitConversationId.trim()
  }
  if (input.userId && input.leagueId) return `chimmy:${input.userId}:${input.leagueId}`
  if (input.userId) return `chimmy:${input.userId}:global`
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
 * Get recent messages for a conversation (for prompt context).
 *
 * `conversationId` is caller-suppliable, so this is scoped by `userId` as well — every
 * `chat_history` row carries the human user's own userId (both their message and Chimmy's reply
 * are stamped with it), so filtering on it means a caller only ever sees turns from a conversation
 * they were actually part of, regardless of what conversationId string they pass in.
 */
export async function getRecentChatHistory(
  conversationId: string,
  limit: number,
  userId: string
): Promise<ChatHistoryMessage[]> {
  if (!conversationId || limit <= 0 || !userId) return []
  try {
    const rows = await prisma.$queryRaw<
      Array<{ role: string; content: string; createdAt: Date; meta: unknown }>
    >`
      SELECT "role", "content", "createdAt", "meta"
      FROM "chat_history"
      WHERE "conversationId" = ${conversationId} AND "userId" = ${userId}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `
    return rows
      .map((row: { role: string; content: string; createdAt?: Date; meta?: unknown }) => ({
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
        meta: row.meta ?? null,
      }))
      .reverse()
  } catch (error) {
    console.warn('[ChatHistory] failed to query chat_history:', String(error))
    return []
  }
}
