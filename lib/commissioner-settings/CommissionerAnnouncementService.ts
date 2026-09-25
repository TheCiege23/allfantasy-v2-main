/**
 * The league's stored chat link (`league.settings.leagueChatThreadId`), read through the one rule in
 * lib/league/leagueChatThreadLink.ts: only the league's own `league:<leagueId>` room comes back, and
 * anything else reads as "no link". Commissioner announcements themselves go through
 * `POST /api/commissioner/broadcast`, which posts into the league's own chat.
 */

import { prisma } from "@/lib/prisma"
import { leagueChatThreadIdFromSettings } from "@/lib/league/leagueChatThreadLink"

export type AnnouncementResult = { ok: true; message?: string } | { ok: false; error: string }

export async function getLeagueChatThreadId(leagueId: string): Promise<string | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  return leagueChatThreadIdFromSettings(leagueId, league?.settings)
}

/** The validated link as a context object. No caller in the app today (census 2026-09-25). */
export async function resolveAnnouncementContext(leagueId: string): Promise<{
  threadId: string | null
  canAnnounce: boolean
}> {
  const threadId = await getLeagueChatThreadId(leagueId)
  return { threadId, canAnnounce: !!threadId }
}
