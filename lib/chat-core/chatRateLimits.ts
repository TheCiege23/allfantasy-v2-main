import { NextResponse } from 'next/server'
import { consumeRateLimit } from '@/lib/rate-limit'

/**
 * Per-user ceilings on the chat writes that had none.
 *
 * 🛑 STARTING A DM, CREATING A HUDDLE AND SENDING A MESSAGE WERE UNLIMITED. `dm/start` reaches any
 * account by exact username (no shared league needed), so one account could open a conversation with
 * every username it could guess and fill each with messages; the per-recipient alert throttle kept
 * phones quiet but the rows, the email-once-an-hour, and the inbox were all the sender's to fill.
 * `useChatPolling` even said these endpoints were "rate-limited per user". They were not.
 *
 * The numbers sit well above a person typing: a fast back-and-forth is a message every few seconds,
 * not forty a minute, and nobody starts fifteen new DMs in ten minutes by hand.
 *
 * In-process, like every other `consumeRateLimit` caller: a ceiling per instance, not a global
 * guarantee. That is the right weight for a spam brake; it is not an accounting system.
 */
export const CHAT_RATE_LIMITS = {
  dm_start: { maxRequests: 15, windowMs: 10 * 60 * 1000 },
  thread_create: { maxRequests: 10, windowMs: 10 * 60 * 1000 },
  message_send: { maxRequests: 40, windowMs: 60 * 1000 },
} as const

export type ChatRateLimitedAction = keyof typeof CHAT_RATE_LIMITS

const MESSAGES: Record<ChatRateLimitedAction, string> = {
  dm_start: "You're starting conversations too quickly. Try again in a few minutes.",
  thread_create: "You're creating huddles too quickly. Try again in a few minutes.",
  message_send: "You're sending messages too quickly. Wait a moment and try again.",
}

/** A 429 response when this user is over the ceiling for `action`, otherwise null. */
export function chatRateLimitResponse(userId: string, action: ChatRateLimitedAction): NextResponse | null {
  const limit = CHAT_RATE_LIMITS[action]
  const rl = consumeRateLimit({
    scope: 'chat',
    action,
    sleeperUsername: userId,
    maxRequests: limit.maxRequests,
    windowMs: limit.windowMs,
  })
  if (rl.success) return null
  const retryAfterSec = Math.max(1, rl.retryAfterSec)
  return NextResponse.json(
    { error: MESSAGES[action], retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  )
}
