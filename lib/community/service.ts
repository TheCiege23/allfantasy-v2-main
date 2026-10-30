import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAdminAccessState } from '@/lib/adminAuth'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import {
  BlockListUnavailableError,
  getBlockedEitherWayUserIds,
  isUserBanned,
  isUserMuted,
} from '@/lib/moderation'
import { COMMUNITY_CHANNELS, clubhousePostHref, getChannel } from './channels'
import { newAccountLimitMessage } from './validation'
import { notifyCommunityMentions, notifyPostAuthorOfReply } from './notify'

/**
 * Clubhouse reads and writes. Every page and route goes through here, so the rules that
 * matter — who may see what, who may write, what a removal hides — live in one file.
 *
 * ⚠ AUTHOR EMAILS ARE READ HERE AND NEVER LEAVE. The staff badge is decided from the
 * email; `toAuthor` is the only place an author is shaped for a client, and it drops it.
 */

export class CommunityError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'CommunityError'
  }
}

export type CommunityViewer = { userId: string | null; isModerator: boolean }

export type AuthorBadge = 'staff' | 'commish' | 'new'

export type CommunityAuthor = {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  badges: AuthorBadge[]
}

export type ReactionSummary = { emoji: string; count: number; mine: boolean }

export type PostSummary = {
  id: string
  channel: string
  title: string
  excerpt: string
  tags: string[]
  isPinned: boolean
  isLocked: boolean
  replyCount: number
  createdAt: string
  lastActivityAt: string
  author: CommunityAuthor
  reactions: ReactionSummary[]
}

export type ReplyView = {
  id: string
  /** Empty when removed — the text of a removed reply is never sent. */
  body: string
  removed: boolean
  createdAt: string
  editedAt: string | null
  author: CommunityAuthor | null
  reactions: ReactionSummary[]
  canEdit: boolean
}

export type PostDetail = PostSummary & {
  body: string
  editedAt: string | null
  removed: boolean
  canEdit: boolean
  replies: ReplyView[]
}

/** "New" badge window. Longer than the posting-limit window: it is a welcome, not a brake. */
const NEW_MEMBER_BADGE_MS = 7 * 24 * 60 * 60 * 1000
const EXCERPT_CHARS = 220
const MAX_REPLIES_SHOWN = 500

const AUTHOR_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  email: true,
  createdAt: true,
} satisfies Prisma.AppUserSelect

type AuthorRow = Prisma.AppUserGetPayload<{ select: typeof AUTHOR_SELECT }>

// ─── viewer ──────────────────────────────────────────────────────────────────

export async function getCommunityViewer(): Promise<CommunityViewer> {
  const { appUserId } = await resolvePlatformUser()
  if (!appUserId) return { userId: null, isModerator: false }
  const admin = await getAdminAccessState().catch(() => null)
  return { userId: appUserId, isModerator: admin?.status === 'admin' }
}

/**
 * ADMIN_EMAILS only. `isAdminEmailAllowed` also admits the AllFantasy test accounts,
 * which is right for an admin gate and wrong for a public "Team" badge.
 */
export function staffEmailSet(raw = process.env.ADMIN_EMAILS || ''): Set<string> {
  return new Set(
    raw
      .split(/[\n\r,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

async function blockedFor(viewer: CommunityViewer): Promise<Set<string>> {
  if (!viewer.userId) return new Set()
  try {
    return await getBlockedEitherWayUserIds(viewer.userId)
  } catch (err) {
    if (err instanceof BlockListUnavailableError) {
      throw new CommunityError(503, 'The Clubhouse is having trouble loading. Try again in a moment.')
    }
    throw err
  }
}

async function requireWriter(viewer: CommunityViewer): Promise<string> {
  if (!viewer.userId) throw new CommunityError(401, 'Sign in to post in the Clubhouse.')
  const [banned, muted] = await Promise.all([isUserBanned(viewer.userId), isUserMuted(viewer.userId)])
  if (banned || muted) throw new CommunityError(403, "Your account can't post right now.")
  return viewer.userId
}

function requireModerator(viewer: CommunityViewer): string {
  if (!viewer.userId || !viewer.isModerator) throw new CommunityError(403, 'Moderators only.')
  return viewer.userId
}

// ─── shaping ─────────────────────────────────────────────────────────────────

async function commissionerIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const rows = await prisma.league.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true },
    distinct: ['userId'],
  })
  return new Set(rows.map((r) => r.userId))
}

