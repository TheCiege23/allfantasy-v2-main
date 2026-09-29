/**
 * Virtual report rooms for chats that are not platform threads or league rooms.
 *
 * A report points at a message by (messageId, threadId). DMs and huddles use their platform
 * thread id, league and bracket chat use "league:<leagueId>" (lib/chat-core/ChatRoomResolver).
 * Two more chats keep their messages in tables of their own, so they get a room shape here:
 *
 *   "draftroom:<sessionKey>"  → DraftRoomChatMessage   (the app/draft shell's chat; the session
 *                                key is itself "mock:<id>" or "live:<leagueId>")
 *   "mockdraft:<draftId>"     → MockDraftChat          (the mock draft simulator's chat)
 *   "worldcup:<challengeId>"  → WorldCupBracketChatEvent (a World Cup bracket pool's chat)
 *
 * Client-safe: the chat panels build the same ids the server resolves.
 */

export const DRAFT_ROOM_REPORT_PREFIX = "draftroom:"
export const MOCK_DRAFT_REPORT_PREFIX = "mockdraft:"

export function draftRoomReportThreadId(sessionKey: string): string {
  return `${DRAFT_ROOM_REPORT_PREFIX}${sessionKey}`
}

export function mockDraftReportThreadId(draftId: string): string {
  return `${MOCK_DRAFT_REPORT_PREFIX}${draftId}`
}

/** The session key of a "draftroom:" room, or null for any other room. */
export function sessionKeyFromDraftRoomThread(threadId: string): string | null {
  if (!threadId.startsWith(DRAFT_ROOM_REPORT_PREFIX)) return null
  const key = threadId.slice(DRAFT_ROOM_REPORT_PREFIX.length).trim()
  return key || null
}

/** The mock draft id of a "mockdraft:" room, or null for any other room. */
export function draftIdFromMockDraftThread(threadId: string): string | null {
  if (!threadId.startsWith(MOCK_DRAFT_REPORT_PREFIX)) return null
  const id = threadId.slice(MOCK_DRAFT_REPORT_PREFIX.length).trim()
  return id || null
}

export const WORLD_CUP_REPORT_PREFIX = "worldcup:"

export function worldCupReportThreadId(challengeId: string): string {
  return `${WORLD_CUP_REPORT_PREFIX}${challengeId}`
}

/** The challenge id of a "worldcup:" room, or null for any other room. */
export function challengeIdFromWorldCupThread(threadId: string): string | null {
  if (!threadId.startsWith(WORLD_CUP_REPORT_PREFIX)) return null
  const id = threadId.slice(WORLD_CUP_REPORT_PREFIX.length).trim()
  return id || null
}

/**
 * World Cup pool rows with no human author to report or block: Chimmy's answers, and system /
 * event lines. The UI offers neither action on them and the server refuses a report on them.
 */
export const WORLD_CUP_UNREPORTABLE_TYPES: ReadonlySet<string> = new Set([
  "chimmy_private_response",
  "system",
  "event",
])
