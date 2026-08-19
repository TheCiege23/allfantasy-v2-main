/**
 * Linked-account resolution — "which AppUser rows are the same human?"
 *
 * AF has no way to prove two accounts belong to one person from account data alone:
 * three sign-ins on three different emails are indistinguishable from three people.
 * The ONE strong signal is a shared platform identity — the same Sleeper/ESPN/Yahoo
 * account cannot belong to two humans, so any AppUsers sharing one are the same human.
 *
 * That is deliberately the only signal used here. IP and device are NOT used: fantasy
 * leagues are routinely families and roommates on one router, and mobile carriers put
 * thousands of unrelated subscribers behind a single CGNAT address, so an IP match
 * would merge real distinct users. IP belongs in a review queue as corroboration for a
 * human decision, never as an automatic link.
 *
 * Coverage is the known limit: only users who have imported a platform account have any
 * identity to match on. Callers must treat "no siblings" as "no evidence", NOT as proof
 * that the user holds no other account.
 */
import { prisma } from "@/lib/prisma"
import type { Prisma, PrismaClient } from "@prisma/client"

type Db = PrismaClient | Prisma.TransactionClient

export type LinkedAccounts = {
  /** Every AppUser id known to be the same human, ALWAYS including the input id. */
  userIds: string[]
  /** Provider-side ids this human owns, e.g. Sleeper `user_id`. */
  platformUserIds: string[]
  /** False when the user has no platform identity at all — i.e. we simply cannot tell. */
  hasIdentityEvidence: boolean
}

/**
 * Resolve every AppUser that shares a platform identity with `userId`.
 *
 * Two hops, not one: find this user's platform identities, then find every other user
 * holding any of the SAME (platform, platformUserId) pairs. A single hop would only ever
 * return the user themselves.
 */
export async function resolveLinkedAccounts(
  userId: string,
  db: Db = prisma,
): Promise<LinkedAccounts> {
  const own = await db.platformIdentity.findMany({
    where: { userId },
    select: { platform: true, platformUserId: true },
  })

  if (own.length === 0) {
    return { userIds: [userId], platformUserIds: [], hasIdentityEvidence: false }
  }

  const siblings = await db.platformIdentity.findMany({
    where: {
      OR: own.map((i) => ({ platform: i.platform, platformUserId: i.platformUserId })),
    },
    select: { userId: true, platformUserId: true },
  })

  const userIds = new Set<string>([userId])
  const platformUserIds = new Set<string>()
  for (const s of siblings) {
    userIds.add(s.userId)
    platformUserIds.add(s.platformUserId)
  }

  return {
    userIds: [...userIds],
    platformUserIds: [...platformUserIds],
    hasIdentityEvidence: true,
  }
}

/**
 * Every id that could identify this human on a `Roster.platformUserId` column.
 *
 * ⚠ That column holds TWO different id spaces: the AF `AppUser.id` for on-site joins,
 * and the PROVIDER's user id for imported leagues. A gate that checks only one space
 * silently passes duplicates that arrived through the other, so both are returned here.
 */
export async function resolveRosterOwnerIds(userId: string, db: Db = prisma): Promise<string[]> {
  const linked = await resolveLinkedAccounts(userId, db)
  return [...new Set([...linked.userIds, ...linked.platformUserIds])]
}

/**
 * Does this human already hold a team in this league under ANY of their accounts?
 *
 * Returns the offending roster when one exists. The caller decides what to do — this
 * makes no policy choice of its own.
 */
export async function findExistingLeagueClaim(
  params: { userId: string; leagueId: string },
  db: Db = prisma,
): Promise<{ rosterId: string; ownerId: string; viaOtherAccount: boolean } | null> {
  const ownerIds = await resolveRosterOwnerIds(params.userId, db)
  if (ownerIds.length === 0) return null

  const roster = await db.roster.findFirst({
    where: { leagueId: params.leagueId, platformUserId: { in: ownerIds } },
    select: { id: true, platformUserId: true },
  })
  if (!roster) return null

  return {
    rosterId: roster.id,
    ownerId: roster.platformUserId,
    // A claim under the caller's own id is the ordinary "already joined" case; a claim
    // under a DIFFERENT id is the duplicate-account case this module exists to catch.
    viaOtherAccount: roster.platformUserId !== params.userId,
  }
}
