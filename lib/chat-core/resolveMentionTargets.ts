import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLeagueMemberUserIds } from '@/lib/league-chat/leagueMemberIds'

/**
 * Turns the @usernames typed in a message into the user ids of the people it may reach: members of
 * the room the message was posted in, never the sender.
 *
 * 🛑 WHY THIS EXISTS (owner's call 2026-09-25, "fix both security holes now"): the mentions route
 * looked every @name up across ALL AllFantasy accounts. Typing "@mike" in any chat notified and
 * emailed every account called mike on the platform — a stranger could be pinged from a league they
 * are not in, and anyone could use chat to send email to arbitrary users. A mention is addressed to
 * the room; the lookup is now confined to it.
 *
 * Case-insensitive, like the usernames people type. Returns [] for no tokens or no members, without
 * querying.
 */
export async function resolveMentionedMemberIds(args: {
  tokens: readonly string[]
  memberIds: readonly string[]
  senderUserId: string
}): Promise<string[]> {
  const tokens = Array.from(new Set(args.tokens.map((t) => t.trim().replace(/^@+/, '')).filter(Boolean)))
  const members = args.memberIds.filter((id) => id && id !== args.senderUserId)
  if (tokens.length === 0 || members.length === 0) return []
  const rows = await prisma.appUser.findMany({
    where: {
      id: { in: members },
      OR: tokens.map((username) => ({ username: { equals: username, mode: 'insensitive' as const } })),
    },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * The ids a league chat message stores in `mentionedUserIds` — the column the hub's mentions list
 * and the "@" badge search with `has: userId`. The league chat route stored the typed USERNAMES
 * there, so every mentions list came back empty. Resolved against this league's members only; a
 * failed lookup stores nothing rather than failing the send.
 */
export async function resolveLeagueMentionIds(leagueId: string, senderUserId: string, usernames: readonly string[]): Promise<string[]> {
  if (usernames.length === 0) return []
  try {
    return await resolveMentionedMemberIds({
      tokens: usernames,
      memberIds: await getLeagueMemberUserIds(leagueId),
      senderUserId,
    })
  } catch {
    return []
  }
}
