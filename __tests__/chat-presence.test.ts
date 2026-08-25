import { beforeEach, describe, expect, it, vi } from 'vitest'

/* `vi.mock` is hoisted above every const, so the spies have to be too. */
const { findUnique, findMany, upsert } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findUnique, findMany, upsert } },
}))

import {
  markViewingChat,
  readChatPresence,
  PRESENCE_BEACON_MIN_INTERVAL_MS,
} from '@/lib/chat-core/chatPresence'

const SCOPE = { kind: 'league' as const, id: 'lg-1' }
const PREFIX = 'chat:presence:league:lg-1:'

function row(userId: string, agoMs: number, name = 'Casey') {
  return {
    cacheKey: `${PREFIX}${userId}`,
    data: { name, at: new Date(Date.now() - agoMs).toISOString() },
  }
}

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(null)
  findMany.mockReset().mockResolvedValue([])
  upsert.mockReset().mockResolvedValue({})
})

describe('markViewingChat', () => {
  it('writes a beacon the first time a viewer is seen', async () => {
    const wrote = await markViewingChat(SCOPE, { userId: 'u1', resolveName: async () => 'Casey' })

    expect(wrote).toBe(true)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0].where.cacheKey).toBe(`${PREFIX}u1`)
  })

  /*
   * Chat polls every 4–8s. Without a floor, ten people in a room would each
   * write a row every few seconds all day to say nothing new.
   */
  it('skips a beacon that arrives inside the throttle window', async () => {
    findUnique.mockResolvedValue({ data: { name: 'Casey', at: new Date().toISOString() } })

    const wrote = await markViewingChat(SCOPE, { userId: 'u1', resolveName: async () => 'Casey' })

    expect(wrote).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('writes again once the throttle window has passed', async () => {
    findUnique.mockResolvedValue({
      data: { name: 'Casey', at: new Date(Date.now() - PRESENCE_BEACON_MIN_INTERVAL_MS - 1000).toISOString() },
    })

    expect(await markViewingChat(SCOPE, { userId: 'u1', resolveName: async () => 'Casey' })).toBe(true)
  })

  /* Most beacons are throttled away; resolving a name on each would be a
   * lookup per poll per reader to write nothing. */
  it('does not resolve a display name for a throttled beacon', async () => {
    findUnique.mockResolvedValue({ data: { name: 'Casey', at: new Date().toISOString() } })
    const resolveName = vi.fn().mockResolvedValue('Casey')

    await markViewingChat(SCOPE, { userId: 'u1', resolveName })

    expect(resolveName).not.toHaveBeenCalled()
  })

  it('still records the viewer when the name cannot be resolved', async () => {
    await markViewingChat(SCOPE, { userId: 'u1', resolveName: async () => null })

    expect(upsert.mock.calls[0][0].create.data).toMatchObject({ name: 'Someone' })
  })

  it('ignores a call with no league or no user', async () => {
    expect(await markViewingChat({ kind: 'league', id: '' }, { userId: 'u1', resolveName: async () => 'x' })).toBe(false)
    expect(await markViewingChat(SCOPE, { userId: '', resolveName: async () => 'x' })).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })

  /* A chat that failed to load because presence failed would be worse than a
   * chat with no presence strip. */
  it('never throws when the store is unavailable', async () => {
    findUnique.mockRejectedValue(new Error('db down'))
    upsert.mockRejectedValue(new Error('db down'))

    await expect(
      markViewingChat(SCOPE, { userId: 'u1', resolveName: async () => 'Casey' }),
    ).resolves.toBe(true)
  })
})

describe('readChatPresence', () => {
  it('reports a recent viewer as online', async () => {
    findMany.mockResolvedValue([row('u1', 10_000)])

    const out = await readChatPresence(SCOPE)

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ userId: 'u1', name: 'Casey', status: 'online' })
  })

  it('grades a viewer away after a minute', async () => {
    findMany.mockResolvedValue([row('u1', 120_000)])
    expect((await readChatPresence(SCOPE))[0].status).toBe('away')
  })

  /* Stale rows outlive the presence window so a returning viewer keeps their
   * identity — they must not be shown as though they were still here. */
  it('drops a viewer who has been gone longer than the window', async () => {
    findMany.mockResolvedValue([row('u1', 10 * 60_000)])
    expect(await readChatPresence(SCOPE)).toEqual([])
  })

  it('recovers the user id from the key rather than trusting the payload', async () => {
    findMany.mockResolvedValue([row('user-with-dashes-42', 5_000)])
    expect((await readChatPresence(SCOPE))[0].userId).toBe('user-with-dashes-42')
  })

  it('orders the most recently seen first', async () => {
    findMany.mockResolvedValue([row('older', 90_000), row('newer', 5_000)])
    expect((await readChatPresence(SCOPE)).map((v) => v.userId)).toEqual(['newer', 'older'])
  })

  it('skips a row whose timestamp is unusable instead of guessing', async () => {
    findMany.mockResolvedValue([
      { cacheKey: `${PREFIX}u1`, data: { name: 'Casey', at: 'not a date' } },
      { cacheKey: `${PREFIX}u2`, data: null },
      row('u3', 5_000),
    ])

    expect((await readChatPresence(SCOPE)).map((v) => v.userId)).toEqual(['u3'])
  })

  it('returns nobody rather than failing the chat when the store is down', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    expect(await readChatPresence(SCOPE)).toEqual([])
  })

  it('scopes the scan to this league', async () => {
    await readChatPresence(SCOPE)
    expect(findMany.mock.calls[0][0].where.cacheKey.startsWith).toBe(PREFIX)
  })
})
