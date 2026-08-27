import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  findMany: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { upsert: h.upsert, findMany: h.findMany, delete: h.del } },
}))

import {
  clearTyping,
  markTyping,
  readTyping,
  TYPING_WINDOW_MS,
} from '@/lib/chat-core/durableTyping'

const PREFIX = 'chat:typing:t1:'

function row(userId: string, agoMs: number, name = 'Casey') {
  return {
    cacheKey: `${PREFIX}${userId}`,
    data: { name, at: new Date(Date.now() - agoMs).toISOString() },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.upsert.mockResolvedValue({})
  h.findMany.mockResolvedValue([])
  h.del.mockResolvedValue({})
})

describe('durable typing', () => {
  /*
   * The point of the whole module: the old store was module-level Maps, which on
   * serverless means you type on one instance and the watcher on another sees
   * nothing.
   */
  it('records typing in a store both servers can read', async () => {
    await markTyping('t1', { userId: 'u1', name: 'Casey' })

    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(h.upsert.mock.calls[0][0].where.cacheKey).toBe(`${PREFIX}u1`)
  })

  it('expires the row on its own, because nobody sends "I stopped"', async () => {
    await markTyping('t1', { userId: 'u1', name: 'Casey' })

    const expires = h.upsert.mock.calls[0][0].update.expiresAt as Date
    expect(expires.getTime()).toBeGreaterThan(Date.now())
    expect(expires.getTime()).toBeLessThanOrEqual(Date.now() + TYPING_WINDOW_MS + 50)
  })

  /* Waiting out the TTL would show the sender still typing after they sent. */
  it('clears immediately when someone actually sends', async () => {
    await clearTyping('t1', 'u1')
    expect(h.del).toHaveBeenCalledWith({ where: { cacheKey: `${PREFIX}u1` } })
  })

  it('reports somebody who is typing', async () => {
    h.findMany.mockResolvedValue([row('u2', 1000)])

    expect(await readTyping('t1', 'u1')).toEqual([{ userId: 'u2', name: 'Casey' }])
  })

  /* You know you are typing. */
  it('never reports the viewer back to themselves', async () => {
    h.findMany.mockResolvedValue([row('u1', 1000)])

    expect(await readTyping('t1', 'u1')).toEqual([])
  })

  /*
   * Expiry is cleanup, not a guarantee — a row that outlived its window must not
   * leave somebody stuck mid-sentence forever.
   */
  it('ignores a row older than the window even if it still exists', async () => {
    h.findMany.mockResolvedValue([row('u2', TYPING_WINDOW_MS + 5000)])

    expect(await readTyping('t1', 'u1')).toEqual([])
  })

  it('scopes the scan to this thread', async () => {
    await readTyping('t1', 'u1')
    expect(h.findMany.mock.calls[0][0].where.cacheKey.startsWith).toBe(PREFIX)
  })

  it('skips a row with an unusable timestamp', async () => {
    h.findMany.mockResolvedValue([
      { cacheKey: `${PREFIX}u2`, data: { name: 'X', at: 'not a date' } },
      { cacheKey: `${PREFIX}u3`, data: null },
      row('u4', 500),
    ])

    expect((await readTyping('t1', 'u1')).map((p) => p.userId)).toEqual(['u4'])
  })

  it('never throws when the store is unavailable', async () => {
    h.findMany.mockRejectedValue(new Error('db down'))
    h.upsert.mockRejectedValue(new Error('db down'))

    expect(await readTyping('t1', 'u1')).toEqual([])
    await expect(markTyping('t1', { userId: 'u1', name: 'Casey' })).resolves.toBeUndefined()
  })

  it('ignores an empty thread or user', async () => {
    await markTyping('', { userId: 'u1', name: 'x' })
    expect(h.upsert).not.toHaveBeenCalled()
    expect(await readTyping('', 'u1')).toEqual([])
  })
})
