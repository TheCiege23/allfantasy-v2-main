import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

/**
 * Clubhouse Phase 3: the scheduled threads (weekly prompt, news desk, game-day room),
 * their date keys, the slate merge, member profiles and the chat's polling read.
 */

const h = vi.hoisted(() => {
  const prisma = {
    appUser: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    league: { findMany: vi.fn(async () => []) },
    communityPost: {
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
      aggregate: vi.fn(async () => ({ _sum: { upvoteCount: 0 } })),
    },
    communityReply: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    communityIdeaVote: { findMany: vi.fn(async () => []) },
    communityReaction: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    playerNewsRecord: { findMany: vi.fn(async () => []) },
    sportsGame: { findMany: vi.fn(async () => []) },
  }
  return { prisma, blocked: new Set<string>() }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/adminAuth', () => ({ getAdminAccessState: vi.fn(async () => ({ status: 'unauthenticated' })) }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: vi.fn(async () => ({ appUserId: null })) }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: vi.fn(async () => true) }))
vi.mock('@/lib/moderation', () => ({
  BlockListUnavailableError: class BlockListUnavailableError extends Error {},
  getBlockedEitherWayUserIds: vi.fn(async () => h.blocked),
  isUserBanned: vi.fn(async () => false),
  isUserMuted: vi.fn(async () => false),
}))

import {
  WEEKLY_PROMPTS,
  easternDate,
  easternDayBoundsUtc,
  easternHour,
  easternWeekStart,
  systemKeys,
  weeklyPromptFor,
} from '@/lib/community/schedule'
import {
  ensureNewsDesk,
  ensureSystemPost,
  ensureWeeklyPrompt,
  mergeSlate,
  newsDeskBody,
  pickNewsDeskItems,
  resolveSystemAuthorId,
  runClubhouseSchedule,
  summarizeSchedule,
  type NewsDeskItem,
} from '@/lib/community/scheduled'
import { CommunityError, createPost, getMemberProfile, listRepliesSince } from '@/lib/community/service'
import { mergeMessages } from '@/components/community/GameDayChat'
import { COMMUNITY_CHANNELS } from '@/lib/community/channels'

const ORIGINAL_ADMINS = process.env.ADMIN_EMAILS

beforeEach(() => {
  vi.clearAllMocks()
  h.blocked = new Set()
  process.env.ADMIN_EMAILS = ORIGINAL_ADMINS
})

describe('Eastern dates', () => {
  it('keys on the Eastern day, not UTC, through Sunday night football', () => {
    // 02:30Z Monday is still 22:30 Sunday in New York.
    expect(easternDate(new Date('2026-11-02T03:30:00Z'))).toBe('2026-11-01')
    expect(easternDate(new Date('2026-11-02T05:30:00Z'))).toBe('2026-11-02')
  })

  it('starts the week on Monday', () => {
    expect(easternWeekStart(new Date('2026-11-04T15:00:00Z'))).toBe('2026-11-02') // Wednesday
    expect(easternWeekStart(new Date('2026-11-02T15:00:00Z'))).toBe('2026-11-02') // Monday
    expect(easternWeekStart(new Date('2026-11-02T03:00:00Z'))).toBe('2026-10-26') // still Sunday ET
  })

  it('bounds a day at Eastern midnight under daylight and standard time', () => {
    expect(easternDayBoundsUtc('2026-07-04').start.toISOString()).toBe('2026-07-04T04:00:00.000Z')
    expect(easternDayBoundsUtc('2026-12-25').start.toISOString()).toBe('2026-12-25T05:00:00.000Z')
    expect(easternDayBoundsUtc('2026-12-25').end.toISOString()).toBe('2026-12-26T05:00:00.000Z')
  })

  it('reads the Eastern hour', () => {
    expect(easternHour(new Date('2026-12-25T12:00:00Z'))).toBe(7)
    expect(easternHour(new Date('2026-12-25T05:00:00Z'))).toBe(0)
  })
})

describe('weekly prompt rotation', () => {
  it('is the same prompt all week and moves on the next Monday', () => {
    const mon = weeklyPromptFor(new Date('2026-11-02T15:00:00Z'))
    const sun = weeklyPromptFor(new Date('2026-11-08T20:00:00Z'))
    const next = weeklyPromptFor(new Date('2026-11-09T15:00:00Z'))
    expect(sun.index).toBe(mon.index)
    expect(next.index).toBe((mon.index + 1) % WEEKLY_PROMPTS.length)
  })

  it('cycles through every prompt', () => {
    const seen = new Set<number>()
    for (let w = 0; w < WEEKLY_PROMPTS.length; w++) {
      seen.add(weeklyPromptFor(new Date(Date.parse('2026-11-02T15:00:00Z') + w * 7 * 864e5)).index)
    }
    expect(seen.size).toBe(WEEKLY_PROMPTS.length)
  })

  it('only targets channels members can post in', () => {
    const open = new Set(COMMUNITY_CHANNELS.filter((c) => !c.systemOnly).map((c) => c.slug))
    for (const p of WEEKLY_PROMPTS) expect(open.has(p.channel)).toBe(true)
  })
})

describe('ensureSystemPost', () => {
  const args = { key: 'news:2026-11-02', authorUserId: 'founder', channel: 'sports-news', title: 'T', body: 'B' }

  it('returns the existing thread without writing', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce({ id: 'p1' })
    await expect(ensureSystemPost(args)).resolves.toEqual({ status: 'exists', postId: 'p1' })
    expect(h.prisma.communityPost.create).not.toHaveBeenCalled()
  })

  it('creates it when missing', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce(null)
    h.prisma.communityPost.create.mockResolvedValueOnce({ id: 'new' })
    await expect(ensureSystemPost(args)).resolves.toEqual({ status: 'created', postId: 'new' })
    expect(h.prisma.communityPost.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ systemKey: 'news:2026-11-02' }) }))
  })

  it('converges on the winner when two runs race on the unique key', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner' })
    h.prisma.communityPost.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    )
    await expect(ensureSystemPost(args)).resolves.toEqual({ status: 'exists', postId: 'winner' })
  })

  it('does not swallow other errors', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce(null)
    h.prisma.communityPost.create.mockRejectedValueOnce(new Error('db down'))
    await expect(ensureSystemPost(args)).rejects.toThrow('db down')
  })
})

