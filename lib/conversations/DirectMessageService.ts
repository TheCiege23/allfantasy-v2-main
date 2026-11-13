/**
 * DirectMessageService — create or get DM thread, payloads for API.
 */

export const CONVERSATION_TYPE_DIRECT = "dm"

export function getCreateDMPayload(otherUserId: string): { threadType: string; memberUserIds: string[] } {
  return {
    threadType: CONVERSATION_TYPE_DIRECT,
    memberUserIds: [otherUserId],
  }
}

export function getThreadMessagesUrl(threadId: string, limit = 50): string {
  return `/api/shared/chat/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`
}
