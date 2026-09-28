/**
 * Server-only: fetch bracket league messages and map to platform message shape.
 * Used by shared chat API when threadId is "league:leagueId".
 */

import type { PlatformChatMessage } from "@/types/platform-shared"

interface BracketMessageRow {
  id: string
  message: string
  type?: string
  imageUrl?: string | null
  replyToId?: string | null
  createdAt: Date | string
  metadata?: Record<string, unknown> | null
  reactions?: Array<{ emoji?: string | null; userId?: string | null; user?: { id?: string | null } | null }>
  user?: {
    id: string
    username?: string | null
    displayName?: string | null
    avatarUrl?: string | null
    profile?: { avatarPreset?: string | null } | null
  }
}

function toReactionMetadata(
  reactions: BracketMessageRow["reactions"]
): Array<{ emoji: string; count: number; userIds: string[] }> {
  if (!Array.isArray(reactions) || reactions.length === 0) return []
  const byEmoji = new Map<string, { emoji: string; count: number; userIds: string[] }>()
  for (const reaction of reactions) {
    const emoji = typeof reaction?.emoji === "string" ? reaction.emoji.trim() : ""
    if (!emoji) continue
    const existing = byEmoji.get(emoji) ?? { emoji, count: 0, userIds: [] }
    existing.count += 1
    const userId = reaction?.userId ?? reaction?.user?.id ?? null
    if (userId && !existing.userIds.includes(userId)) {
      existing.userIds.push(userId)
    }
    byEmoji.set(emoji, existing)
  }
  return Array.from(byEmoji.values())
}

export function bracketMessagesToPlatform(
  rows: BracketMessageRow[],
  threadId: string
): PlatformChatMessage[] {
  return rows.map((m) => {
    const reactionEntries = toReactionMetadata(m.reactions)
    const baseMetadata =
      m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata)
        ? m.metadata
        : undefined
    const metadata = {
      ...(baseMetadata ?? {}),
      ...(m.imageUrl ? { imageUrl: m.imageUrl } : {}),
      ...(reactionEntries.length > 0 ? { reactions: reactionEntries } : {}),
    }
    const normalizedMetadata = Object.keys(metadata).length > 0 ? metadata : undefined
    const isDeleted = Boolean((normalizedMetadata as Record<string, unknown> | undefined)?.deletedAt)
    return {
      id: m.id,
      threadId,
      parentMessageId: m.replyToId ?? null,
      senderUserId: m.user?.id ?? null,
      senderName: m.user?.displayName || m.user?.username || "Manager",
      senderUsername: m.user?.username ?? null,
      senderAvatarUrl: m.user?.avatarUrl ?? null,
      senderAvatarPreset: m.user?.profile?.avatarPreset ?? null,
      messageType: m.type || "text",
      body: isDeleted ? "[message deleted]" : m.message || "",
      createdAt: typeof m.createdAt === "string" ? m.createdAt : new Date(m.createdAt).toISOString(),
      metadata: normalizedMetadata,
    }
  })
}
