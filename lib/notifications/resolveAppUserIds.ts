import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Translate a mixed bag of member ids into AllFantasy user ids.
 *
 * ⚠ THE BUG THIS EXISTS TO KILL. `Roster.platformUserId` holds OUR user id on
 * a native league and the SLEEPER user id on an imported one. Every notifier
 * in this repo collected those and handed them to the dispatcher, which looks
 * profiles up by our id and — finding nothing — `continue`s. No error, no log,
 * no failed-send metric: every member of every imported league was skipped in
 * silence. Imported leagues are most of the funnel.
 *
 * The translation existed in exactly one place, inline in the big-play
 * notifier, whose comment spelled the whole failure out and then stayed put.
 * This is that logic, extracted, so the fix is not one notifier deep.
 *
 * Two set-based queries, both indexed, whatever the league size:
 *   1. which of these ids are already AppUser ids (native leagues, and any
 *      Sleeper manager whose platform id happens to be their AF id);
 *   2. of the rest, which resolve through `UserProfile.sleeperUserId`.
 *
 * A Sleeper manager who never linked an AllFantasy account has nowhere to
 * receive anything and is dropped — correctly, and reported by
 * `unresolved` so a caller can say so rather than quietly under-sending.
 */

export type ResolvedRecipients = {
  /** Ids the dispatcher can actually deliver to. */
  userIds: string[]
  /** Ids that matched no account — real people with no AF login, usually. */
  unresolved: string[]
}

export async function resolveRecipients(memberIds: string[]): Promise<ResolvedRecipients> {
  const ids = [...new Set(memberIds.filter((v) => typeof v === 'string' && v.length > 0))]
  if (ids.length === 0) return { userIds: [], unresolved: [] }

  /*
   * Two sets, and conflating them was a bug this file's own test caught: the
   * INPUT ids that found an account are not the same strings as the OUTPUT
   * user ids, because translating a Sleeper id yields a different id. Deciding
   * "unresolved" from the output set marks every successfully translated
   * member as unreachable.
   */
  const resolved = new Set<string>()
  const matchedInputs = new Set<string>()

  const direct = await prisma.appUser
    .findMany({ where: { id: { in: ids } }, select: { id: true } })
    .catch(() => [] as { id: string }[])
  for (const u of direct) {
    resolved.add(u.id)
    matchedInputs.add(u.id)
  }

  const remainder = ids.filter((id) => !matchedInputs.has(id))
  if (remainder.length > 0) {
    const profiles = await prisma.userProfile
      .findMany({
        where: { sleeperUserId: { in: remainder } },
        select: { userId: true, sleeperUserId: true },
      })
      .catch(() => [] as { userId: string; sleeperUserId: string | null }[])
    const bySleeperId = new Map<string, string>()
    for (const p of profiles) {
      if (p.sleeperUserId) bySleeperId.set(p.sleeperUserId, p.userId)
    }
    for (const id of remainder) {
      const mapped = bySleeperId.get(id)
      if (mapped) {
        resolved.add(mapped)
        matchedInputs.add(id)
      }
    }
  }

  const userIds = [...resolved]
  const unresolved = ids.filter((id) => !matchedInputs.has(id))
  return { userIds, unresolved }
}

/** The common case: just the deliverable ids. */
export async function resolveAppUserIds(memberIds: string[]): Promise<string[]> {
  return (await resolveRecipients(memberIds)).userIds
}
