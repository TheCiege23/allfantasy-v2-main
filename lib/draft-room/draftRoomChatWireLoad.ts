/**
 * Shared draft-room chat wire load — used by GET /draft/chat and live-sync bundle.
 */

import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'
import { prisma } from '@/lib/prisma'
import { sanitizeDraftChatPlayerContext } from '@/lib/draft-room/draft-chat-player-context'
import { buildDraftChatWireMessage } from '@/lib/draft-room/draft-chat-contract'
import type { PlatformChatMessage } from '@/types/platform-shared'
import { parseLeaguePollPayload, type LeaguePollPayload } from '@/lib/league-chat/LeaguePollService'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getBlockedUserIdsForRead } from '@/lib/moderation/BlockUserService'

function normalizedParsePoll(input: {
  body?: string | null
  metadata?: Record<string, unknown> | null
}): LeaguePollPayload | null {
  return parseLeaguePollPayload(input)
}

export function mergeDraftRoomChatStreams(
  leagueMsgs: PlatformChatMessage[],
  pickMsgs: PlatformChatMessage[],
  limit: number,
): PlatformChatMessage[] {
  const map = new Map<string, PlatformChatMessage>()
  for (const row of leagueMsgs) map.set(row.id, row)
  for (const row of pickMsgs) map.set(row.id, row)
  const merged = Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  if (merged.length <= limit) return merged
  return merged.slice(merged.length - limit)
}

export function activeLiveDraftSyncEligible(status: string | null | undefined): boolean {
  return status === 'in_progress'
}

export async function loadDraftChatWireMessages(leagueId: string, userId: string, params: { limit?: number; before?: Date }) {
  const limit = Math.min(Number(params.limit ?? 80), 100)
  const before = params.before

  const [draftSession, uiSettings] = await Promise.all([
    prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } }),
    getDraftUISettingsForLeague(leagueId),
  ])
  const syncOn = Boolean(uiSettings.liveDraftChatSyncEnabled) && activeLiveDraftSyncEligible(draftSession?.status)

  const baseOpts = {
    limit,
    before,
    requestingUserId: userId,
  } as const

  let rows: PlatformChatMessage[]
  if (syncOn) {
    const [leagueMsgs, pickMsgs] = await Promise.all([
      getLeagueChatMessages(leagueId, baseOpts),
      getLeagueChatMessages(leagueId, {
        ...baseOpts,
        limit: Math.min(limit, 80),
        source: 'draft',
        messageTypeIn: ['draft_pick'],
      }),
    ])
    rows = mergeDraftRoomChatStreams(leagueMsgs, pickMsgs, limit)
  } else {
    rows = await getLeagueChatMessages(leagueId, {
      ...baseOpts,
      source: 'draft',
    })
  }

  /*
   * 🛑 BLOCKS WERE NOT APPLIED TO DRAFT CHAT AT ALL (found 2026-09-29). League chat's GET hides
   * the people the viewer has blocked (app/api/league/chat/route.ts, fixed 2026-09-25); the draft
   * room reads the same LeagueChatMessage rows through this loader and showed them. Same lookup,
   * same rule: the viewer's own messages always stay, and author-less rows (pick announcements)
   * are never filtered. `getBlockedUserIdsForRead` THROWS `BlockListUnavailableError` rather than
   * returning [] on a failed read, so no caller can mistake "unknown" for "blocks nobody" — each
   * caller decides what an unfiltered read costs it (the GET answers 503; the live-sync bundle
   * leaves chat out and keeps the draft itself running).
   */
  const blocked = new Set(await getBlockedUserIdsForRead(userId))
  blocked.delete(userId)
  if (blocked.size > 0) rows = rows.filter((m) => !m.senderUserId || !blocked.has(m.senderUserId))

  const messages = rows.map((m) =>
    buildDraftChatWireMessage(m, {
      syncActive: syncOn,
      leagueId,
      sanitizePlayerContext: sanitizeDraftChatPlayerContext,
      parsePollPayload: normalizedParsePoll,
      viewerUserId: userId,
    }),
  )

  return { messages, syncActive: syncOn }
}
