import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * League Lab ideas: the short form's rules, the upvote toggle, staff-only status and the
 * author's notification. Each "may not" case is paired with its "may" case.
 */

const h = vi.hoisted(() => {
  const tx = {
    communityIdeaVote: { deleteMany: vi.fn(), createMany: vi.fn() },
    communityPost: { update: vi.fn() },
  }
  const prisma = {
    appUser: { findUnique: vi.fn(), findMany: vi.fn() },
    league: { findMany: vi.fn(async () => []) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    communityPost: {
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
    },
    communityIdeaVote: { findMany: vi.fn(async () => []) },
    communityReaction: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  return { prisma, tx, blocked: new Set<string>(), notify: vi.fn(async () => true) }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/adminAuth', () => ({ getAdminAccessState: vi.fn(async () => ({ status: 'unauthenticated' })) }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: vi.fn(async () => ({ appUserId: null })) }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: h.notify }))
vi.mock('@/lib/moderation', () => ({
  BlockListUnavailableError: class BlockListUnavailableError extends Error {},
  getBlockedEitherWayUserIds: vi.fn(async () => h.blocked),
  isUserBanned: vi.fn(async () => false),
  isUserMuted: vi.fn(async () => false),
}))

import {
  CommunityError,
  badgesFor,
  createIdea,
  ideaStatusWhere,
  ideaViewOf,
  listIdeas,
  setIdeaStatus,
  toggleIdeaVote,
} from '@/lib/community/service'
import {
  createIdeaSchema,
  ideaBoardHref,
  ideaIssueMessage,
  parseIdeaDetails,
  parseIdeaFilter,
  parseIdeaSort,
} from '@/lib/community/ideas'

const voter = { userId: 'voter', isModerator: false }
const moderator = { userId: 'mod', isModerator: true }
const DAY = 24 * 60 * 60 * 1000

function idea(overrides: Record<string, unknown> = {}) {
  return { id: 'i1', kind: 'idea', authorUserId: 'author', title: 'Relegation Dynasty', removedAt: null, ideaStatus: null, ...overrides }
}

async function errorOf(p: Promise<unknown>): Promise<CommunityError> {
  try {
    await p
  } catch (err) {
    if (err instanceof CommunityError) return err
    throw err
  }
  throw new Error('expected a CommunityError')
}

beforeEach(() => {
  vi.clearAllMocks()
  h.blocked = new Set()
  h.prisma.appUser.findUnique.mockResolvedValue({ createdAt: new Date(Date.now() - 30 * DAY), username: 'voter', displayName: null })
  h.prisma.communityPost.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
    args.select && 'upvoteCount' in args.select ? { upvoteCount: 4 } : idea(),
  )
  h.tx.communityIdeaVote.deleteMany.mockResolvedValue({ count: 0 })
  h.tx.communityIdeaVote.createMany.mockResolvedValue({ count: 1 })
})

describe('the short idea form', () => {
  const ok = { title: 'Relegation Dynasty', hook: 'Bottom two teams get sent down a league.', body: 'Two tiers, promotion and relegation every season.' }

  it('accepts the three required boxes alone', () => {
    const parsed = createIdeaSchema.safeParse(ok)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect([parsed.data.sport, parsed.data.teamSize, parsed.data.draftType]).toEqual([undefined, undefined, undefined])
  })

  it('treats empty optional fields as not given, and coerces a typed team size', () => {
    const parsed = createIdeaSchema.parse({ ...ok, sport: '', teamSize: '14', draftType: '' })
    expect(parsed).toMatchObject({ sport: undefined, teamSize: 14, draftType: undefined })
  })

  it.each([
    [{ ...ok, hook: 'short' }, 'one line'],
    [{ ...ok, title: 'ab' }, 'name'],
    [{ ...ok, teamSize: 99 }, 'Team size'],
    [{ ...ok, sport: 'CRICKET' }, 'sport'],
  ])('rejects %o with a readable message', (input, phrase) => {
    const parsed = createIdeaSchema.safeParse(input)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(ideaIssueMessage(parsed.error).toLowerCase()).toContain(phrase.toLowerCase())
  })
})

describe('idea board query params', () => {
  it('defaults unknown values rather than trusting them', () => {
    expect(parseIdeaSort('nonsense')).toBe('top')
    expect(parseIdeaSort('new')).toBe('new')
    expect(parseIdeaFilter('shipped')).toBe('shipped')
    expect(parseIdeaFilter('deleted')).toBe('all')
  })

  it('builds the shortest href for the defaults', () => {
    expect(ideaBoardHref()).toBe('/clubhouse/league-lab')
    expect(ideaBoardHref({ sort: 'new', status: 'building', page: 2 })).toBe('/clubhouse/league-lab?sort=new&status=building&page=2')
  })

  it('filters "open" to ideas with no status', () => {
    expect(ideaStatusWhere('open')).toEqual({ ideaStatus: null })
    expect(ideaStatusWhere('all')).toEqual({})
    expect(ideaStatusWhere('shipped')).toEqual({ ideaStatus: 'shipped' })
  })

  it('counts each status bucket from one groupBy', async () => {
    h.prisma.communityPost.groupBy.mockResolvedValueOnce([
      { ideaStatus: null, _count: { _all: 3 } },
      { ideaStatus: 'shipped', _count: { _all: 2 } },
      { ideaStatus: 'garbage', _count: { _all: 1 } },
    ])
    const board = await listIdeas({ viewer: voter, sort: 'top', filter: 'all' })
    expect(board.counts).toEqual({ all: 6, open: 3, under_review: 0, building: 0, shipped: 2 })
  })
})

describe('idea details', () => {
  it('reads a malformed JSON column as empty, never throws', () => {
    expect(parseIdeaDetails(null)).toEqual({ hook: '', sport: null, teamSize: null, draftType: null })
    expect(parseIdeaDetails({ hook: 5, teamSize: 'x' })).toEqual({ hook: '', sport: null, teamSize: null, draftType: null })
  })

  it('is attached only to idea rows', () => {
    const row = { ideaStatus: 'building', ideaStatusAt: new Date(0), ideaDetails: { hook: 'h' }, upvoteCount: 3 }
    expect(ideaViewOf({ ...row, kind: 'post' }, false)).toBeNull()
    expect(ideaViewOf({ ...row, kind: 'idea' }, true)).toMatchObject({ status: 'building', upvotes: 3, votedByMe: true, hook: 'h' })
  })

  it('drops an unknown stored status instead of showing it', () => {
    expect(ideaViewOf({ kind: 'idea', ideaStatus: 'nope', ideaStatusAt: null, ideaDetails: {}, upvoteCount: 0 }, false)?.status).toBeNull()
  })

  it('posts into League Lab as kind idea, with the sport as its tag', async () => {
    h.prisma.communityPost.create.mockResolvedValue({ id: 'new1' })
    await createIdea(voter, { title: 'T Ball', hook: 'A one-line hook here.', body: 'How it works, in some detail.', sport: 'MLB', teamSize: 10 })
    expect(h.prisma.communityPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'league-lab',
          kind: 'idea',
          tags: ['MLB'],
          ideaDetails: { hook: 'A one-line hook here.', sport: 'MLB', teamSize: 10, draftType: null },
        }),
      }),
    )
  })
})

