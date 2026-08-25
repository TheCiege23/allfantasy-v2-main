import { parseAtMentions } from '@/lib/chat-core/mentionPrivacyFilter'

/**
 * Tell `/api/shared/chat/mentions` who a just-posted message was aimed at.
 *
 * ⚠ `@all` NOTIFIED NOBODY. The endpoint has always implemented it — for league
 * rooms it resolves every league member, for a DM or huddle every thread member
 * — but it decides by looking for the literal token `all` inside
 * `mentionedUsernames`. `parseAtMentions` deliberately STRIPS `all` (and
 * `global`, and `chimmy`) out of `userMentions` and reports it separately as
 * `hasAll`, and the one caller passed `userMentions` and skipped the request
 * entirely when that array was empty. So "@all heads up, draft moved" parsed
 * correctly, sent nothing, and reached no one.
 *
 * This re-adds the token the endpoint is looking for, which is why the helper
 * exists rather than each caller assembling the body itself — that assembly is
 * exactly where the bug lived.
 *
 * ⚠ FIRE AND FORGET, NEVER FATAL. The message is already posted by the time this
 * runs. A failed notification must not surface as "message not sent" or roll
 * anything back; at worst somebody misses a ping.
 */
export async function notifyMentions(args: {
  /** `league:{leagueId}` for a league room, or a platform thread id. */
  threadId: string
  /** The id the server returned for the message that was just posted. */
  messageId: string
  text: string
}): Promise<void> {
  const { threadId, messageId, text } = args
  if (!threadId || !messageId || !text.trim()) return

  const parsed = parseAtMentions(text)
  const mentionedUsernames = [...parsed.userMentions]
  if (parsed.hasAll) mentionedUsernames.push('all')

  // `@chimmy` and `@global` are handled by their own paths, not by notifications.
  if (mentionedUsernames.length === 0) return

  try {
    await fetch('/api/shared/chat/mentions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, messageId, mentionedUsernames }),
    })
  } catch {
    // Deliberately silent — see the note above.
  }
}

/** The `threadId` shape the endpoint expects for a league's chat room. */
export function leagueMentionRoomId(leagueId: string): string {
  return `league:${leagueId}`
}
