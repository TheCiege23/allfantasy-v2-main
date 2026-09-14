import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dispatch: vi.fn(), recent: vi.fn() }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/prisma', () => ({ prisma: { platformNotification: { findMany: h.recent } } }))

import { ingest } from '@/lib/notification-engine'

beforeEach(() => {
  vi.clearAllMocks()
  h.recent.mockResolvedValue([])
  h.dispatch.mockResolvedValue(undefined)
})

describe('live scoring notification identity', () => {
  it('deduplicates a retry by provider play id while preserving the next play by the same player', async () => {
    const base = {
      type: 'live_score_swing' as const,
      title: '20-yard touchdown',
      userIds: ['user-1'],
      meta: { playerId: '101', playerName: 'Bijan Robinson' },
    }
    await ingest({ ...base, meta: { ...base.meta, idempotencyKey: 'pbp:g1:42:TOUCHDOWN' } })
    await ingest({ ...base, meta: { ...base.meta, idempotencyKey: 'pbp:g1:57:TOUCHDOWN' } })

    expect(h.dispatch.mock.calls[0][0].dedupePrefix).toBe('live_score_swing:pbp:g1:42:TOUCHDOWN')
    expect(h.dispatch.mock.calls[1][0].dedupePrefix).toBe('live_score_swing:pbp:g1:57:TOUCHDOWN')
    expect(h.dispatch.mock.calls[0][0].dedupePrefix).not.toBe(h.dispatch.mock.calls[1][0].dedupePrefix)
  })
})
