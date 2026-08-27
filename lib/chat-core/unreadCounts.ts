import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * UNREAD AND MENTION COUNTS FOR THE COMMS LAUNCHER.
 *
 * ⚠ THE BADGE WAS HARDCODED TO ZERO. `CommsDock` has rendered an unread count
 * since it was written, and `chatUnread` appears in exactly three files — read
 * in all three, written in none. The one number capable of pulling somebody
 * back into the app said "nothing happened", permanently.
 *
 * ⚠ MENTIONS ARE COUNTED SEPARATELY, ON PURPOSE. A message addressed to you is
 * a different thing from a message in a room you happen to be in: it needs a
 * reply, and the research on notification design is blunt that collapsing the
 * two is how a badge becomes noise people clear without reading. They are
 * returned as separate numbers so the UI can shout about one and whisper the
 * other.
 *
 * ⚠ MUTED THREADS STILL COUNT, BUT QUIETLY. A muted conversation with unread
 * messages is a real state — it is not "read". It is excluded from the number
 * that drives the badge and kept in `mutedUnread`, so a muted thread can look
 * unread in a list without lighting up the launcher.
 *
 * ⚠ YOUR OWN MESSAGES ARE NEVER UNREAD. Obvious, and easy to get wrong: the
 * naive "created after my last read" query counts the message you just sent.
 */

export type ChatUnread = {
  /** Drives the launcher badge: unmuted, not yours, newer than your last read. */
  total: number
  /** Messages that name you. Always a subset of what was counted. */
  mentions: number
  /** Unread in threads you muted — a real state, deliberately not badged. */
  mutedUnread: number
}

const EMPTY: ChatUnread = { total: 0, mentions: 0, mutedUnread: 0 }

/**
 * How many unread messages this person has across their DMs and huddles.
 *
 * Returns zeroes on any failure. A badge is decoration on a working app; a page
 * that failed to render because a count could not be taken would be a far worse
 * trade, and a wrong-but-small badge is better than a 500.
 */
export async function getChatUnread(userId: string | null | undefined): Promise<ChatUnread> {
  if (!userId) return EMPTY

  try {
    const memberships = await prisma.platformChatThreadMember.findMany({
      where: { userId, isBlocked: false },
      select: { threadId: true, lastReadAt: true, isMuted: true },
      take: 200,
    })

    if (memberships.length === 0) return EMPTY

    let total = 0
    let mentions = 0
    let mutedUnread = 0

    /*
     * One query per thread rather than one clever query over all of them: the
     * read watermark differs per thread, so a single query would need a CASE
     * over every membership. Bounded by the take above, and these are indexed on
     * (threadId, createdAt).
     */
    for (const m of memberships) {
      const newerThan = m.lastReadAt ?? new Date(0)

      const where = {
        threadId: m.threadId,
        createdAt: { gt: newerThan },
        /* Never your own, and never a private row addressed to somebody else. */
        senderUserId: { not: userId },
        OR: [{ isPrivate: false }, { isPrivate: true, visibleToUserId: userId }],
      }

      const count = await prisma.platformChatMessage.count({ where }).catch(() => 0)
      if (count === 0) continue

      if (m.isMuted) {
        mutedUnread += count
        continue
      }

      total += count

      const mentioned = await prisma.platformChatMessage
        .count({ where: { ...where, mentionedUserIds: { has: userId } } })
        .catch(() => 0)
      mentions += mentioned
    }

    return { total, mentions, mutedUnread }
  } catch {
    return EMPTY
  }
}