export function badgesFor(
  author: Pick<AuthorRow, 'id' | 'email' | 'createdAt'>,
  ctx: { staff: Set<string>; commish: Set<string>; now: number },
): AuthorBadge[] {
  const badges: AuthorBadge[] = []
  if (author.email && ctx.staff.has(author.email.toLowerCase())) badges.push('staff')
  if (ctx.commish.has(author.id)) badges.push('commish')
  if (ctx.now - author.createdAt.getTime() < NEW_MEMBER_BADGE_MS) badges.push('new')
  return badges
}

async function authorShaper(rows: AuthorRow[]): Promise<(row: AuthorRow) => CommunityAuthor> {
  const ids = Array.from(new Set(rows.map((r) => r.id)))
  const ctx = { staff: staffEmailSet(), commish: await commissionerIds(ids), now: Date.now() }
  return (row) => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    badges: badgesFor(row, ctx),
  })
}

async function reactionSummaries(
  targetType: 'post' | 'reply',
  targetIds: string[],
  viewerId: string | null,
): Promise<Map<string, ReactionSummary[]>> {
  const out = new Map<string, ReactionSummary[]>()
  if (targetIds.length === 0) return out
  const [counts, mine] = await Promise.all([
    prisma.communityReaction.groupBy({
      by: ['targetId', 'emoji'],
      where: { targetType, targetId: { in: targetIds } },
      _count: { _all: true },
    }),
    viewerId
      ? prisma.communityReaction.findMany({
          where: { targetType, targetId: { in: targetIds }, userId: viewerId },
          select: { targetId: true, emoji: true },
        })
      : Promise.resolve([] as { targetId: string; emoji: string }[]),
  ])
  const mineKeys = new Set(mine.map((m) => `${m.targetId}|${m.emoji}`))
  for (const c of counts) {
    const list = out.get(c.targetId) ?? []
    list.push({ emoji: c.emoji, count: c._count._all, mine: mineKeys.has(`${c.targetId}|${c.emoji}`) })
    out.set(c.targetId, list)
  }
  return out
}

export function excerptOf(body: string, max = EXCERPT_CHARS): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

const POST_LIST_SELECT = {
  id: true,
  channel: true,
  title: true,
  body: true,
  tags: true,
  isPinned: true,
  isLocked: true,
  replyCount: true,
  createdAt: true,
  lastActivityAt: true,
  author: { select: AUTHOR_SELECT },
} satisfies Prisma.CommunityPostSelect

type PostListRow = Prisma.CommunityPostGetPayload<{ select: typeof POST_LIST_SELECT }>

async function shapePosts(rows: PostListRow[], viewer: CommunityViewer): Promise<PostSummary[]> {
  const [shape, reactions] = await Promise.all([
    authorShaper(rows.map((r) => r.author)),
    reactionSummaries('post', rows.map((r) => r.id), viewer.userId),
  ])
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    title: r.title,
    excerpt: excerptOf(r.body),
    tags: r.tags,
    isPinned: r.isPinned,
    isLocked: r.isLocked,
    replyCount: r.replyCount,
    createdAt: r.createdAt.toISOString(),
    lastActivityAt: r.lastActivityAt.toISOString(),
    author: shape(r.author),
    reactions: reactions.get(r.id) ?? [],
  }))
}

// ─── reads ───────────────────────────────────────────────────────────────────

export type PostListPage = { pinned: PostSummary[]; posts: PostSummary[]; nextCursor: string | null }

/**
 * Pinned posts come first and only on the first page; the rest are ordered by last
 * activity, so a thread someone just replied to rises. `before` is the previous page's
 * last `lastActivityAt`.
 */
