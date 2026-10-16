import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { PLAYER_NEWS_POLICY_VERSION } from '@/lib/notifications/playerNewsEligibility'

/**
 * Per-news-row dispatch bookkeeping: how many times we have tried, on what content, and why we
 * stopped.
 *
 * 🛑 THE PROBLEM THIS SOLVES IS THAT "CONSIDERED" AND "DELIVERED" WERE ONE TIMESTAMP.
 *
 * `PlayerNewsRecord.notificationDispatchedAt` is the only durable state the sweep had, and it
 * was written for EVERY row the sweep looked at — a policy skip, an identity it could not
 * resolve, a dispatch that threw, and a genuine delivery all stamped the same column. So:
 *
 *   - a story held because the athlete had no `PlayerIdentityMap` row was never reconsidered,
 *     even after the identity sync added that row minutes later;
 *   - a dispatch that threw before any durable handoff was never retried;
 *   - and none of it was distinguishable afterwards.
 *
 * Counters in the sweep's return value do not fix that. A counter is gone when the process
 * exits; the record has to be recoverable.
 *
 * ⚠ NO NEW TABLE, DELIBERATELY. This reuses `SportsDataCache` — the durable, expiring key/value
 * store this repo already runs, already backs up and already purges — because a migration is
 * not pushable work here and a correctness fix that cannot ship is not a fix. The one thing it
 * genuinely cannot do is recorded in `prisma/migrations-pending/` rather than pretended away:
 * see "What this cannot do" below.
 *
 * ⚠ AND IT IS A LEDGER, NOT A LOCK. Two overlapping sweeps can both read the same entry and
 * both retry the same row. That is acceptable here — the downstream `dedupePrefix` collapses
 * the duplicate in-app row — and it is NOT acceptable for the outbox, which is why atomic claim
 * tokens are Batch B's job and not this module's.
 */

/** How long an entry outlives the sweep's own look-back window, so a retry can find it. */
const LEDGER_TTL_MS = 48 * 60 * 60 * 1000

/**
 * How many times one news row may be retried before we give up and stamp it terminally.
 *
 * ⚠ THIS IS THE ANTI-STARVATION BOUND AND IT IS THE REASON THE LEDGER EXISTS AT ALL. Leaving a
 * retryable row unstamped means it re-enters the candidate window on every sweep — every 15
 * minutes, for the whole 24-hour look-back. Six attempts is enough for an identity sync (which
 * runs far more often than that) to repair a `no-identity-row` hold, and small enough that a
 * permanently unresolvable row costs six identity lookups rather than ninety-six.
 */
export const MAX_DISPATCH_ATTEMPTS = 6

export type DispatchOutcome =
  | 'delivered'
  | 'policy-skipped'
  | 'empty-identity'
  | 'no-identity-row'
  | 'ambiguous-identity'
  | 'conflicting-evidence'
  | 'no-roster'
  | 'all-suppressed'
  | 'no-searchable-identity'
  | 'recipients-unavailable'
  | 'dispatch-failed'

