import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Clubhouse growth, round two: unanswered automatic threads leave the home feed, the leaderboard's
 * points and ranking, upvote milestones, the weekly email's content, window and opt-in, and the
 * in-app Clubhouse cards. Each rule is paired with the case that must NOT trigger it.
 */

const h = vi.hoisted(() => {
  const prisma = {
    appUser: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    league: { findMany: vi.fn(async () => []) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    communityPost: { findMany: vi.fn(async () => []), findUnique: vi.fn(), count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
    communityIdeaVote: { findMany: vi.fn(async () => []) },
    communityReaction: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    emailPreference: { findFirst: vi.fn(), update: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async () => []),
  }
  return { prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/adminAuth', () => ({ getAdminAccessState: vi.fn(async () => ({ status: 'unauthenticated' })) }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: vi.fn(async () => ({ appUserId: null })) }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: vi.fn(async () => true) }))
vi.mock('@/lib/moderation', () => ({
  BlockListUnavailableError: class BlockListUnavailableError extends Error {},
  getBlockedEitherWayUserIds: vi.fn(async () => new Set()),
  isUserBanned: vi.fn(async () => false),
  isUserMuted: vi.fn(async () => false),
}))
vi.mock('@/lib/resend-client', () => ({ getResendClient: () => ({ client: { emails: { send: vi.fn() } }, fromEmail: 'x@y.z' }) }))

import { UNANSWERED_AUTO_THREAD, badgesFor, listPosts } from '@/lib/community/service'
import { POINTS, contributionScore, parseLeaderboardWindow, rankContributions } from '@/lib/community/leaderboard'
import { upvoteMilestoneReached } from '@/lib/community/notify'
import { buildDigestEmail, digestHasNews, digestWeekKey, inDigestWindow, type DigestWeek } from '@/lib/community/digest'
import { setDigestOptIn } from '@/lib/community/digestRunner'
import { ClubhousePromoCard } from '@/components/community/ClubhousePromoCard'

beforeEach(() => vi.clearAllMocks())

describe('the home feed hides automatic threads nobody answered', () => {
  it('filters them on the home feed', async () => {
    await listPosts({ viewer: { userId: null, isModerator: false } })
    const where = h.prisma.communityPost.findMany.mock.calls[0][0].where
    expect(where.NOT).toEqual(UNANSWERED_AUTO_THREAD)
  })
  it('keeps them in their own channel', async () => {
    await listPosts({ viewer: { userId: null, isModerator: false }, channel: 'game-day' })
    for (const call of h.prisma.communityPost.findMany.mock.calls) expect(call[0].where.NOT).toBeUndefined()
  })
  it('covers news and game day only, and only with zero replies (never the weekly prompt)', () => {
    expect(UNANSWERED_AUTO_THREAD.replyCount).toBe(0)
    const prefixes = (UNANSWERED_AUTO_THREAD.OR as Array<{ systemKey: { startsWith: string } }>).map((o) => o.systemKey.startsWith)
    expect(prefixes.sort()).toEqual(['gameday:', 'news:'])
  })
})

describe('leaderboard points', () => {
  it('weights a shipped idea above everything and a reply lowest', () => {
    expect(contributionScore({ posts: 1, replies: 0, upvotesReceived: 0, ideasShipped: 0 })).toBe(POINTS.post)
    expect(contributionScore({ posts: 0, replies: 2, upvotesReceived: 3, ideasShipped: 1 })).toBe(2 * POINTS.reply + 3 * POINTS.upvoteReceived + POINTS.ideaShipped)
    expect(POINTS.ideaShipped).toBeGreaterThan(POINTS.upvoteReceived)
    expect(POINTS.upvoteReceived).toBeGreaterThan(POINTS.reply)
  })
  it('ranks by score, drops zero scores and excluded (staff) members', () => {
    const ranked = rankContributions(
      [
        { u: 'a', posts: 1, replies: 0, upvotes: 0, shipped: 0 },
        { u: 'b', posts: 0, replies: 0, upvotes: 0, shipped: 1 },
        { u: 'staff', posts: 50, replies: 50, upvotes: 0, shipped: 0 },
        { u: 'zero', posts: 0, replies: 0, upvotes: 0, shipped: 0 },
      ],
      new Set(['staff']),
    )
    expect(ranked.map((r) => r.userId)).toEqual(['b', 'a'])
  })
  it('reads the window safely', () => {
    expect(parseLeaderboardWindow('all')).toBe('all')
    expect(parseLeaderboardWindow('nonsense')).toBe('30d')
  })
  it('the top badge shows only for members in the top set', () => {
    const author = { id: 'a', email: null, createdAt: new Date(0) }
    expect(badgesFor(author, { staff: new Set(), commish: new Set(), top: new Set(['a']), now: Date.now() })).toContain('top')
    expect(badgesFor(author, { staff: new Set(), commish: new Set(), top: new Set(['b']), now: Date.now() })).not.toContain('top')
  })
})

describe('upvote milestones', () => {
  it('fires when a vote crosses a milestone and not otherwise', () => {
    expect(upvoteMilestoneReached(4, 5)).toBe(5)
    expect(upvoteMilestoneReached(9, 10)).toBe(10)
    expect(upvoteMilestoneReached(5, 6)).toBeNull()
    expect(upvoteMilestoneReached(0, 1)).toBeNull()
  })
})

const WEEK: DigestWeek = {
  weekLabel: '2026-11-23',
  newIdeas: [{ id: 'i1', title: 'Relegation <Dynasty>', hook: 'Bottom two drop', upvotes: 4, author: '@ceejay' }],
  moves: [],
  topThreads: [],
  memberPosts: 1,
}

describe('the weekly email', () => {
  it('is skipped in a week with nothing new', () => {
    expect(digestHasNews({ ...WEEK, newIdeas: [], moves: [], topThreads: [{ id: 't', title: 't', replies: 0, channelLabel: 'x' }] })).toBe(false)
    expect(digestHasNews(WEEK)).toBe(true)
  })
  it('sends Monday from 15:00 UTC through Tuesday only', () => {
    expect(inDigestWindow(new Date('2026-11-30T14:59:00Z'))).toBe(false) // Monday, too early
    expect(inDigestWindow(new Date('2026-11-30T15:00:00Z'))).toBe(true)
    expect(inDigestWindow(new Date('2026-12-01T23:00:00Z'))).toBe(true) // Tuesday
    expect(inDigestWindow(new Date('2026-12-02T09:00:00Z'))).toBe(false) // Wednesday
  })
  it('keys a week by its Monday', () => {
    expect(digestWeekKey(new Date('2026-12-01T10:00:00Z'))).toBe('2026-11-30')
    expect(digestWeekKey(new Date('2026-11-29T23:00:00Z'))).toBe('2026-11-23') // Sunday belongs to the week before
  })
  it('escapes member text and carries the unsubscribe link', () => {
    const e = buildDigestEmail(WEEK, { origin: 'https://allfantasy.ai', unsubscribeUrl: 'https://allfantasy.ai/api/email/unsubscribe?token=t' })
    expect(e.subject).toBe('1 new league idea in the Clubhouse')
    expect(e.html).not.toContain('<Dynasty>')
    expect(e.html).toContain('&lt;Dynasty&gt;')
    expect(e.html).toContain('unsubscribe?token=t')
    expect(e.text).toContain('Unsubscribe: https://allfantasy.ai/api/email/unsubscribe?token=t')
  })
  it('leads with a shipped idea when there is one', () => {
    const e = buildDigestEmail({ ...WEEK, moves: [{ id: 'm', title: 'Pirate Bay', status: 'shipped', author: '@x' }] }, { origin: 'o', unsubscribeUrl: 'u' })
    expect(e.subject).toBe('Shipped from League Lab: Pirate Bay')
  })
})

describe('turning the weekly email on', () => {
  beforeEach(() => h.prisma.appUser.findUnique.mockResolvedValue({ email: 'Me@Example.com' }))

  it('refuses while the member is unsubscribed from all email, and writes nothing', async () => {
    h.prisma.emailPreference.findFirst.mockResolvedValue({ id: 'p', unsubscribedAt: new Date() })
    await expect(setDigestOptIn({ userId: 'u', isModerator: false }, true)).rejects.toMatchObject({ status: 409 })
    expect(h.prisma.emailPreference.update).not.toHaveBeenCalled()
  })
  it('still lets an unsubscribed member turn it off', async () => {
    h.prisma.emailPreference.findFirst.mockResolvedValue({ id: 'p', unsubscribedAt: new Date() })
    await setDigestOptIn({ userId: 'u', isModerator: false }, false)
    expect(h.prisma.emailPreference.update).toHaveBeenCalledWith({ where: { id: 'p' }, data: { weeklyDigest: false } })
  })
  it('creates a lower-cased preference row for a member who has none', async () => {
    h.prisma.emailPreference.findFirst.mockResolvedValue(null)
    expect(await setDigestOptIn({ userId: 'u', isModerator: false }, true)).toEqual({ on: true, blockedByUnsubscribe: false })
    expect(h.prisma.emailPreference.create).toHaveBeenCalledWith({ data: { email: 'me@example.com', weeklyDigest: true } })
  })
  it('requires a signed-in member', async () => {
    await expect(setDigestOptIn({ userId: null, isModerator: false }, true)).rejects.toMatchObject({ status: 401 })
  })
})

describe('in-app Clubhouse cards', () => {
  it.each([
    ['commish', '/clubhouse/ideas/new'],
    ['league-created', '/clubhouse/league-lab'],
    ['draft-done', '/clubhouse'],
  ] as const)('%s links to %s', (variant, href) => {
    const html = renderToStaticMarkup(<ClubhousePromoCard variant={variant} />)
    expect(html).toContain(`href="${href}"`)
    expect(html).toContain(`data-testid="clubhouse-promo-${variant}"`)
    expect(html).not.toMatch(/\bAI\b/)
  })
})