export async function listPosts(args: {
  viewer: CommunityViewer
  channel?: string | null
  before?: string | null
  limit?: number
}): Promise<PostListPage> {
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 50)
  const blocked = await blockedFor(args.viewer)
  const before = args.before ? new Date(args.before) : null
  const base: Prisma.CommunityPostWhereInput = {
    removedAt: null,
    ...(args.channel ? { channel: args.channel } : {}),
    ...(blocked.size ? { authorUserId: { notIn: Array.from(blocked) } } : {}),
  }

  const firstPage = !before || Number.isNaN(before.getTime())
  const [pinnedRows, rows] = await Promise.all([
    firstPage
      ? prisma.communityPost.findMany({
          where: { ...base, isPinned: true },
          orderBy: { lastActivityAt: 'desc' },
          take: 5,
          select: POST_LIST_SELECT,
        })
      : Promise.resolve([] as PostListRow[]),
    prisma.communityPost.findMany({
      where: {
        ...base,
        isPinned: false,
        ...(firstPage ? {} : { lastActivityAt: { lt: before! } }),
      },
      orderBy: { lastActivityAt: 'desc' },
      take: limit + 1,
      select: POST_LIST_SELECT,
    }),
  ])

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const [pinned, posts] = await Promise.all([shapePosts(pinnedRows, args.viewer), shapePosts(page, args.viewer)])
  return {
    pinned,
    posts,
    nextCursor: hasMore ? page[page.length - 1]!.lastActivityAt.toISOString() : null,
  }
}

export type ChannelStat = { slug: string; postCount: number; lastActivityAt: string | null }

export async function getChannelStats(): Promise<ChannelStat[]> {
  const rows = await prisma.communityPost.groupBy({
    by: ['channel'],
    where: { removedAt: null },
    _count: { _all: true },
    _max: { lastActivityAt: true },
  })
  const byChannel = new Map(rows.map((r) => [r.channel, r]))
  return COMMUNITY_CHANNELS.map((c) => {
    const r = byChannel.get(c.slug)
    return {
      slug: c.slug,
      postCount: r?._count._all ?? 0,
      lastActivityAt: r?._max.lastActivityAt?.toISOString() ?? null,
    }
  })
}

/** Has this person ever posted anything? Drives the "introduce yourself" nudge. */
export async function hasEverPosted(userId: string): Promise<boolean> {
  const [post, reply] = await Promise.all([
    prisma.communityPost.findFirst({ where: { authorUserId: userId }, select: { id: true } }),
    prisma.communityReply.findFirst({ where: { authorUserId: userId }, select: { id: true } }),
  ])
  return Boolean(post || reply)
}

/** Null when the post does not exist, is removed (for a non-moderator) or is by someone blocked either way. */
export async function getPost(postId: string, viewer: CommunityViewer): Promise<PostDetail | null> {
  const row = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: {
      ...POST_LIST_SELECT,
      editedAt: true,
      removedAt: true,
      replies: {
        orderBy: { createdAt: 'asc' },
        take: MAX_REPLIES_SHOWN,
        select: {
          id: true,
          body: true,
          createdAt: true,
          editedAt: true,
          removedAt: true,
          author: { select: AUTHOR_SELECT },
        },
      },
    },
  })
  if (!row) return null
  if (row.removedAt && !viewer.isModerator) return null
  const blocked = await blockedFor(viewer)
  if (blocked.has(row.author.id)) return null

  const replies = row.replies.filter((r) => !blocked.has(r.author.id))
  const [shape, postReactions, replyReactions] = await Promise.all([
    authorShaper([row.author, ...replies.map((r) => r.author)]),
    reactionSummaries('post', [row.id], viewer.userId),
    reactionSummaries('reply', replies.map((r) => r.id), viewer.userId),
  ])

  return {
    id: row.id,
    channel: row.channel,
    title: row.title,
    body: row.body,
    excerpt: excerptOf(row.body),
    tags: row.tags,
    isPinned: row.isPinned,
    isLocked: row.isLocked,
    replyCount: row.replyCount,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    removed: Boolean(row.removedAt),
    canEdit: viewer.userId === row.author.id && !row.removedAt,
    author: shape(row.author),
    reactions: postReactions.get(row.id) ?? [],
    replies: replies.map((r) => {
      const removed = Boolean(r.removedAt)
      return {
        id: r.id,
        body: removed ? '' : r.body,
        removed,
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt?.toISOString() ?? null,
        author: removed ? null : shape(r.author),
        reactions: removed ? [] : replyReactions.get(r.id) ?? [],
        canEdit: !removed && viewer.userId === r.author.id,
      }
    }),
  }
}

// ─── writes ──────────────────────────────────────────────────────────────────

