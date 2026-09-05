import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueChatMessage: { findMany } } }))

import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'

/** The `where` the service actually sent to Prisma. */
function where() {
  return findMany.mock.calls[0][0].where as Record<string, unknown>
}

/** The source view predicate, which lives under `AND` so it can spell out NULL. */
function sourceFilter() {
  return where().AND as Array<{ OR: unknown[] }> | undefined
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

    expect(sourceFilter()).toEqual([
      { OR: [{ source: null }, { NOT: [{ source: 'draft' }, { source: { startsWith: 'tribe_' } }] }] },
    ])
  })

  it('folds the draft room in when asked', async () => {
    await getLeagueChatMessages('l1', { limit: 10, includeDraftRoom: true })

    expect(sourceFilter()).toEqual([
      { OR: [{ source: null }, { NOT: [{ source: { startsWith: 'tribe_' } }] }] },
    ])
  })

  /*
   * Tribe sources are another product's private channels, not a view
   * preference, and must stay excluded either way.
   */
  it('never folds in tribe channels', async () => {
    await getLeagueChatMessages('l1', { limit: 10, includeDraftRoom: true })

    expect(JSON.stringify(sourceFilter())).toContain('tribe_')
  })

  /*
   * 🛑 THE REGRESSION THIS PINS: a bare `NOT` returned an EMPTY transcript for
   * every league. Prisma renders `NOT: [{ source: 'draft' }]` as
   * `NOT "source" = 'draft'`, which is UNKNOWN — not TRUE — when `source` is
   * NULL, and NULL is what an ordinary league message carries. So the exclusive
   * filter dropped the rows it exists to keep while POST kept storing them:
   * write-only chat, 200 on every send, nothing red anywhere.
   *
   * ⚠ AND A SHAPE ASSERTION IS THE WEAK FORM OF THIS TEST. The suite above went
   * green against the broken filter for the same reason it could not have caught
   * it: `findMany` is mocked, so no SQL runs and three-valued logic is invisible
   * here. This case pins the NULL branch so a refactor back to a bare `NOT` goes
   * red; only an executed query proves the semantics.
   */
  it('keeps rows whose source is NULL — ordinary league messages — in both views', async () => {
    for (const includeDraftRoom of [false, true]) {
      findMany.mockClear()
      await getLeagueChatMessages('l1', { limit: 10, includeDraftRoom })

      const branches = sourceFilter()?.[0]?.OR
      expect(branches, `includeDraftRoom=${includeDraftRoom}`).toContainEqual({ source: null })
    }
  })

  /*
   * `source` is an EXCLUSIVE filter: asking for 'draft' returns the draft
   * messages INSTEAD OF the league's. The new option must not disturb it.
   */
  it('leaves an explicit source filter alone', async () => {
    await getLeagueChatMessages('l1', { limit: 10, source: 'draft', includeDraftRoom: true })

    expect(where().source).toBe('draft')
    expect(where().AND).toBeUndefined()
  })

  it('still honours an explicit request for league-only rows', async () => {
    await getLeagueChatMessages('l1', { limit: 10, source: null })

    expect(where().source).toBeNull()
    expect(where().AND).toBeUndefined()
  })

  it('keeps the private-message rule regardless of the view', async () => {
    await getLeagueChatMessages('l1', { limit: 10, includeDraftRoom: true, requestingUserId: 'u1' })

    expect(where().OR).toEqual([{ isPrivate: false }, { isPrivate: true, visibleToUserId: 'u1' }])
  })
})