describe('weekly prompt thread', () => {
  it('pins this week and unpins every earlier prompt', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce(null)
    h.prisma.communityPost.create.mockResolvedValueOnce({ id: 'pr' })
    const now = new Date('2026-11-04T15:00:00Z')
    await ensureWeeklyPrompt(now, 'founder')
    const key = systemKeys.weeklyPrompt('2026-11-02')
    expect(h.prisma.communityPost.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ systemKey: key, isPinned: true }) }),
    )
    expect(h.prisma.communityPost.updateMany).toHaveBeenCalledWith({
      where: { systemKey: { startsWith: 'prompt:', not: key }, isPinned: true },
      data: { isPinned: false },
    })
  })
})

function news(o: Partial<NewsDeskItem>): NewsDeskItem {
  return {
    sport: 'NFL',
    playerName: 'A Player',
    team: 'KC',
    headline: 'Questionable for Sunday',
    impact: 'medium',
    fantasyRelevant: true,
    source: 'espn',
    publishedAt: new Date('2026-11-02T12:00:00Z'),
    ...o,
  }
}

describe('news desk', () => {
  it('ranks fantasy-relevant and high impact first, and drops the same story from a second feed', () => {
    const items = pickNewsDeskItems([
      news({ playerName: 'Low', fantasyRelevant: false, impact: 'high' }),
      news({ playerName: 'Med', impact: 'medium' }),
      news({ playerName: 'High', impact: 'high' }),
      news({ playerName: 'High', impact: 'high', source: 'newsapi', headline: ' questionable  for sunday ' }),
    ])
    expect(items.map((i) => i.playerName)).toEqual(['High', 'Med', 'Low'])
  })

  it('caps the list', () => {
    const rows = Array.from({ length: 30 }, (_, i) => news({ playerName: `P${i}` }))
    expect(pickNewsDeskItems(rows, 12)).toHaveLength(12)
  })

  it('writes a readable digest', () => {
    const body = newsDeskBody([news({ impact: 'high' }), news({ playerName: 'B', team: null, headline: 'Out' })])
    expect(body).toContain('• [NFL] A Player (KC): Questionable for Sunday 🔺')
    expect(body).toContain('• [NFL] B: Out')
  })

  const morning = new Date('2026-11-02T14:00:00Z') // 09:00 ET

  it('skips rather than posting an empty thread', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce(null)
    h.prisma.playerNewsRecord.findMany.mockResolvedValueOnce([])
    await expect(ensureNewsDesk(morning, 'founder')).resolves.toMatchObject({ status: 'skipped' })
    expect(h.prisma.communityPost.create).not.toHaveBeenCalled()
  })

  it('waits for the morning', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce(null)
    const night = new Date('2026-11-02T07:00:00Z') // 02:00 ET
    await expect(ensureNewsDesk(night, 'founder')).resolves.toMatchObject({ status: 'skipped' })
    expect(h.prisma.playerNewsRecord.findMany).not.toHaveBeenCalled()
  })

  it('posts today’s desk with known sport tags only', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValue(null)
    h.prisma.playerNewsRecord.findMany.mockResolvedValueOnce([news({}), news({ sport: 'WNBA', playerName: 'W' })])
    h.prisma.communityPost.create.mockResolvedValueOnce({ id: 'nd' })
    await expect(ensureNewsDesk(morning, 'founder')).resolves.toEqual({ status: 'created', postId: 'nd' })
    expect(h.prisma.communityPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ systemKey: 'news:2026-11-02', channel: 'sports-news', tags: ['NFL'] }),
      }),
    )
  })
})

