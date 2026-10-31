import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Clubhouse service rules against a mocked Prisma: who may reply, who gets notified,
 * what a block hides, and the brand-new-account brake. Each "may not" case is paired
 * with the matching "may" case, so a test cannot pass by everything failing.
 */

const h = vi.hoisted(() => {
  const prisma = {
    appUser: { findUnique: vi.fn(), findMany: vi.fn() },
    league: { findMany: vi.fn() },
    leagueTeam: { findMany: vi.fn(async () => []) },
    communityPost: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    communityReply: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    communityReaction: { groupBy: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    communityReport: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return {
    prisma,
    blocked: new Set<string>(),
    banned: false,
    notify: vi.fn(async () => true),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/adminAuth', () => ({ getAdminAccessState: vi.fn(async () => ({ status: 'unauthenticated' })) }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: vi.fn(async () => ({ appUserId: null })) }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: h.notify }))
vi.mock('@/lib/moderation', () => ({
  BlockListUnavailableError: class BlockListUnavailableError extends Error {},
  getBlockedEitherWayUserIds: vi.fn(async () => h.blocked),
  isUserBanned: vi.fn(async () => h.banned),
  isUserMuted: vi.fn(async () => false),
}))

import { CommunityError, createPost, createReply, getPost, listPendingReports, listPosts } from '@/lib/community/service'

const member = { userId: 'replier', isModerator: false }
const moderator = { userId: 'mod', isModerator: true }
const DAY = 24 * 60 * 60 * 1000

function post(overrides: Record<string, unknown> = {}) {
  return { id: 'p1', authorUserId: 'author', title: 'Keeper deadline?', isLocked: false, removedAt: null, channel: 'commish-corner', ...overrides }
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
  h.banned = false
  h.prisma.appUser.findUnique.mockResolvedValue({
    createdAt: new Date(Date.now() - 30 * DAY),
    username: 'replier',
    displayName: 'Rae',
  })
  h.prisma.communityPost.findUnique.mockResolvedValue(post())
  h.prisma.communityReply.create.mockResolvedValue({ id: 'r1' })
  h.prisma.communityPost.update.mockResolvedValue({ id: 'p1' })
  h.prisma.communityReply.count.mockResolvedValue(0)
  h.prisma.communityPost.count.mockResolvedValue(0)
})

describe('replying', () => {
  it('bumps the thread and tells the post author, keyed so a retry cannot ping twice', async () => {
    await expect(createReply(member, 'p1', 'Week 1 kickoff.')).resolves.toEqual({ id: 'r1' })

    expect(h.prisma.communityPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ replyCount: { increment: 1 } }) }),
    )
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'author',
        type: 'community_reply',
        sourceKey: 'community:reply:r1:author',
        meta: expect.objectContaining({ actionHref: '/clubhouse/post/p1#reply-r1' }),
      }),
    )
  })

  it('does not notify you about your own reply', async () => {
    await createReply({ userId: 'author', isModerator: false }, 'p1', 'Bumping this.')
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('a failed notification does not fail the reply', async () => {
    h.notify.mockRejectedValueOnce(new Error('db down'))
    await expect(createReply(member, 'p1', 'Still posts.')).resolves.toEqual({ id: 'r1' })
  })

  it('a locked thread takes replies from moderators only', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValue(post({ isLocked: true }))
    expect((await errorOf(createReply(member, 'p1', 'hi'))).status).toBe(403)
    await expect(createReply(moderator, 'p1', 'Locking this, see the pinned post.')).resolves.toEqual({ id: 'r1' })
  })

  it('a removed post, or one by someone blocked either way, looks like it does not exist', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValue(post({ removedAt: new Date() }))
    expect((await errorOf(createReply(member, 'p1', 'hi'))).status).toBe(404)

    h.prisma.communityPost.findUnique.mockResolvedValue(post())
    h.blocked = new Set(['author'])
    expect((await errorOf(createReply(member, 'p1', 'hi'))).status).toBe(404)
    expect(h.prisma.communityReply.create).not.toHaveBeenCalled()
  })

  it('signed out is 401 and banned is 403', async () => {
    expect((await errorOf(createReply({ userId: null, isModerator: false }, 'p1', 'hi'))).status).toBe(401)
    h.banned = true
    expect((await errorOf(createReply(member, 'p1', 'hi'))).status).toBe(403)
  })

  it('a brand-new account stops at fifteen replies on day one; an older one does not', async () => {
    h.prisma.communityReply.count.mockResolvedValue(15)
    await expect(createReply(member, 'p1', 'one more')).resolves.toEqual({ id: 'r1' })

    h.prisma.appUser.findUnique.mockResolvedValue({ createdAt: new Date(Date.now() - 60_000), username: 'n', displayName: null })
    expect((await errorOf(createReply(member, 'p1', 'one more'))).status).toBe(429)
  })
})