/**
 * Which outcomes can change on their own, and which are settled.
 *
 * 🛑 THE DISTINCTION IS ABOUT WHETHER THE WORLD CAN REPAIR IT, NOT ABOUT SUCCESS.
 *
 * TERMINAL — nothing that happens later changes the answer for THIS story:
 *   `delivered`        the handoff succeeded; repeating it is a duplicate notification.
 *   `policy-skipped`   the policy is deterministic over content that is not changing.
 *
 *                      🛑 TERMINAL *FOR THE SWEEP*, NOT UNRECOVERABLE — AND THE DIFFERENCE IS
 *                      THE WHOLE REASON `policyVersion` IS RECORDED BELOW. Retrying a policy
 *                      skip on the next sweep is pure waste: the rules are a pure function of
 *                      content that has not changed, so attempt six answers exactly what
 *                      attempt one did. What genuinely changes the answer is a change to the
 *                      RULES, and that arrives on a deploy, hours or days later — by which time
 *                      the row has aged out of the sweep's `createdAt >= since` window (6h in
 *                      production) and no amount of retry budget can reach it.
 *
 *                      ⚠ SO A PER-SWEEP RETRY WOULD HAVE BOUGHT ~30 MINUTES AND COST THE SLOTS
 *                      THE HOLDS ACTUALLY NEED. Production runs every 15 minutes with
 *                      `lookbackHours: 6` and `take: 40` — 24 sweeps over a window holding
 *                      ~120 rows, most of them policy skips. Leaving them unstamped would put
 *                      them in permanent competition with `no-identity-row` holds, which are
 *                      the retries that a background sync really does repair. Recovery for this
 *                      outcome belongs OUT of the sweep's hot path:
 *                      `lib/notifications/playerNewsPolicyReview.ts`.
 *
 *   `empty-identity`   no name and no id. There is nothing to resolve, ever.
 *   `no-roster`        nobody rostered the athlete when the story was current. A manager who
 *                      adds them tomorrow does not need yesterday's headline, and re-checking
 *                      for 24 hours to send stale news is worse than not sending it.
 *   `all-suppressed`   an audience was found and EVERY member of it had the category, the
 *                      league or notifications globally muted. Nobody was reached, and that is
 *                      the correct outcome — but it is not a delivery, and calling it one is
 *                      how `{delivered: 0, suppressed: 40}` got reported as success.
 *
 * RETRYABLE — a later repair genuinely changes the answer:
 *   `no-identity-row`        the identity sync adds the athlete.
 *   `ambiguous-identity`     a duplicate group is disambiguated or merged.
 *   `conflicting-evidence`   the id and the name stop disagreeing.
 *   `dispatch-failed`        a recipient's dispatch threw before any durable handoff.
 *   `no-searchable-identity` the identity carries no id in ANY namespace we can search, so no
 *                            roster store was queried at all. The sync back-filling a
 *                            `sleeperId` changes the answer — this is emphatically NOT the same
 *                            as "we looked and nobody rosters them".
 *   `recipients-unavailable` a roster query FAILED. The empty audience is incomplete, not empty.
 *
 * ⚠ THE LAST TWO WERE BOTH REPORTED AS `no-roster` AND THEREFORE STAMPED FOREVER. One statement
 * timeout permanently dropped a notification for a widely-rostered player.
 */
const RETRYABLE_OUTCOMES: ReadonlySet<DispatchOutcome> = new Set([
  'no-identity-row',
  'ambiguous-identity',
  'conflicting-evidence',
  'dispatch-failed',
  'no-searchable-identity',
  'recipients-unavailable',
])

export function isRetryableOutcome(outcome: DispatchOutcome): boolean {
  return RETRYABLE_OUTCOMES.has(outcome)
}

/*
 * 🛑 `outcomeDispatched` WAS HERE AND HAS BEEN DELETED, NOT DEPRECATED.
 *
 * It answered "has this row been dispatched before?" from `lastOutcome`, a single slot
 * overwritten every sweep, and the caller used it to decide whether to suppress email and SMS.
 * That is a per-RECIPIENT question and the row cannot answer it: the audience changes between
 * sweeps, so the same boolean both re-billed people who had been reached and denied a first
 * email to people who had not.
 *
 * `lib/notifications/playerNewsDeliveryState.ts` answers it per recipient, from the
 * `PlatformNotification.sourceKey` rows we actually wrote. Leaving this function in place would
 * leave a second, weaker answer to the same question for someone to reach for.
 */

export type AttemptRecord = {
  contentHash: string
  attempts: number
  lastOutcome: DispatchOutcome
  firstAttemptAt: string
  lastAttemptAt: string
  /**
   * Which revision of the notify/skip rules produced `lastOutcome`.
   *
   * ⚠ OPTIONAL, BECAUSE ENTRIES WRITTEN BEFORE THIS FIELD EXISTED ARE STILL LIVE. The ledger
   * has a 48h TTL, so they age out on their own — but until they do, `undefined` has to mean
   * something safe. It means "unknown, therefore stale": see `isStalePolicySkip`.
   */
  policyVersion?: number
}

/**
 * Was this row skipped by a policy revision that is no longer the current one?
 *
 * 🛑 THIS IS THE ONE QUESTION `notificationDispatchedAt` CANNOT ANSWER, AND THE REASON A
 * CLASSIFIER BUG USED TO BE PERMANENT. That column carries a single meaning — "do not look at
 * this again" — for a delivery, a policy skip and an exhausted hold alike. Once a rule is
 * corrected there is nothing in `player_news` that distinguishes the stories the OLD rule wrongly
 * silenced from the ones that were correctly delivered, so the only safe move was to leave all of
 * them alone. The ledger has always recorded `lastOutcome`; recording the rules' version
 * alongside it is what makes the pair actionable.
 *
 * ⚠ AN ABSENT VERSION COUNTS AS STALE, DELIBERATELY. The alternative — treating "unknown" as
 * current — silently excludes exactly the oldest entries, which are the ones most likely to
 * predate the fix being rolled out. The cost of being wrong in this direction is one extra
 * re-examination that skips the row again; the cost in the other direction is the silence this
 * whole mechanism exists to break.
 */
