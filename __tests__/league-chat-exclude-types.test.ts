import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueChatMessage: { findMany } } }))

import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'

/*
 * League chat folds the draft room's conversation in while a draft is live, but not its
 * pick-by-pick feed: forty picks would push every human message out of a forty-row window.
 */

const where = () => findMany.mock.calls[0][0].where as Record<string, unknown>

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([])
})

describe('excludeMessageTypes', () => {
  it('leaves the named types out', async () => {
    await getLeagueChatMessages('l1', { limit: 40, includeDraftRoom: true, excludeMessageTypes: ['draft_pick'] })
    expect(where().type).toEqual({ notIn: ['draft_pick'] })
  })

  it('does nothing unless asked', async () => {
    await getLeagueChatMessages('l1', { limit: 40, includeDraftRoom: true })
    expect(where().type).toBeUndefined()
  })

  it('never widens an explicit type list — messageTypeIn wins', async () => {
    await getLeagueChatMessages('l1', { limit: 40, messageTypeIn: ['draft_pick'], excludeMessageTypes: ['draft_pick'] })
    expect(where().type).toEqual({ in: ['draft_pick'] })
  })
})
