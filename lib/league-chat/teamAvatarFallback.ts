import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * A face for everyone in league chat (2026-11-05, chat redesign: "nearly every avatar is initials").
 *
 * A sender's own AllFantasy photo always wins. With none, their TEAM's avatar in this league — the one
 * imported from Sleeper/ESPN — stands in, since that is the face the rest of the league already knows
 * them by. One indexed read (`claimedByUserId`), made only for senders with no photo, and best-effort:
 * a failure here costs initials, never the chat.
 */
export async function teamAvatarFallback(
  leagueId: string,
  messages: ReadonlyArray<{ senderUserId?: string | null; senderAvatarUrl?: string | null }>,
): Promise<Map<string, string>> {
  const missing = Array.from(
    new Set(messages.filter((m) => !m.senderAvatarUrl && m.senderUserId).map((m) => m.senderUserId as string)),
  )
  if (missing.length === 0) return new Map()
  try {
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId, claimedByUserId: { in: missing }, avatarUrl: { not: null } },
      select: { claimedByUserId: true, avatarUrl: true },
    })
    const out = new Map<string, string>()
    for (const t of teams) if (t.claimedByUserId && t.avatarUrl) out.set(t.claimedByUserId, t.avatarUrl)
    return out
  } catch {
    return new Map()
  }
}