export function isStalePolicySkip(record: AttemptRecord): boolean {
  return record.lastOutcome === 'policy-skipped' && record.policyVersion !== PLAYER_NEWS_POLICY_VERSION
}

function ledgerKey(newsId: string): string {
  return `player-news-dispatch:${newsId}`
}

/**
 * A stable fingerprint of the content we made a decision about.
 *
 * ⚠ JSON-ENCODED RATHER THAN CONCATENATED. A separator character chosen by hand is a bug
 * waiting for the day a headline contains it — and this repo has already written a literal NUL
 * byte into a source file by reaching for `\x00` as a separator. `JSON.stringify` of an array
 * is unambiguous for any input and needs no separator at all.
 */
export function playerNewsContentHash(headline: string, body: string | null | undefined): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([headline ?? '', body ?? '']))
    .digest('hex')
    .slice(0, 32)
}

export async function readAttemptRecord(newsId: string): Promise<AttemptRecord | null> {
  try {
    const row = await prisma.sportsDataCache.findUnique({
      where: { cacheKey: ledgerKey(newsId) },
      select: { data: true, expiresAt: true },
    })
    if (!row) return null
    if (row.expiresAt < new Date()) return null
    const d = row.data as Partial<AttemptRecord> | null
    if (!d || typeof d.contentHash !== 'string' || typeof d.attempts !== 'number') return null
    return d as AttemptRecord
  } catch {
    /*
     * ⚠ FAILS OPEN AS "NO RECORD", WHICH MEANS THE ROW IS RETRIED. An unreadable ledger must
     * not silently convert a retryable hold into a permanent one — that is the failure this
     * module was built to remove, reintroduced through the back door.
     */
    return null
  }
}

/**
 * Record this sweep's outcome and return the resulting attempt count.
 *
 * ⚠ A CONTENT CHANGE RESETS THE COUNT TO ONE. The blueprint's early-report policy means a story
 * can be corrected or upgraded in place, and a corrected story is a NEW decision — it must not
 * inherit the exhausted attempt budget of the version it replaced.
 */
export type RecordedAttempt = {
  /** The count INCLUDING this attempt. */
  attempts: number
  /**
   * Whether the count was durably written.
   *
   * 🛑 `false` MEANS THE BOUND IS NOT BEING ENFORCED, AND THE CALLER MUST NOT PRETEND OTHERWISE.
   * `recordAttempt` used to swallow the write failure and return the count it had computed, so
   * a persistently failing upsert meant every sweep read back nothing, recomputed `attempts =
   * 1`, and `shouldStampTerminally` never reached the cap — the row was re-examined on every
   * sweep for its whole 24h window, at an identity lookup plus a roster fan-out each time. The
   * module header calls this bound "THE REASON THE LEDGER EXISTS AT ALL"; a swallowed write
   * removed it, and the only symptom was `retryScheduled` staying high, which looks exactly
   * like normal held work.
   */
  persisted: boolean
}

export async function recordAttempt(
  newsId: string,
  contentHash: string,
  outcome: DispatchOutcome,
): Promise<RecordedAttempt> {
  const now = new Date()
  const previous = await readAttemptRecord(newsId)
  const sameContent = previous?.contentHash === contentHash
  const attempts = sameContent ? previous!.attempts + 1 : 1

  const record: AttemptRecord = {
    contentHash,
    attempts,
    lastOutcome: outcome,
    firstAttemptAt: sameContent ? previous!.firstAttemptAt : now.toISOString(),
    lastAttemptAt: now.toISOString(),
    /*
     * Stamped on EVERY outcome, not only on a skip. A row re-examined by a policy review and
     * then delivered must come back carrying the current version, or the next review finds it
     * again and again — `isStalePolicySkip` gates on the outcome, so the version is only read
     * for skips, but it has to be CORRECT for all of them.
     */
    policyVersion: PLAYER_NEWS_POLICY_VERSION,
  }

  try {
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: ledgerKey(newsId) },
      update: { data: record as unknown as object, expiresAt: new Date(now.getTime() + LEDGER_TTL_MS) },
      create: {
        cacheKey: ledgerKey(newsId),
        data: record as unknown as object,
        expiresAt: new Date(now.getTime() + LEDGER_TTL_MS),
      },
    })
  } catch {
    /*
     * Reported, not swallowed. The caller stamps terminally when the count cannot be persisted,
     * because an unbounded retry loop is worse than giving up on one story — and it is
     * invisible, which is what makes it worse.
     */
    return { attempts, persisted: false }
  }
  return { attempts, persisted: true }
}