async function enforceNewAccountLimit(userId: string, kind: 'post' | 'reply'): Promise<void> {
  const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { createdAt: true } })
  if (!user) throw new CommunityError(401, 'Sign in to post in the Clubhouse.')
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  if (Date.now() - user.createdAt.getTime() >= 24 * 60 * 60 * 1000) return
  const count =
    kind === 'post'
      ? await prisma.communityPost.count({ where: { authorUserId: userId, createdAt: { gte: since } } })
      : await prisma.communityReply.count({ where: { authorUserId: userId, createdAt: { gte: since } } })
  const message = newAccountLimitMessage({ kind, accountCreatedAt: user.createdAt, countInLastDay: count })
  if (message) throw new CommunityError(429, message)
}

async function actorName(userId: string): Promise<string> {
  const u = await prisma.appUser.findUnique({ where: { id: userId }, select: { username: true, displayName: true } })
  return u?.displayName || u?.username || 'Someone'
}

export async function createPost(
  viewer: CommunityViewer,
  input: { channel: string; title: string; body: string; tags: string[] },
): Promise<{ id: string }> {
  const userId = await requireWriter(viewer)
  const channel = getChannel(input.channel)
  if (!channel) throw new CommunityError(400, 'Pick a channel')
  await enforceNewAccountLimit(userId, 'post')
  const post = await prisma.communityPost.create({
    data: {
      channel: channel.slug,
      authorUserId: userId,
      title: input.title,
      body: input.body,
      tags: channel.sportTags ? input.tags : [],
    },
    select: { id: true },
  })
  await notifyCommunityMentions({
    text: `${input.title}\n${input.body}`,
    actorUserId: userId,
    actorName: await actorName(userId),
    postId: post.id,
    postTitle: input.title,
    sourceKeyBase: `community:post:${post.id}`,
  }).catch(() => {})
  return post
}

async function loadPostForWrite(postId: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, authorUserId: true, title: true, isLocked: true, removedAt: true, channel: true },
  })
  if (!post) throw new CommunityError(404, 'Post not found')
  return post
}

export async function editPost(
  viewer: CommunityViewer,
  postId: string,
  input: { title: string; body: string; tags: string[] },
): Promise<void> {
  const userId = await requireWriter(viewer)
  const post = await loadPostForWrite(postId)
  if (post.authorUserId !== userId || post.removedAt) throw new CommunityError(403, 'You can only edit your own posts.')
  await prisma.communityPost.update({
    where: { id: postId },
    data: {
      title: input.title,
      body: input.body,
      tags: getChannel(post.channel)?.sportTags ? input.tags : [],
      editedAt: new Date(),
    },
  })
}

/** Author or moderator. Soft: the row stays so a removal can be reviewed. */
export async function deletePost(viewer: CommunityViewer, postId: string): Promise<void> {
  if (!viewer.userId) throw new CommunityError(401, 'Sign in first.')
  const post = await loadPostForWrite(postId)
  if (post.authorUserId !== viewer.userId && !viewer.isModerator) {
    throw new CommunityError(403, 'You can only delete your own posts.')
  }
  if (post.removedAt) return
  await prisma.communityPost.update({
    where: { id: postId },
    data: { removedAt: new Date(), removedByUserId: viewer.userId },
  })
}

export async function moderatePost(
  viewer: CommunityViewer,
  postId: string,
  action: 'pin' | 'unpin' | 'lock' | 'unlock' | 'remove' | 'restore',
): Promise<void> {
  const modId = requireModerator(viewer)
  await loadPostForWrite(postId)
  const data: Prisma.CommunityPostUpdateInput =
    action === 'pin'
      ? { isPinned: true }
      : action === 'unpin'
        ? { isPinned: false }
        : action === 'lock'
          ? { isLocked: true }
          : action === 'unlock'
            ? { isLocked: false }
            : action === 'remove'
              ? { removedAt: new Date(), removedByUserId: modId }
              : { removedAt: null, removedByUserId: null }
  await prisma.communityPost.update({ where: { id: postId }, data })
}

