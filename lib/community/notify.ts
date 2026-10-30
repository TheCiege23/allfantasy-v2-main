import 'server-only'
import { prisma } from '@/lib/prisma'
import { parseAtMentions } from '@/lib/chat-core/mentionPrivacyFilter'
import { getBlockedEitherWayUserIds } from '@/lib/moderation'
import { createPlatformNotification } from '@/lib/platform/notification-service'
import { clubhousePostHref } from './channels'

/**
 * Clubhouse notifications: "someone replied to your post" and "someone mentioned you".
 * Without these nobody comes back to a thread, which is the whole difference between a
 * board and a pile of posts.
 *
 * Every notification carries a `sourceKey`, so a retried write never pings twice.
 * Callers treat all of this as fire-and-forget: by the time it runs the post or reply
 * is already saved.
 */

export const MAX_MENTION_NOTIFICATIONS = 10

function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** True when a notification was written (or already existed). */
export async function notifyPostAuthorOfReply(args: {
  post: { id: string; authorUserId: string; title: string }
  replyId: string
  replierUserId: string
  replierName: string
  body: string
}): Promise<boolean> {
  const { post, replyId, replierUserId } = args
  if (post.authorUserId === replierUserId) return false
  return createPlatformNotification({
    userId: post.authorUserId,
    type: 'community_reply',
    title: `${args.replierName} replied to “${snippet(post.title, 60)}”`,
    body: snippet(args.body),
    meta: { actionHref: clubhousePostHref(post.id, replyId), postId: post.id, replyId },
    sourceKey: `community:reply:${replyId}:${post.authorUserId}`,
  })
}

/** Unique, lower-cased usernames from `@name` tokens, without `@all`/`@global`/`@chimmy`. */
export function mentionedUsernames(text: string, max = MAX_MENTION_NOTIFICATIONS): string[] {
  const seen = new Set<string>()
  for (const name of parseAtMentions(text).userMentions) {
    seen.add(name.toLowerCase())
    if (seen.size >= max) break
  }
  return Array.from(seen)
}

/**
 * `@all` deliberately does nothing here: on a public board it would mean everyone who
 * has ever signed up.
 */
export async function notifyCommunityMentions(args: {
  text: string
  actorUserId: string
  actorName: string
  postId: string
  postTitle: string
  replyId?: string
  skipUserIds?: Set<string>
  sourceKeyBase: string
}): Promise<number> {
  const names = mentionedUsernames(args.text)
  if (names.length === 0) return 0

  const users = await prisma.appUser.findMany({
    where: { OR: names.map((n) => ({ username: { equals: n, mode: 'insensitive' as const } })) },
    select: { id: true },
    take: MAX_MENTION_NOTIFICATIONS,
  })
  const blocked = await getBlockedEitherWayUserIds(args.actorUserId)
  const skip = args.skipUserIds ?? new Set<string>()

  let sent = 0
  for (const u of users) {
    if (u.id === args.actorUserId || skip.has(u.id) || blocked.has(u.id)) continue
    const ok = await createPlatformNotification({
      userId: u.id,
      type: 'community_mention',
      title: `${args.actorName} mentioned you in “${snippet(args.postTitle, 60)}”`,
      body: snippet(args.text),
      meta: { actionHref: clubhousePostHref(args.postId, args.replyId), postId: args.postId, replyId: args.replyId },
      sourceKey: `${args.sourceKeyBase}:mention:${u.id}`,
    })
    if (ok) sent += 1
  }
  return sent
}