describe('the daily run', () => {
  it('does nothing without a system author, and says why', async () => {
    process.env.ADMIN_EMAILS = ''
    const out = await runClubhouseSchedule(new Date('2026-11-02T14:00:00Z'))
    expect(out.prompt).toMatchObject({ status: 'skipped' })
    expect(h.prisma.communityPost.create).not.toHaveBeenCalled()
  })

  it('posts as the first ADMIN_EMAILS address that has an account, in listed order', async () => {
    process.env.ADMIN_EMAILS = 'ghost@x.test, founder@x.test, second@x.test'
    h.prisma.appUser.findMany.mockResolvedValueOnce([
      { id: 'u2', email: 'second@x.test' },
      { id: 'u1', email: 'Founder@x.test' },
    ])
    await expect(resolveSystemAuthorId()).resolves.toBe('u1')
  })

  it('reports a failure as an error and a skip as a warning', () => {
    const s = summarizeSchedule({
      prompt: { status: 'created', postId: 'p' },
      news: { status: 'skipped', reason: 'no player news in the last 24h' },
      gameDay: { status: 'skipped', reason: 'error: boom' },
    })
    expect(s).toMatchObject({ rowsWritten: 1, errors: ['error: boom'], warnings: ['no player news in the last 24h'] })
  })
})

describe('slate merge', () => {
  const base = { homeScore: null, awayScore: null, status: null, startTime: new Date('2026-11-02T18:00:00Z') }
  it('reads each sport from its freshest source only, so differently-named copies never double up', () => {
    const games = mergeSlate([
      { ...base, sport: 'NFL', externalId: '1', source: 'ri', homeTeam: 'KC', awayTeam: 'BUF', fetchedAt: new Date(2) },
      { ...base, sport: 'NFL', externalId: 'x1', source: 'tsdb', homeTeam: 'Kansas City Chiefs', awayTeam: 'Buffalo Bills', fetchedAt: new Date(1) },
      { ...base, sport: 'NFL', externalId: '1', source: 'ri', homeTeam: 'KC', awayTeam: 'BUF', fetchedAt: new Date(2) },
      { ...base, sport: 'NBA', externalId: '9', source: 'tsdb', homeTeam: 'BOS', awayTeam: 'NYK', fetchedAt: new Date(1) },
    ])
    expect(games.map((g) => `${g.sport}:${g.homeTeam}`)).toEqual(['NBA:BOS', 'NFL:KC'])
  })
})

