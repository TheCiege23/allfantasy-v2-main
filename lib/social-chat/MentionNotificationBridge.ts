/**
 * MentionNotificationBridge — call mentions API after sending a message so mentioned users get notified.
 */

const MENTIONS_ENDPOINT = "/api/shared/chat/mentions"

function getMentionsPayload(threadId: string, messageId: string, mentionedUsernames: string[]): {
  threadId: string
  messageId: string
  mentionedUsernames: string[]
} {
  const normalized = mentionedUsernames
    .map((value) => String(value).trim().replace(/^@+/, ""))
    .filter(Boolean)
  return {
    threadId,
    messageId,
    mentionedUsernames: Array.from(new Set(normalized)),
  }
}

export async function notifyMentions(
  threadId: string,
  messageId: string,
  mentionedUsernames: string[]
): Promise<{ notified: number }> {
  if (mentionedUsernames.length === 0) return { notified: 0 }
  const res = await fetch(MENTIONS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(getMentionsPayload(threadId, messageId, mentionedUsernames)),
  })
  const data = await res.json().catch(() => ({}))
  return { notified: data?.notified ?? 0 }
}
