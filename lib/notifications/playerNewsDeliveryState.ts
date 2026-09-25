import { prisma } from '@/lib/prisma'

/**
 * Which recipients have already been notified about a given version of a given story.
 *
 * 🛑 THIS REPLACES THREE FAILED ATTEMPTS AT THE SAME DECISION, AND THE REASON THEY FAILED IS
 * THAT THEY ALL USED A ROW-LEVEL PROXY FOR A PER-RECIPIENT QUESTION.
 *
 *   v1  `attempts > 0`                     — counted CONSIDERATIONS, so a row merely HELD for
 *                                            `no-identity-row` looked like a re-send, and the
 *                                            one real notification went out with email stripped.
 *   v2  `outcomeDispatched(lastOutcome)`   — `lastOutcome` is a single slot overwritten every
 *                                            sweep, so a `recipients-unavailable` landing
 *                                            between two dispatches reset it and re-emailed 30
 *                                            managers who already had it.
 *
 * Both were wrong in BOTH directions at once — re-billing people who had been reached, and
 * denying a first email to people who had not — because one boolean cannot describe an audience
 * that changes between sweeps. It changes routinely: the identity sync back-fills an `espnId`
 * and eleven new managers appear on a retry.
 *
 * ⚠ THE STATE ALREADY EXISTED AND NOTHING WAS READING IT. `dispatchNotification` writes
 * `PlatformNotification.sourceKey = ${dedupePrefix}:${userId}` on every in-app row, and that
 * column is UNIQUE — `createPlatformNotification` does `findUnique` on it and skips the insert
 * when it hits. So "did this user already get this story?" is a durable, per-recipient fact
 * sitting in the database on the row we wrote. This module asks it instead of guessing.
 *
 * ⚠ NO NEW TABLE AND NO NEW WRITE. That matters beyond tidiness: a second store would have to
 * be kept consistent with the notification rows, and any drift between them reproduces exactly
 * the class of bug this replaces.
 */

/**
 * The dedupe prefix for one version of one story.
 *
 * ⚠ THE CONTENT HASH IS IN THE KEY, AND THAT IS WHAT MAKES A CORRECTION WORK. The blueprint's
 * early-report policy means a story is published, corrected, then confirmed. A corrected story
 * is a NEW decision: it must reach everyone again, on every channel, including people who
 * already saw the first version. Putting the hash in the prefix gets that for free — new keys,
 * no prior rows, full channels — instead of needing a separate reset that the previous designs
 * kept forgetting to apply.
 */
export function playerNewsDedupePrefix(newsId: string, contentHash: string): string {
  return `player-news:${newsId}:${contentHash.slice(0, 12)}`
}

export type DeliveryStateLookup = {
  /** Users who already have an in-app row for this exact story version. */
  alreadyNotified: Set<string>
  /**
   * The lookup itself failed, so `alreadyNotified` is empty for lack of knowledge rather than
   * because nobody has been reached.
   *
   * ⚠ CALLERS MUST NOT READ AN EMPTY SET AS "NOBODY HAS BEEN NOTIFIED" WITHOUT CHECKING THIS.
   * That conflation is the whole family of bugs this module exists to end.
   */
  degraded: boolean
}

/**
 * Look up, for one story version, which of these users already has a notification row.
 *
 * ⚠ ONE INDEXED QUERY, NOT ONE PER USER. `sourceKey` is unique, so an `in` over the composed
 * keys is a single index probe per key and the audience is bounded by the roster fan-out.
 */
export async function lookupAlreadyNotified(
  prefix: string,
  userIds: readonly string[],
): Promise<DeliveryStateLookup> {
  if (userIds.length === 0) return { alreadyNotified: new Set(), degraded: false }

  const keyForUser = new Map(userIds.map((u) => [`${prefix}:${u}`, u]))
  try {
    const rows = await prisma.platformNotification.findMany({
      where: { sourceKey: { in: [...keyForUser.keys()] } },
      select: { sourceKey: true },
    })
    const alreadyNotified = new Set<string>()
    for (const r of rows) {
      const userId = r.sourceKey ? keyForUser.get(r.sourceKey) : undefined
      if (userId) alreadyNotified.add(userId)
    }
    return { alreadyNotified, degraded: false }
  } catch {
    /*
     * ⚠ FAILS TOWARD DELIVERING, DELIBERATELY, AND THE COST IS BOUNDED.
     *
     * With no knowledge of who has been reached, the two errors available are "send a duplicate
     * email" and "never send the only email". The second is unrecoverable for the user; the
     * first is bounded by `MAX_DISPATCH_ATTEMPTS` and by the in-app row still being deduped in
     * the database regardless of what this returns. `degraded` is reported so the choice is
     * visible rather than silent.
     */
    return { alreadyNotified: new Set(), degraded: true }
  }
}

/**
 * The channels to suppress for one recipient.
 *
 * In-app and push are never suppressed: the in-app row is deduped by `sourceKey` in the database
 * and web push collapses on its `tag`, so re-sending them is free and keeps a retry useful.
 * Email and SMS have no idempotency key anywhere in the stack, cost money, and burn sender
 * reputation — they are the only two that must not be repeated.
 */
export function channelsToSkipFor(
  userId: string,
  state: DeliveryStateLookup,
): { email: true; sms: true } | undefined {
  return state.alreadyNotified.has(userId) ? { email: true, sms: true } : undefined
}
