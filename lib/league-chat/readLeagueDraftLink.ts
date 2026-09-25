import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { LIVE_DRAFT_STATUSES, draftRoomHref, type LeagueDraftLink } from './draftChatLink'

/**
 * The league's current draft, as league chat needs it: is it live, and where is the room.
 *
 * One indexed read, folded into the chat poll that already runs rather than given a route
 * of its own. ⚠ NEVER THROWS: a chat that failed to load because the draft lookup failed
 * would be a worse product than a chat without the draft banner.
 */
export async function readLeagueDraftLink(leagueId: string): Promise<LeagueDraftLink | null> {
  try {
    const row = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { status: true },
    })
    if (!row || typeof row.status !== 'string') return null
    return { live: LIVE_DRAFT_STATUSES.has(row.status), status: row.status, href: draftRoomHref(leagueId) }
  } catch {
    return null
  }
}
