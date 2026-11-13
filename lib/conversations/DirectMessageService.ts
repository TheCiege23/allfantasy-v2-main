/**
 * DirectMessageService — create or get DM thread, payloads for API.
 */

export function getThreadMessagesUrl(threadId: string, limit = 50): string {
  return `/api/shared/chat/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`
}
