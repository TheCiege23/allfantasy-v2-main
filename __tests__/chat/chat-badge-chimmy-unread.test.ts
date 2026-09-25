/**
 * A Chimmy post in league chat is unread for EVERYONE — the commissioner included.
 *
 * 🛑 Chimmy's rows are stored under the league owner (a required FK, no bot user), so "never your own"
 * silently dropped every Chimmy post from the COMMISSIONER's bubble: the one person a governance
 * notice is most for. The query stays set-based — one `findMany`, one `where` — and this test runs
 * that exact `where` against in-memory rows, so it measures what Postgres would return rather than
 * the shape of the object.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const NOW = new Date('2026-09-26T12:00:00Z')
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3600_000)

type Msg = {
  leagueId: string
  userId: string
  createdAt: Date
  source: string | null
  isPrivate: boolean
  visibleToUserId: string | null
  metadata: Record<string, unknown> | null
  mentionedUserIds: string[]
}

const h = vi.hoisted(() => ({
  rows: [] as Msg[],
  calls: 0,
  teams: [] as Array<{ leagueId: string }>,
  owned: [] as Array<{ id: string }>,
}))

/** Enough of Prisma's `where` semantics for this query: scalars, in / gt / not, AND / OR, JSON path. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(cond as Array<Record<string, unknown>>).every((c) => matches(row, c))) return false
      continue
    }
    if (key === 'OR') {
      if (!(cond as Array<Record<string, unknown>>).some((c) => matches(row, c))) return false
      continue
    }
    const value = row[key]
    if (cond === null) {
      if (value !== null) return false
      continue
    }
    if (typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ('path' in c) {
        const leaf = (c.path as string[]).reduce<unknown>(
          (obj, k) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[k] : undefined),
          value,
        )
        if (leaf !== c.equals) return false
        continue
      }
      if ('in' in c && !(c.in as unknown[]).includes(value)) return false
      if ('gt' in c && !((value as Date) > (c.gt as Date))) return false
      if ('not' in c && value === c.not) return false
      continue
    }
    if (value !== cond) return false
  }
  return true
}

vi.mock('@/lib/chat-core/unreadCounts', () => ({ getChatUnread: async () => ({ total: 0, mentions: 0, mutedUnread: 0 }) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: async () => h.teams },
    league: { findMany: async () => h.owned },
    sportsDataCache: { findMany: async () => [] },
    leagueChatMessage: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        h.calls += 1
        return h.rows.filter((r) => matches(r as unknown as Record<string, unknown>, where))
      },
    },
    platformNotification: { count: async () => 0 },
  },
}))

import { getChatBadge } from '@/lib/chat-core/chatBadge'

const msg = (over: Partial<Msg>): Msg => ({
  leagueId: 'L1',
  userId: 'commish',
  createdAt: at(1),
  source: null,
  isPrivate: false,
  visibleToUserId: null,
  metadata: null,
  mentionedUserIds: [],
  ...over,
})

beforeEach(() => {
  h.calls = 0
  h.rows = [
    // Chimmy's weekly awards and a commissioner notice: stored under the owner, marked Chimmy.
    msg({ metadata: { chimmy: true, chimmyMoment: { v: 1, kind: 'weekly_awards' } } }),
    msg({ metadata: { chimmy: true, chimmyMoment: { v: 1, kind: 'commissioner_notice' } }, createdAt: at(2) }),
    // The commissioner's own message: never unread for them.
    msg({ metadata: { text: 'my own words' } }),
    // A member's message.
    msg({ userId: 'member', metadata: null }),
    // A member cannot forge the marker through the client allowlist — but a row carrying
    // `chimmy: false` is plainly not Chimmy's either.
    msg({ metadata: { chimmy: false } }),
  ]
})

describe('Chimmy posts count as unread for the commissioner too', () => {
  it('the commissioner: both Chimmy posts and the member’s message — never their own words', async () => {
    h.owned = [{ id: 'L1' }]
    h.teams = []
    const badge = await getChatBadge('commish', NOW)
    expect(badge.league).toBe(3)
    expect(h.calls).toBe(1) // one set-based query, not a read per row
  })

  it('a member: both Chimmy posts, the commissioner’s message — never their own', async () => {
    h.owned = []
    h.teams = [{ leagueId: 'L1' }]
    const badge = await getChatBadge('member', NOW)
    expect(badge.league).toBe(5 - 1)
  })

  it('a private Chimmy reply counts only for the person it answers', async () => {
    h.rows = [msg({ isPrivate: true, visibleToUserId: 'commish', metadata: { chimmyPrivateReply: true } })]
    h.owned = [{ id: 'L1' }]
    h.teams = [{ leagueId: 'L1' }]
    expect((await getChatBadge('commish', NOW)).league).toBe(1)
    expect((await getChatBadge('member', NOW)).league).toBe(0)
  })
})