describe('upvoting', () => {
  it('adds a vote and bumps the count by exactly the rows created', async () => {
    const res = await toggleIdeaVote(voter, 'i1')
    expect(res).toEqual({ upvotes: 4, votedByMe: true })
    expect(h.tx.communityPost.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { upvoteCount: { increment: 1 } } })
  })

  it('takes a vote back on the second tap', async () => {
    h.tx.communityIdeaVote.deleteMany.mockResolvedValueOnce({ count: 1 })
    const res = await toggleIdeaVote(voter, 'i1')
    expect(res.votedByMe).toBe(false)
    expect(h.tx.communityIdeaVote.createMany).not.toHaveBeenCalled()
    expect(h.tx.communityPost.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { upvoteCount: { decrement: 1 } } })
  })

  it('does not move the count when a racing tap already created the vote', async () => {
    h.tx.communityIdeaVote.createMany.mockResolvedValueOnce({ count: 0 })
    await toggleIdeaVote(voter, 'i1')
    expect(h.tx.communityPost.update).not.toHaveBeenCalled()
  })

  it('refuses your own idea, but not someone else’s', async () => {
    expect((await errorOf(toggleIdeaVote({ userId: 'author', isModerator: false }, 'i1'))).status).toBe(400)
    await expect(toggleIdeaVote(voter, 'i1')).resolves.toMatchObject({ votedByMe: true })
  })

  it('treats an ordinary post, a removed idea and a blocked author as not found', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce(idea({ kind: 'post' }))
    expect((await errorOf(toggleIdeaVote(voter, 'i1'))).status).toBe(404)
    h.prisma.communityPost.findUnique.mockResolvedValueOnce(idea({ removedAt: new Date() }))
    expect((await errorOf(toggleIdeaVote(voter, 'i1'))).status).toBe(404)
    h.blocked = new Set(['author'])
    expect((await errorOf(toggleIdeaVote(voter, 'i1'))).status).toBe(404)
  })

  it('requires sign-in', async () => {
    expect((await errorOf(toggleIdeaVote({ userId: null, isModerator: false }, 'i1'))).status).toBe(401)
  })
})

describe('idea status', () => {
  it('is staff-only', async () => {
    expect((await errorOf(setIdeaStatus(voter, 'i1', 'building'))).status).toBe(403)
    expect(h.prisma.communityPost.update).not.toHaveBeenCalled()
    await setIdeaStatus(moderator, 'i1', 'building')
    expect(h.prisma.communityPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ideaStatus: 'building' }) }),
    )
  })

  it('notifies the author once per status, keyed so a retry never double-pings', async () => {
    await setIdeaStatus(moderator, 'i1', 'shipped')
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'author', type: 'community_idea_status', sourceKey: 'community:idea-status:i1:shipped' }),
    )
  })

  it('does nothing when the status is unchanged, and stays quiet when cleared', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValueOnce(idea({ ideaStatus: 'building' }))
    await setIdeaStatus(moderator, 'i1', 'building')
    expect(h.prisma.communityPost.update).not.toHaveBeenCalled()

    h.prisma.communityPost.findUnique.mockResolvedValueOnce(idea({ ideaStatus: 'building' }))
    await setIdeaStatus(moderator, 'i1', null)
    expect(h.prisma.communityPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ideaStatus: null, ideaStatusAt: null } }),
    )
    expect(h.notify).not.toHaveBeenCalled()
  })
})

describe('the Shipped badge', () => {
  const author = { id: 'a', email: null, createdAt: new Date(Date.now() - 30 * DAY) }
  it('is given only to authors with a shipped idea', () => {
    const ctx = { staff: new Set<string>(), commish: new Set<string>(), now: Date.now() }
    expect(badgesFor(author, { ...ctx, shipped: new Set(['a']) })).toContain('shipped')
    expect(badgesFor(author, { ...ctx, shipped: new Set(['b']) })).not.toContain('shipped')
  })
})