describe('posting', () => {
  it('drops sport tags in a channel that does not offer them', async () => {
    h.prisma.communityPost.create.mockResolvedValue({ id: 'p9' })
    await createPost(member, { channel: 'other-apps', title: 'Sleeper vs us', body: 'Go.', tags: ['NFL'] })
    expect(h.prisma.communityPost.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tags: [] }) }))

    await createPost(member, { channel: 'sports-news', title: 'Injury news', body: 'Go.', tags: ['NFL'] })
    expect(h.prisma.communityPost.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tags: ['NFL'] }) }),
    )
  })
})

describe('reading', () => {
  const author = (id: string) => ({ id, username: id, displayName: null, avatarUrl: null, email: `${id}@x.com`, createdAt: new Date(Date.now() - 30 * DAY) })

  beforeEach(() => {
    h.prisma.league.findMany.mockResolvedValue([])
    h.prisma.communityReaction.groupBy.mockResolvedValue([])
    h.prisma.communityReaction.findMany.mockResolvedValue([])
  })

  it('the list query excludes authors blocked either way', async () => {
    h.blocked = new Set(['troll'])
    h.prisma.communityPost.findMany.mockResolvedValue([])
    await listPosts({ viewer: member, channel: 'commish-corner' })
    for (const call of h.prisma.communityPost.findMany.mock.calls) {
      expect(call[0].where.authorUserId).toEqual({ notIn: ['troll'] })
      expect(call[0].where.removedAt).toBeNull()
    }
  })

  it('a thread hides blocked repliers and never sends a removed reply\'s text', async () => {
    h.blocked = new Set(['troll'])
    h.prisma.communityPost.findUnique.mockResolvedValue({
      id: 'p1', channel: 'commish-corner', title: 'T', body: 'B', tags: [], isPinned: false, isLocked: false,
      replyCount: 3, createdAt: new Date(), lastActivityAt: new Date(), editedAt: null, removedAt: null,
      author: author('author'),
      replies: [
        { id: 'r1', body: 'fine', createdAt: new Date(), editedAt: null, removedAt: null, author: author('a') },
        { id: 'r2', body: 'mean', createdAt: new Date(), editedAt: null, removedAt: null, author: author('troll') },
        { id: 'r3', body: 'secret', createdAt: new Date(), editedAt: null, removedAt: new Date(), author: author('b') },
      ],
    })
    const detail = await getPost('p1', member)
    expect(detail?.replies.map((r) => r.id)).toEqual(['r1', 'r3'])
    expect(detail?.replies[1]).toMatchObject({ removed: true, body: '', author: null })
    expect(JSON.stringify(detail)).not.toContain('@x.com')
  })

  it('a removed post is invisible except to moderators', async () => {
    h.prisma.communityPost.findUnique.mockResolvedValue({
      id: 'p1', channel: 'commish-corner', title: 'T', body: 'B', tags: [], isPinned: false, isLocked: false,
      replyCount: 0, createdAt: new Date(), lastActivityAt: new Date(), editedAt: null, removedAt: new Date(),
      author: author('author'), replies: [],
    })
    await expect(getPost('p1', member)).resolves.toBeNull()
    await expect(getPost('p1', moderator)).resolves.toMatchObject({ removed: true })
  })
})

describe('moderation queue', () => {
  it('marks only actually-removed targets as removed (a live post keeps its Remove button)', async () => {
    h.prisma.communityReport.findMany.mockResolvedValue([
      { id: 'rep1', reason: 'spam', details: null, createdAt: new Date(), targetType: 'post', targetId: 'live', reporter: { username: 's' } },
      { id: 'rep2', reason: 'spam', details: null, createdAt: new Date(), targetType: 'post', targetId: 'gone', reporter: { username: 's' } },
      { id: 'rep3', reason: 'other', details: null, createdAt: new Date(), targetType: 'reply', targetId: 'r-live', reporter: { username: 's' } },
      { id: 'rep4', reason: 'other', details: null, createdAt: new Date(), targetType: 'reply', targetId: 'missing', reporter: { username: 's' } },
    ])
    h.prisma.communityPost.findMany.mockResolvedValue([
      { id: 'live', title: 'T', body: 'B', removedAt: null, author: { username: 'a' } },
      { id: 'gone', title: 'T', body: 'B', removedAt: new Date(), author: { username: 'a' } },
    ])
    h.prisma.communityReply.findMany.mockResolvedValue([
      { id: 'r-live', postId: 'live', body: 'x', removedAt: null, author: { username: 'b' } },
    ])
    const queue = await listPendingReports(moderator)
    expect(queue.map((q) => [q.id, q.targetRemoved])).toEqual([
      ['rep1', false],
      ['rep2', true],
      ['rep3', false],
      ['rep4', true],
    ])
  })

  it('is moderators only', async () => {
    expect((await errorOf(listPendingReports(member))).status).toBe(403)
  })
})