describe('system-only channels', () => {
  it('cannot take a member post', async () => {
    const err = await createPost({ userId: 'u', isModerator: false }, { channel: 'game-day', title: 'Hey all', body: 'x', tags: [] }).catch((e) => e)
    expect(err).toBeInstanceOf(CommunityError)
    expect((err as CommunityError).status).toBe(400)
  })
})

describe('member profiles', () => {
  const user = { id: 'm1', username: 'rae', displayName: 'Rae', avatarUrl: null, email: null, createdAt: new Date('2026-01-01') }

  it('is null for an unknown name, and for someone blocked either way', async () => {
    h.prisma.appUser.findFirst.mockResolvedValueOnce(null)
    await expect(getMemberProfile('nobody', { userId: 'v', isModerator: false })).resolves.toBeNull()
    h.prisma.appUser.findFirst.mockResolvedValueOnce(user)
    h.blocked = new Set(['m1'])
    await expect(getMemberProfile('rae', { userId: 'v', isModerator: false })).resolves.toBeNull()
  })

  it('counts only live content, and leaves out replies on removed posts', async () => {
    h.prisma.appUser.findFirst.mockResolvedValueOnce(user)
    h.prisma.communityPost.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    h.prisma.communityReply.count.mockResolvedValueOnce(7)
    h.prisma.communityPost.aggregate.mockResolvedValueOnce({ _sum: { upvoteCount: 9 } })
    const p = await getMemberProfile('RAE', { userId: null, isModerator: false })
    expect(p?.counts).toEqual({ posts: 4, replies: 7, ideas: 2, shippedIdeas: 1, upvotesReceived: 9 })
    expect(h.prisma.communityReply.count).toHaveBeenCalledWith({
      where: { authorUserId: 'm1', removedAt: null, post: { removedAt: null } },
    })
    expect(h.prisma.appUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: { equals: 'RAE', mode: 'insensitive' } } }),
    )
  })
})

describe('chat polling', () => {
  const author = { id: 'a', username: 'a', displayName: null, avatarUrl: null, email: null, createdAt: new Date('2026-01-01') }

  it('asks for replies at or after the cursor, so a same-millisecond reply is not skipped', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce({ removedAt: null, authorUserId: 'x' })
    await listRepliesSince({ userId: null, isModerator: false }, 'p', '2026-11-02T18:00:00.000Z')
    expect(h.prisma.communityReply.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { gte: new Date('2026-11-02T18:00:00.000Z') }, removedAt: null }),
        orderBy: { createdAt: 'asc' },
      }),
    )
  })

  it('returns the latest page oldest-first when starting cold', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce({ removedAt: null, authorUserId: 'x' })
    h.prisma.communityReply.findMany.mockResolvedValueOnce([
      { id: 'r2', body: 'b', createdAt: new Date(2000), author },
      { id: 'r1', body: 'a', createdAt: new Date(1000), author },
    ])
    const msgs = await listRepliesSince({ userId: 'a', isModerator: false }, 'p', null)
    expect(msgs.map((m) => m.id)).toEqual(['r1', 'r2'])
    expect(msgs[0]!.mine).toBe(true)
  })

  it('404s a removed room', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce({ removedAt: new Date(), authorUserId: 'x' })
    await expect(listRepliesSince({ userId: null, isModerator: false }, 'p', null)).rejects.toMatchObject({ status: 404 })
  })

  it('merges a poll without duplicating what is already shown', () => {
    const m = (id: string, t: number) => ({
      id,
      body: id,
      createdAt: new Date(t).toISOString(),
      author: { id: 'a', username: 'a', displayName: null, avatarUrl: null, badges: [] },
      mine: false,
    })
    const merged = mergeMessages([m('1', 1), m('2', 2)], [m('2', 2), m('3', 2)])
    expect(merged.map((x) => x.id)).toEqual(['1', '2', '3'])
  })
})
