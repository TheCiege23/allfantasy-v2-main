import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The chat bubble counts everything waiting for you (owner's call 2026-09-25, "fix the chat bubble
 * count issues"): DMs/huddles as before, PLUS league chat since you last opened it and Chimmy's weekly
 * lineup/waiver checks you haven't seen. It counted DMs only.
 */

vi.mock('server-only', () => ({}))

const NOW = new Date('2026-09-26T12:00:00Z')
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3600_000)

const h = vi.hoisted(() => ({
  dm: { total: 2, mentions: 1, mutedUnread: 0 },
  teams: [] as Array<{ leagueId: string }>,
  owned: [] as Array<{ id: string }>,
  marks: [] as Array<{ cacheKey: string; data: unknown }>,
  rows: [] as Array<{ leagueId: string; createdAt: Date; mentionedUserIds: string[] }>,
  chimmy: 0,
  leagueWhere: null as null | Record<string, unknown>,
  chimmyWhere: null as null | Record<string, unknown>,
  upsert: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('@/lib/chat-core/unreadCounts', () => ({ getChatUnread: async () => h.dm }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: async () => h.teams },
    league: { findMany: async () => h.owned },
    sportsDataCache: {
      findMany: async () => h.marks,
      findUnique: h.findUnique,
      upsert: h.upsert,
    },
    leagueChatMessage: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        h.leagueWhere = args.where
        return h.rows
      },
    },
    platformNotification: {
      count: async (args: { where: Record<string, unknown> }) => {
        h.chimmyWhere = args.where
        return h.chimmy
      },
      updateMany: h.updateMany,
    },
  },
}))

import { getChatBadge, markChimmyProactiveSeen } from '@/lib/chat-core/chatBadge'
import { markLeagueChatRead } from '@/lib/chat-core/leagueChatRead'

beforeEach(() => {
  h.dm = { total: 2, mentions: 1, mutedUnread: 0 }
  h.teams = [{ leagueId: 'L1' }]
  h.owned = [{ id: 'L2' }]
  h.marks = [{ cacheKey: 'league-chat-read:v1:u1:L1', data: { readAt: at(5).toISOString() } }]
  h.rows = [
    { leagueId: 'L1', createdAt: at(1), mentionedUserIds: ['u1'] }, // after my L1 read → counts, and names me
    { leagueId: 'L1', createdAt: at(10), mentionedUserIds: [] }, // before my L1 read → read
    { leagueId: 'L2', createdAt: at(30), mentionedUserIds: [] }, // L2 never opened → counts (inside the window)
  ]
  h.chimmy = 1
  h.upsert.mockReset()
  h.findUnique.mockReset().mockResolvedValue(null)
  h.updateMany.mockReset().mockResolvedValue({ count: 1 })
})

describe('getChatBadge', () => {
  it('adds league chat since you last read it and Chimmy’s weekly checks to your DMs', async () => {
    const b = await getChatBadge('u1', NOW)
    expect(b).toEqual({ total: 2 + 2 + 1, mentions: 1 + 1, dm: 2, league: 2, chimmy: 1 })
  })

  it('league chat: never your own (a Chimmy post is nobody’s own), never draft-only rows, never someone else’s private row, and a bounded window', async () => {
    await getChatBadge('u1', NOW)
    const w = h.leagueWhere!
    expect(w.leagueId).toEqual({ in: ['L1', 'L2'] })
    expect(w.source).toBeNull()
    // Behaviour is measured against rows in chat-badge-chimmy-unread.test.ts; this pins the shape.
    expect(w.AND).toEqual([
      {
        OR: [
          { userId: { not: 'u1' } },
          { metadata: { path: ['chimmy'], equals: true } },
          { metadata: { path: ['chimmyPrivateReply'], equals: true } },
          { metadata: { path: ['chimmyResponse'], equals: true } },
        ],
      },
      { OR: [{ isPrivate: false }, { visibleToUserId: 'u1' }] },
    ])
    expect((w.createdAt as { gt: Date }).gt.getTime()).toBe(NOW.getTime() - 3 * 24 * 3600_000)
  })

  it('Chimmy: only its unread weekly lineup and waiver checks from the last week', async () => {
    await getChatBadge('u1', NOW)
    expect(h.chimmyWhere).toMatchObject({ userId: 'u1', type: { in: ['chimmy_lineup_check', 'chimmy_waiver_check'] }, readAt: null })
  })

  it('a signed-out visitor is zero; a failing part is zero and the rest still count', async () => {
    expect((await getChatBadge(null, NOW)).total).toBe(0)
    h.teams = [] // no leagues → league part is simply zero
    h.owned = []
    expect(await getChatBadge('u1', NOW)).toEqual({ total: 3, mentions: 1, dm: 2, league: 0, chimmy: 1 })
  })
})

describe('marking read', () => {
  it('opening a league chat moves its marker forward, never back', async () => {
    await markLeagueChatRead('u1', 'L1', NOW)
    expect(h.upsert.mock.calls[0]![0].where).toEqual({ cacheKey: 'league-chat-read:v1:u1:L1' })
    expect(h.upsert.mock.calls[0]![0].create.data).toEqual({ readAt: NOW.toISOString() })

    h.upsert.mockReset()
    h.findUnique.mockResolvedValue({ data: { readAt: new Date(NOW.getTime() + 1000).toISOString() } })
    await markLeagueChatRead('u1', 'L1', NOW)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('opening Chimmy clears only its weekly checks', async () => {
    await markChimmyProactiveSeen('u1', NOW)
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: { in: ['chimmy_lineup_check', 'chimmy_waiver_check'] }, readAt: null },
      data: { readAt: NOW },
    })
  })
})
