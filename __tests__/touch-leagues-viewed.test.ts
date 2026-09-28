import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The finder's queue bump: leagues where a flagged starter can still be moved are marked viewed
 * in ONE write, capped, so the five-minute lane refreshes them first without parking every other
 * user's leagues behind a 65-league account.
 */

const mockUpdateMany = vi.hoisted(() => vi.fn(async () => ({ count: 0 })))
const speculative = vi.hoisted(() => ({ value: false }))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/http/speculativeRequest', () => ({ isSpeculativeRequestHeaders: () => speculative.value }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { updateMany: mockUpdateMany } } }))

import { __clearLeagueViewedThrottle, touchLeaguesViewed } from '@/lib/leagues/touchLeagueViewed'

beforeEach(() => {
  vi.clearAllMocks()
  __clearLeagueViewedThrottle()
  speculative.value = false
})

describe('touchLeaguesViewed', () => {
  it('writes once, for at most ten distinct leagues', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `L${i}`)
    await touchLeaguesViewed([...ids, 'L0', 'L1'])
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    const arg = mockUpdateMany.mock.calls[0][0] as { where: { id: { in: string[] } } }
    expect(arg.where.id.in).toHaveLength(10)
    expect(new Set(arg.where.id.in).size).toBe(10)
  })

  it('throttles a league it just recorded', async () => {
    await touchLeaguesViewed(['A', 'B'])
    await touchLeaguesViewed(['A', 'B'])
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('records nothing on a prefetch', async () => {
    speculative.value = true
    await touchLeaguesViewed(['A'])
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('never throws into the page', async () => {
    mockUpdateMany.mockRejectedValueOnce(new Error('db down'))
    await expect(touchLeaguesViewed(['A'])).resolves.toBeUndefined()
  })
})
