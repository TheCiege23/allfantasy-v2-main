// @vitest-environment node
/**
 * 🛑 Starting a DM, creating a huddle and sending a message had no ceiling at all, and `dm/start`
 * reaches any account by username. These pin the ceiling and its 429 shape.
 */
import { describe, expect, it } from 'vitest'

import { CHAT_RATE_LIMITS, chatRateLimitResponse } from '@/lib/chat-core/chatRateLimits'

describe('chatRateLimitResponse', () => {
  it('lets a person through up to the ceiling, then answers 429 with Retry-After', async () => {
    const user = `u-${Math.random().toString(36).slice(2)}`
    const { maxRequests } = CHAT_RATE_LIMITS.dm_start
    for (let i = 0; i < maxRequests; i++) expect(chatRateLimitResponse(user, 'dm_start')).toBeNull()
    const res = chatRateLimitResponse(user, 'dm_start')
    expect(res?.status).toBe(429)
    expect(Number(res?.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(((await res!.json()) as { error: string }).error).toMatch(/too quickly/)
  })

  it('each action has its own bucket, and one person never spends another’s', () => {
    const a = `a-${Math.random().toString(36).slice(2)}`
    const b = `b-${Math.random().toString(36).slice(2)}`
    for (let i = 0; i < CHAT_RATE_LIMITS.thread_create.maxRequests; i++) chatRateLimitResponse(a, 'thread_create')
    expect(chatRateLimitResponse(a, 'thread_create')?.status).toBe(429)
    expect(chatRateLimitResponse(a, 'message_send')).toBeNull()
    expect(chatRateLimitResponse(b, 'thread_create')).toBeNull()
  })

  it('a fast typist is nowhere near the send ceiling', () => {
    expect(CHAT_RATE_LIMITS.message_send.maxRequests).toBeGreaterThanOrEqual(30)
    expect(CHAT_RATE_LIMITS.message_send.windowMs).toBeLessThanOrEqual(60_000)
  })
})