/**
 * Should this row be stamped terminally now?
 *
 * `true` means write `notificationDispatchedAt` and stop reconsidering it. `false` means leave
 * it unstamped so the next sweep picks it up again.
 */
export function shouldStampTerminally(outcome: DispatchOutcome, attempts: number): boolean {
  if (!isRetryableOutcome(outcome)) return true
  /*
   * 🛑 A FAILED LEDGER WRITE NO LONGER STAMPS THE ROW, AND THE VERSION THAT DID WAS AN
   * OVERCORRECTION WORSE THAN THE BUG IT ANSWERED.
   *
   * The reasoning was: if the count cannot be persisted, "retry" means "retry without limit".
   * But that turned ONE transient `sportsDataCache` timeout into a permanent drop after a
   * single attempt — and because `readAttemptRecord` and `recordAttempt` share that table, a
   * brief outage stamped every candidate in the sweep at once. Nobody notified, from a blip.
   *
   * ⚠ AND THE UNBOUNDED LOOP IT FEARED CANNOT HAPPEN. Re-examination is already bounded
   * independently of this ledger by the sweep's `createdAt >= since` look-back — a row ages out
   * of the candidate set on its own. The cap exists to stop a resolvable-looking row being
   * re-examined ~96 times inside that window, which needs the store to be failing
   * PERSISTENTLY; a single failure costs one extra examination, which is the trade the module
   * header already describes.
   *
   * `persisted` is still returned by `recordAttempt` and is worth reporting; it is simply not
   * grounds for giving up on a story.
   */
  return attempts >= MAX_DISPATCH_ATTEMPTS
}

/* ---------------------------------------------------------------------------
 * What this cannot do, stated rather than left to be discovered
 * ---------------------------------------------------------------------------
 *
 * 🛑 A ROW THAT WAS ALREADY DELIVERED CANNOT BE RECONSIDERED WHEN ITS CONTENT CHANGES.
 *
 * The sweep's candidate query is `WHERE notificationDispatchedAt IS NULL`, so once a row is
 * stamped it leaves the candidate set permanently — and `PlayerNewsRecord` has **no
 * `updatedAt` column**, so there is nothing to compare the stamp against even if the query
 * wanted to. The hash above detects a content change on rows still in the window; it cannot
 * bring a stamped row back.
 *
 * That needs the smallest possible schema change, which is PREPARED AND NOT APPLIED:
 *
 *     prisma/migrations-pending/20260910_player_news_updated_at/migration.sql
 *
 * It adds `updated_at` (defaulting to `created_at` for existing rows, so nothing becomes
 * retroactively eligible) plus a supporting index, after which the query becomes
 * `notificationDispatchedAt IS NULL OR updated_at > notification_dispatched_at`.
 *
 * ⚠ APPLYING IT IS A SEPARATE DECISION AND IS NOT THIS BATCH'S TO MAKE. Landing code that
 * assumes a column production does not have raises P2022 at runtime — the generated client
 * selects a column the database has never heard of — so the query is deliberately NOT written
 * against `updated_at` yet. Migration first, then the query, in that order.
 *
 * ⚠ NOTE WHAT THAT DOES *NOT* SAY: that a stamped row can never be reconsidered at all.
 * `notificationDispatchedAt` is writable, so clearing it puts a row back in the candidate set —
 * what is missing above is a way to know WHICH rows deserve that. For a content change, nothing
 * knows (hence the migration). For a policy change, `isStalePolicySkip` knows, which is what
 * `lib/notifications/playerNewsPolicyReview.ts` is built on. The two are independent: applying
 * the migration would not make the policy review unnecessary, and the policy review does not
 * reduce the case for the migration.
 */
