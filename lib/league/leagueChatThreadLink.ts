/**
 * `League.settings.leagueChatThreadId` — the one rule for what a league's chat link may name.
 * Every writer of the key checks it, and the broadcast route's `leaguesOwningThread` ignores a stored
 * link that fails it.
 *
 * 🛑 A LINK TO A THREAD THE LEAGUE DOES NOT OWN IS A WAY INTO SOMEONE ELSE'S CONVERSATION (found
 * 2026-09-25). Every writer took any string, so a commissioner could point their own league at a
 * huddle or DM they happened to be in, and `/api/shared/chat/threads/[threadId]/broadcast` — which
 * finds a thread's league through this link — let them send "commissioner announcements" into it.
 *
 * WHY THE RULE IS "ONLY THE LEAGUE'S OWN ROOM", read from the code rather than assumed:
 *   - A platform thread records no league. `PlatformChatThread` is id, threadType, productType, title
 *     and createdByUserId — no context or metadata column. The `context.leagueId` that
 *     `normalizeThread` returns comes from the newest MESSAGE's metadata, which a sender writes.
 *   - Nothing creates a league's platform thread. `createPlatformThread` (the only
 *     `platformChatThread.create`) takes `dm | group | ai`, no server path writes this key, and the
 *     commissioner UI (CommissionerTab, CommissionerControlsPanel) only reads it.
 *   - Membership cannot stand in for ownership: a DM between the commissioner and one manager holds
 *     nobody but league members, and it is exactly the thread this must refuse.
 *   - The league chat the server DOES create is the room `league:<leagueId>` (LeagueChatMessageService,
 *     LeagueConversation, DraftChatPanel). Its league is its own id, and `/api/commissioner/broadcast`
 *     already sends a `league:` link to that league's chat.
 *
 * So a link is accepted only when it is that league's own room, or when it clears the link. Anything
 * else has no trustworthy owner and is refused rather than guessed at.
 */
import { getLeagueIdFromVirtualRoom } from '@/lib/chat-core/ChatRoomResolver'

export const LEAGUE_CHAT_THREAD_KEY = 'leagueChatThreadId'

export const LEAGUE_CHAT_LINK_REFUSAL = "League chat can only be linked to this league's own chat."

/** True only when `threadId` is provably `leagueId`'s own chat. The read side uses this too. */
export function isLeagueOwnChatThread(leagueId: string, threadId: unknown): boolean {
  if (!leagueId || typeof threadId !== 'string') return false
  return getLeagueIdFromVirtualRoom(threadId) === leagueId
}

/**
 * The write check. `undefined` means the key is not being written; `null` and `''` clear the link.
 * Returns the refusal to send back as a 400, or `null` when the write may go ahead.
 */
export function leagueChatThreadLinkRefusal(leagueId: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return isLeagueOwnChatThread(leagueId, value) ? null : LEAGUE_CHAT_LINK_REFUSAL
}

/**
 * THE READ ACCESSOR — the stored link, only when it passes the check; otherwise null. Every reader
 * goes through this (or through `getLeagueChatThreadId` in
 * lib/commissioner-settings/CommissionerAnnouncementService.ts, which reads the row and calls it),
 * so a link that fails the rule is never used to post, pin or moderate, whatever wrote it.
 */
export function leagueChatThreadIdFromSettings(leagueId: string, settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const value = (settings as Record<string, unknown>)[LEAGUE_CHAT_THREAD_KEY]
  return isLeagueOwnChatThread(leagueId, value) ? (value as string) : null
}

/** The same check for an object that is merged into `League.settings` key by key. */
export function leagueChatThreadLinkRefusalInPatch(leagueId: string, patch: unknown): string | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null
  if (!Object.prototype.hasOwnProperty.call(patch, LEAGUE_CHAT_THREAD_KEY)) return null
  return leagueChatThreadLinkRefusal(leagueId, (patch as Record<string, unknown>)[LEAGUE_CHAT_THREAD_KEY])
}
