import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

/**
 * WHERE EACH PERSON LAST READ EACH LEAGUE'S CHAT — so the chat bubble can count league messages
 * (owner's call 2026-09-25, "fix the chat bubble count issues"). League chat had no read state at
 * all: the launcher counted DMs and huddles only, and a busy league chat never moved the badge.
 *
 * Stored as one SportsDataCache row per person per league (`league-chat-read:v1:<userId>:<leagueId>`)
 * — no schema change. Written when the league chat is actually opened, never by a background poll.
 */

const READ_TTL_MS = 400 * 24 * 60 * 60 * 1000

export function leagueChatReadKey(userId: string, leagueId: string): string {
  return `league-chat-read:v1:${userId}:${leagueId}`
}

/** Mark this league's chat read up to `at`. Never moves the marker backwards. Never throws. */
export async function markLeagueChatRead(userId: string, leagueId: string, at: Date = new Date()): Promise<void> {
  if (!userId || !leagueId) return
  const cacheKey = leagueChatReadKey(userId, leagueId)
  try {
    const existing = await prisma.sportsDataCache.findUnique({ where: { cacheKey }, select: { data: true } })
    const prev = readAt(existing?.data)
    if (prev && prev.getTime() >= at.getTime()) return
    const data = { readAt: at.toISOString() } as Prisma.InputJsonValue
    const expiresAt = new Date(at.getTime() + READ_TTL_MS)
    await prisma.sportsDataCache.upsert({
      where: { cacheKey },
      create: { cacheKey, data, expiresAt },
      update: { data, expiresAt },
    })
  } catch {
    // A badge marker is not worth failing the chat for.
  }
}

/** When this person last read each of these leagues' chats; a league never opened is absent. */
export async function getLeagueChatReadMarks(userId: string, leagueIds: readonly string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  if (!userId || leagueIds.length === 0) return out
  const keys = leagueIds.map((id) => leagueChatReadKey(userId, id))
  const rows = await prisma.sportsDataCache.findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } })
  const prefix = `league-chat-read:v1:${userId}:`
  for (const r of rows) {
    const at = readAt(r.data)
    if (at && r.cacheKey.startsWith(prefix)) out.set(r.cacheKey.slice(prefix.length), at)
  }
  return out
}

function readAt(data: unknown): Date | null {
  const raw = (data as { readAt?: unknown } | null | undefined)?.readAt
  const d = typeof raw === 'string' ? new Date(raw) : null
  return d && Number.isFinite(d.getTime()) ? d : null
}