export async function createReply(
  viewer: CommunityViewer,
  postId: string,
  body: string,
): Promise<{ id: string }> {
  const userId = await requireWriter(viewer)
  const post = await loadPostForWrite(postId)
  if (post.removedAt) throw new CommunityError(404, 'Post not found')
  if (post.isLocked && !viewer.isModerator) throw new CommunityError(403, 'This thread is locked.')
  const blocked = await blockedFor(viewer)
  if (blocked.has(post.authorUserId)) throw new CommunityError(404, 'Post not found')
  await enforceNewAccountLimit(userId, 'reply')

  const now = new Date()
  const [reply] = await prisma.$transaction([
    prisma.communityReply.create({ data: { postId, authorUserId: userId, body }, select: { id: true } }),
    prisma.communityPost.update({
      where: { id: postId },
      data: { replyCount: { increment: 1 }, lastActivityAt: now },
      select: { id: true },
    }),
  ])

  const name = await actorName(userId)
  const notified = new Set<string>([userId])
  // A failed notification must never surface as "reply not posted"; the reply already is.
  try {
    if (await notifyPostAuthorOfReply({ post, replyId: reply.id, replierUserId: userId, replierName: name, body })) {
      notified.add(post.authorUserId)
    }
    await notifyCommunityMentions({
      text: body,
      actorUserId: userId,
      actorName: name,
      postId,
      postTitle: post.title,
      replyId: reply.id,
      skipUserIds: notified,
      sourceKeyBase: `community:reply:${reply.id}`,
    })
  } catch {
    // see above
  }
  return reply
}

async function loadReplyForWrite(replyId: string) {
  const reply = await prisma.communityReply.findUnique({
    where: { id: replyId },
    select: { id: true, postId: true, authorUserId: true, removedAt: true },
  })
  if (!reply) throw new CommunityError(404, 'Reply not found')
  return reply
}

export async function editReply(viewer: CommunityViewer, replyId: string, body: string): Promise<void> {
  const userId = await requireWriter(viewer)
  const reply = await loadReplyForWrite(replyId)
  if (reply.authorUserId !== userId || reply.removedAt) throw new CommunityError(403, 'You can only edit your own replies.')
  await prisma.communityReply.update({ where: { id: replyId }, data: { body, editedAt: new Date() } })
}

async function removeReply(replyId: string, byUserId: string): Promise<void> {
  const reply = await loadReplyForWrite(replyId)
  if (reply.removedAt) return
  await prisma.$transaction([
    prisma.communityReply.update({ where: { id: replyId }, data: { removedAt: new Date(), removedByUserId: byUserId } }),
    prisma.communityPost.update({ where: { id: reply.postId }, data: { replyCount: { decrement: 1 } } }),
  ])
}

export async function deleteReply(viewer: CommunityViewer, replyId: string): Promise<void> {
  if (!viewer.userId) throw new CommunityError(401, 'Sign in first.')
  const reply = await loadReplyForWrite(replyId)
  if (reply.authorUserId !== viewer.userId && !viewer.isModerator) {
    throw new CommunityError(403, 'You can only delete your own replies.')
  }
  await removeReply(replyId, viewer.userId)
}

/** Live (not removed) target, or a 404. */
async function assertTarget(targetType: 'post' | 'reply', targetId: string): Promise<void> {
  const row =
    targetType === 'post'
      ? await prisma.communityPost.findUnique({ where: { id: targetId }, select: { removedAt: true } })
      : await prisma.communityReply.findUnique({ where: { id: targetId }, select: { removedAt: true } })
  if (!row || row.removedAt) throw new CommunityError(404, 'Not found')
}

export async function toggleReaction(
  viewer: CommunityViewer,
  input: { targetType: 'post' | 'reply'; targetId: string; emoji: string },
): Promise<ReactionSummary[]> {
  const userId = await requireWriter(viewer)
  await assertTarget(input.targetType, input.targetId)
  const key = { userId, targetType: input.targetType, targetId: input.targetId, emoji: input.emoji }
  const existing = await prisma.communityReaction.findUnique({
    where: { userId_targetType_targetId_emoji: key },
    select: { id: true },
  })
  if (existing) {
    await prisma.communityReaction.delete({ where: { id: existing.id } })
  } else {
    await prisma.communityReaction.create({ data: key }).catch((err: unknown) => {
      // A double-tap racing itself: the reaction exists, which is what was asked for.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
    })
  }
  const summary = await reactionSummaries(input.targetType, [input.targetId], userId)
  return summary.get(input.targetId) ?? []
}

