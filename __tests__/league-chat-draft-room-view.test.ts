import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueChatMessage: { findMany } } }))

import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'

/** The `where` the service actually sent to Prisma. */
function where() {
  return findMany.mock.calls[0][0].where as Record<string, unknown>
}

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([])
})

describe('draft room messages in the league transcript', () => {
  /*
   * `/api/draft/chat/send` mirrors every live draft-room message into league
   * chat with `source: 'draft'`, and the default excludes exactly that source —
   * so the link between the two chats has been writing rows into a filter.
   */
  it('excludes the draft room by default, as it always has', async () => {
    await getLeagueChatMessages('l1', { limit: 10 })

    expect(where().NOT).toEqual([{ source: 'draft' }, { source: { startsWith: 'tribe_' } }])
  })

  it('folds the draft room in when asked', async () => {
    await getLeagueChatMessages('l1', { limit: 10, includeDraftRoom: true })

    expect(where().NOT).toEqual([{ source: { startsWith: 'tribe_' } }])
  })

  /*
   * Tribe sources are another product's private channels, not a view
   * preference, and must stay excluded either way.
   */
  it('never folds in tribe channels', async () => {
    await getLeagueChatMessages('l1', { limit: 10, includeDraftRoom: true })

    expect(JSON.stringify(where().NOT)).toContain('tribe_')
  })

  /*
   * `source` is an EXCLUSIVE filter: asking for 'draft' returns the draft
   * messages INSTEAD OF the league's. The new option must not disturb it.
   */
  it('leaves an explicit source filter alone', async () => {
    await getLeagueChatMessages('l1', { limit: 10, source: 'draft', includeDraftRoom: true })

    expect(where().source).toBe('draft')
    expect(where().NOT).toBeUndefined()
  })

  it('still honours an explicit request for league-only rows', async () => {
    await getLeagueChatMessages('l1', { limit: 10, source: null })

    expect(where().source).toBeNull()
    expect(where().NOT).toBeUndefined()
  })

  it('keeps the private-message rule regardless of the view', async () => {
    await getLeagueChatMessages('l1', { limit: 10, includeDraftRoom: true, requestingUserId: 'u1' })

    expect(where().OR).toEqual([{ isPrivate: false }, { isPrivate: true, visibleToUserId: 'u1' }])
  })
})
