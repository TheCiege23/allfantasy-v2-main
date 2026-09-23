import 'server-only'

import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'
import { pickLeagueChatPreview, type LeagueChatPreview } from './leagueChatPreviewPick'

export type { LeagueChatPreview } from './leagueChatPreviewPick'

/**
 * The newest line of one league's chat, for the league-first chat bar.
 *
 * ⚠ READS THE TABLE, NOT `/api/league/chat`. That GET marks the caller as viewing the chat
 * (presence) and syncs trade cards, so a bar that previewed through it would announce the user
 * in every league they merely opened. The caller has already authorised the league — this is
 * only ever called with the page's validated `selectedLeagueRow`.
 *
 * `requestingUserId` keeps a private @chimmy reply visible to its owner and to no one else.
 * Never throws: a bar with no preview still opens the chat.
 */
export async function readLeagueChatPreview(leagueId: string, userId: string): Promise<LeagueChatPreview | null> {
  try {
    const messages = await getLeagueChatMessages(leagueId, { limit: 6, requestingUserId: userId })
    return pickLeagueChatPreview(messages)
  } catch {
    return null
  }
}