export async function createReport(
  viewer: CommunityViewer,
  input: { targetType: 'post' | 'reply'; targetId: string; reason: string; details?: string },
): Promise<void> {
  if (!viewer.userId) throw new CommunityError(401, 'Sign in to report.')
  await assertTarget(input.targetType, input.targetId)
  try {
    await prisma.communityReport.create({
      data: {
        reporterUserId: viewer.userId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        details: input.details || null,
      },
    })
  } catch (err) {
    // Already reported by this person — not an error to them.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return
    throw err
  }
}

export type ReportQueueItem = {
  id: string
  reason: string
  details: string | null
  createdAt: string
  reporterUsername: string
  targetType: 'post' | 'reply'
  targetId: string
  targetHref: string
  targetAuthorUsername: string | null
  targetPreview: string
  targetRemoved: boolean
}

export async function listPendingReports(viewer: CommunityViewer): Promise<ReportQueueItem[]> {
  requireModerator(viewer)
  const reports = await prisma.communityReport.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: { reporter: { select: { username: true } } },
  })
  const postIds = reports.filter((r) => r.targetType === 'post').map((r) => r.targetId)
  const replyIds = reports.filter((r) => r.targetType === 'reply').map((r) => r.targetId)
  const [posts, replies] = await Promise.all([
    prisma.communityPost.findMany({
      where: { id: { in: postIds } },
      select: { id: true, title: true, body: true, removedAt: true, author: { select: { username: true } } },
    }),
    prisma.communityReply.findMany({
      where: { id: { in: replyIds } },
      select: { id: true, postId: true, body: true, removedAt: true, author: { select: { username: true } } },
    }),
  ])
  const postById = new Map(posts.map((p) => [p.id, p]))
  const replyById = new Map(replies.map((r) => [r.id, r]))

  return reports.map((r) => {
    const targetType = r.targetType === 'reply' ? 'reply' : 'post'
    const post = targetType === 'post' ? postById.get(r.targetId) : undefined
    const reply = targetType === 'reply' ? replyById.get(r.targetId) : undefined
    return {
      id: r.id,
      reason: r.reason,
      details: r.details,
      createdAt: r.createdAt.toISOString(),
      reporterUsername: r.reporter.username,
      targetType,
      targetId: r.targetId,
      targetHref: post ? clubhousePostHref(post.id) : reply ? clubhousePostHref(reply.postId, reply.id) : '/clubhouse',
      targetAuthorUsername: post?.author.username ?? reply?.author.username ?? null,
      targetPreview: post ? `${post.title} — ${excerptOf(post.body, 160)}` : reply ? excerptOf(reply.body, 200) : '(deleted)',
      // Not `post?.removedAt ?? … ?? true`: a live post's removedAt is null, and `??` falls
      // through null, so every live target read as already removed and lost its Remove button.
      targetRemoved: post ? Boolean(post.removedAt) : reply ? Boolean(reply.removedAt) : true,
    }
  })
}

/**
 * `remove` takes the content down and closes every pending report on it at once;
 * `dismiss` closes just this one.
 */
export async function resolveReport(
  viewer: CommunityViewer,
  reportId: string,
  action: 'dismiss' | 'remove',
): Promise<void> {
  const modId = requireModerator(viewer)
  const report = await prisma.communityReport.findUnique({ where: { id: reportId } })
  if (!report) throw new CommunityError(404, 'Report not found')
  const now = new Date()

  if (action === 'dismiss') {
    await prisma.communityReport.update({
      where: { id: reportId },
      data: { status: 'dismissed', resolvedAt: now, resolvedByUserId: modId },
    })
    return
  }

  if (report.targetType === 'reply') {
    await removeReply(report.targetId, modId).catch((err) => {
      if (!(err instanceof CommunityError && err.status === 404)) throw err
    })
  } else {
    await prisma.communityPost.updateMany({
      where: { id: report.targetId, removedAt: null },
      data: { removedAt: now, removedByUserId: modId },
    })
  }
  await prisma.communityReport.updateMany({
    where: { targetType: report.targetType, targetId: report.targetId, status: 'pending' },
    data: { status: 'actioned', resolvedAt: now, resolvedByUserId: modId },
  })
}
