import { prisma } from '@/lib/prisma'
import {
  isStalePolicySkip,
  readAttemptRecord,
  type AttemptRecord,
} from '@/lib/notifications/playerNewsAttemptLedger'

/**
 * Put back the player-news rows a since-corrected rule wrongly silenced.
 *
 * 🛑 THE FAILURE THIS EXISTS FOR: A CLASSIFIER BUG WAS PERMANENT, AND SILENT.
 *
 * `dispatchPendingPlayerNewsNotifications` decides `eligible` from
 * `classifyPlayerNewsCategory` + `decidePlayerNewsEligibility` — keyword matching over free
 * text. When that is wrong in the skipping direction, the row is stamped
 * `notificationDispatchedAt`, leaves the candidate set, and no later sweep reconsiders it: the
 * rules are a pure function of content that is not changing, so every subsequent attempt
 * returns the same skip. Fixing the rule fixes nothing already stamped. Nobody is notified,
 * nothing goes red, and the counter says `policySkipped`, which is what a CORRECT skip says
 * too.
 *
 * That made classifier accuracy safety-critical: one wrong keyword permanently silenced a
 * category of news. This module is what takes it off that footing — a mistake becomes a thing
 * you fix and then RECOVER FROM, on the same day, with a bounded operator action.
 *
 * ⚠ IT DOES NOT SEND ANYTHING, AND THAT IS A DESIGN CONSTRAINT RATHER THAN AN OMISSION. It only
 * clears stamps. Whether those rows are then notified about is the sweep's decision, made under
 * the CURRENT rules, on its own schedule — so a review can never turn into a mass send by
 * itself, and a review run against a policy that was NOT actually fixed simply re-skips and
 * re-stamps every row it touched.
 *
 * ⚠ AND IT IS NOT WIRED TO A CRON, DELIBERATELY. Nothing calls it. It is the deliberate
 * counterpart to a rule change: bump `PLAYER_NEWS_POLICY_VERSION`, ship the fix, then run this.
 * A scheduled version would re-examine rows continuously to no effect in the overwhelmingly
 * common case where the policy has not moved.
 */

/**
 * How far back a review can reach.
 *
 * 🛑 BOUNDED BY THE LEDGER'S OWN TTL, NOT BY TASTE. Entries in `SportsDataCache` expire after
 * 48h, and an expired entry is unreadable — so beyond that horizon there is no record of WHY a
 * row was stamped, and a review would be guessing. Guessing here means clearing the stamp on a
 * row that was genuinely DELIVERED, which re-notifies everyone who already had it. The horizon
 * is enforced rather than documented.
 */
export const MAX_REVIEW_LOOKBACK_HOURS = 48

/** Rows examined per review, so one call cannot un-stamp an unbounded backlog. */
const DEFAULT_REVIEW_LIMIT = 200

export type PolicyReviewCandidate = {
  newsId: string
  headline: string
  /** The version the skip was recorded under; `null` for an entry written before versioning. */
  skippedUnderVersion: number | null
}

export type PolicyReviewResult = {
  /** Stamped rows inside the window whose ledger entry was read. */
  examined: number
  /** Rows whose ledger entry was missing, expired or unreadable — left alone. See below. */
  undecidable: number
  /** Stamped rows whose ledger says a policy skip under a superseded rules version. */
  candidates: PolicyReviewCandidate[]
  /** Whether the stamps were actually cleared. `false` for the default dry run. */
  applied: boolean
  /** Rows whose stamp was cleared. Zero on a dry run. */
  cleared: number
  /**
   * The lookback a following sweep needs in order to see the cleared rows.
   *
   * 🛑 CLEARING THE STAMP IS ONLY HALF OF PUTTING A ROW BACK. The sweep's candidate query is
   * `notificationDispatchedAt IS NULL **AND createdAt >= since**`, and production passes
   * `lookbackHours: 6`. An un-stamped row from nine hours ago is still invisible to it — the
   * review would report success and change nothing observable. This is the number to pass:
   * `dispatchPendingPlayerNewsNotifications({ lookbackHours: requiredSweepLookbackHours })`.
   */
  requiredSweepLookbackHours: number
}

/**
 * Find stamped rows whose ledger says they were skipped by superseded rules.
 *
 * ⚠ THE READ IS PER-ROW BY PRIMARY KEY, NOT A SCAN OF THE LEDGER. `SportsDataCache` is a shared
 * key/value table holding far more than this ledger, and its `data` is JSONB — filtering it by
 * `data->>'lastOutcome'` means a sequential scan of everything the whole application caches, to
 * find at most `limit` rows we can name up front. Driving from `player_news` instead costs
 * `limit` indexed lookups and reuses `readAttemptRecord`, so there is exactly one way to read a
 * ledger entry rather than two that can disagree.
 */
export async function findStalePolicySkips(input?: {
  withinHours?: number
  limit?: number
}): Promise<{ candidates: PolicyReviewCandidate[]; examined: number; undecidable: number; oldestAgeHours: number }> {
  const withinHours = Math.min(input?.withinHours ?? 24, MAX_REVIEW_LOOKBACK_HOURS)
  const limit = input?.limit ?? DEFAULT_REVIEW_LIMIT
  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000)

  const rows = await prisma.playerNewsRecord
    .findMany({
      where: { notificationDispatchedAt: { not: null, gte: since } },
      orderBy: { notificationDispatchedAt: 'desc' },
      take: limit,
      select: { id: true, headline: true, createdAt: true },
    })
    .catch(() => [] as Array<{ id: string; headline: string; createdAt: Date }>)

  const candidates: PolicyReviewCandidate[] = []
  let undecidable = 0
  let oldestCreatedAt: Date | null = null

  for (const row of rows) {
    const record: AttemptRecord | null = await readAttemptRecord(row.id)
    if (!record) {
      /*
       * 🛑 NO RECORD MEANS LEAVE IT ALONE, WHICH IS THE OPPOSITE OF HOW THE LEDGER FAILS OPEN
       * ELSEWHERE — AND BOTH ARE RIGHT, BECAUSE THE UNSAFE DIRECTION IS OPPOSITE TOO.
       *
       * In the sweep, an unreadable entry must not turn a retryable hold into a permanent drop,
       * so it reads as "no record, retry". Here, an unreadable entry cannot distinguish a policy
       * skip from a DELIVERY, and acting on it would clear the stamp on a story managers have
       * already been notified about — re-notifying every one of them. Silence is recoverable by
       * a later review; a duplicate blast is not recoverable at all.
       *
       * Counted rather than swallowed: a review that reports `undecidable` in the hundreds is
       * reaching past the ledger's TTL and should be run with a shorter window, not trusted.
       */
      undecidable++
      continue
    }
    if (!isStalePolicySkip(record)) continue
    candidates.push({
      newsId: row.id,
      headline: row.headline,
      skippedUnderVersion: typeof record.policyVersion === 'number' ? record.policyVersion : null,
    })
    if (!oldestCreatedAt || row.createdAt < oldestCreatedAt) oldestCreatedAt = row.createdAt
  }

  /*
   * Derived from `createdAt`, which is what the sweep filters on — NOT from
   * `notificationDispatchedAt`, which is what this function selects on. They differ by however
   * long the row waited to be swept, so using the stamp time here would under-state the lookback
   * and leave the oldest candidates invisible to the very sweep this number exists to size.
   * Rounded UP for the same reason.
   */
  const oldestAgeHours = oldestCreatedAt
    ? Math.ceil((Date.now() - oldestCreatedAt.getTime()) / (60 * 60 * 1000))
    : 0

  return { candidates, examined: rows.length, undecidable, oldestAgeHours }
}

/**
 * Review, and optionally clear, the stamps left by a superseded policy.
 *
 * Defaults to a DRY RUN: it reports what it would do and changes nothing. Pass `apply: true`
 * once the list looks right.
 */
export async function reviewPolicySkips(input?: {
  withinHours?: number
  limit?: number
  apply?: boolean
}): Promise<PolicyReviewResult> {
  const apply = input?.apply === true
  const { candidates, examined, undecidable, oldestAgeHours } = await findStalePolicySkips(input)

  let cleared = 0
  if (apply && candidates.length > 0) {
    const result = await prisma.playerNewsRecord
      .updateMany({
        where: { id: { in: candidates.map((c) => c.newsId) } },
        data: { notificationDispatchedAt: null },
      })
      .catch(() => null)
    /*
     * ⚠ REPORT WHAT THE DATABASE DID, NOT WHAT WAS ASKED. `cleared = candidates.length` would
     * report a full success over a failed `updateMany`, and the whole point of this module is
     * that a silent no-op in this area is indistinguishable from working correctly.
     */
    cleared = result?.count ?? 0
  }

  return {
    examined,
    undecidable,
    candidates,
    applied: apply,
    cleared,
    requiredSweepLookbackHours: oldestAgeHours,
  }
}
