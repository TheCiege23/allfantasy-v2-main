import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The retry ledger — the piece that makes a held news row recoverable.
 *
 * Before it, `PlayerNewsRecord.notificationDispatchedAt` was written for every row the sweep
 * looked at, so "held because the athlete has no identity row yet" and "delivered" were the
 * same durable state. The identity sync would add the row minutes later and nothing ever looked
 * again.
 */

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findUnique: h.findUnique, upsert: h.upsert } },
}))

import { PLAYER_NEWS_POLICY_VERSION } from '@/lib/notifications/playerNewsEligibility'
import {
  MAX_DISPATCH_ATTEMPTS,
  isRetryableOutcome,
  isStalePolicySkip,
  playerNewsContentHash,
  readAttemptRecord,
  recordAttempt,
  shouldStampTerminally,
  type AttemptRecord,
  type DispatchOutcome,
} from '@/lib/notifications/playerNewsAttemptLedger'

const stored = (over: Record<string, unknown> = {}) => ({
  expiresAt: new Date(Date.now() + 60_000),
  data: {
    contentHash: 'hash-a',
    attempts: 1,
    lastOutcome: 'no-identity-row',
    firstAttemptAt: '2026-09-10T00:00:00.000Z',
    lastAttemptAt: '2026-09-10T00:00:00.000Z',
    ...over,
  },
})

beforeEach(() => {
  h.findUnique.mockReset().mockResolvedValue(null)
  h.upsert.mockReset().mockResolvedValue({})
})

describe('terminal vs retryable', () => {
  it.each<DispatchOutcome>([
    'delivered',
    'policy-skipped',
    'empty-identity',
    'no-roster',
    // An audience was found and every member had it muted. Nobody was reached — but that is a
    // settled answer, not a delivery, and it must not be reported as one.
    'all-suppressed',
  ])(
    'treats %s as terminal',
    (outcome) => {
      expect(isRetryableOutcome(outcome)).toBe(false)
      expect(shouldStampTerminally(outcome, 1)).toBe(true)
    },
  )

  it.each<DispatchOutcome>([
    'no-identity-row',
    'ambiguous-identity',
    'conflicting-evidence',
    'dispatch-failed',
  ])('treats %s as retryable', (outcome) => {
    expect(isRetryableOutcome(outcome)).toBe(true)
    expect(shouldStampTerminally(outcome, 1)).toBe(false)
  })

  it('stamps a retryable outcome once the budget is spent', () => {
    // The anti-starvation bound: a permanently unresolvable row costs six lookups, not ninety-six.
    expect(shouldStampTerminally('no-identity-row', MAX_DISPATCH_ATTEMPTS - 1)).toBe(false)
    expect(shouldStampTerminally('no-identity-row', MAX_DISPATCH_ATTEMPTS)).toBe(true)
  })
})

describe('content hashing', () => {
  it('is stable for the same content', () => {
    expect(playerNewsContentHash('a', 'b')).toBe(playerNewsContentHash('a', 'b'))
  })

  it('changes when the headline or body changes', () => {
    const base = playerNewsContentHash('a', 'b')
    expect(playerNewsContentHash('a2', 'b')).not.toBe(base)
    expect(playerNewsContentHash('a', 'b2')).not.toBe(base)
  })

  it('treats a null body as an empty body, not as a missing field', () => {
    expect(playerNewsContentHash('a', null)).toBe(playerNewsContentHash('a', ''))
  })

  it('cannot be fooled by a separator inside the content', () => {
    /*
     * A hand-picked separator is a bug waiting for the day a headline contains it. JSON encoding
     * is unambiguous for any input — and this repo has already written a literal NUL byte into a
     * source file by reaching for one.
     */
    expect(playerNewsContentHash('a"b', '')).not.toBe(playerNewsContentHash('a', 'b'))
    expect(playerNewsContentHash('a', 'b')).not.toBe(playerNewsContentHash('ab', ''))
  })
})

describe('attempt counting', () => {
  it('starts at one when nothing is stored', async () => {
    expect(await recordAttempt('news-1', 'hash-a', 'no-identity-row')).toEqual({ attempts: 1, persisted: true })
  })

  it('increments while the content is unchanged', async () => {
    h.findUnique.mockResolvedValue(stored({ attempts: 3 }))
    expect(await recordAttempt('news-1', 'hash-a', 'no-identity-row')).toMatchObject({ attempts: 4 })
  })

  it('RESETS to one when the content changes', async () => {
    // A corrected story is a new decision; it must not inherit an exhausted budget.
    h.findUnique.mockResolvedValue(stored({ attempts: MAX_DISPATCH_ATTEMPTS }))
    expect(await recordAttempt('news-1', 'hash-DIFFERENT', 'no-identity-row')).toMatchObject({ attempts: 1 })
  })

  it('preserves firstAttemptAt across increments and resets it on new content', async () => {
    h.findUnique.mockResolvedValue(stored({ attempts: 2 }))
    await recordAttempt('news-1', 'hash-a', 'no-identity-row')
    expect(h.upsert.mock.calls[0][0].create.data.firstAttemptAt).toBe('2026-09-10T00:00:00.000Z')

    h.upsert.mockClear()
    await recordAttempt('news-1', 'hash-b', 'no-identity-row')
    expect(h.upsert.mock.calls[0][0].create.data.firstAttemptAt).not.toBe(
      '2026-09-10T00:00:00.000Z',
    )
  })
})

describe('the ledger fails OPEN', () => {
  it('reads as "no record" when the store throws, so the row is retried', async () => {
    // An unreadable ledger must not convert a retryable hold into a permanent one.
    h.findUnique.mockRejectedValue(new Error('cache down'))
    expect(await readAttemptRecord('news-1')).toBeNull()
  })

  it('ignores an expired entry', async () => {
    h.findUnique.mockResolvedValue({ ...stored(), expiresAt: new Date(Date.now() - 1000) })
    expect(await readAttemptRecord('news-1')).toBeNull()
  })

  it('ignores a malformed entry rather than trusting it', async () => {
    h.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), data: { junk: 1 } })
    expect(await readAttemptRecord('news-1')).toBeNull()
  })

  it('reports a FAILED WRITE so the caller does not retry unboundedly', async () => {
    /*
     * 🛑 THIS USED TO SWALLOW THE WRITE FAILURE AND RETURN THE COUNT ANYWAY. A persistently
     * failing upsert then meant every sweep read back nothing, recomputed `attempts = 1`, and
     * the cap was never reached — the row was re-examined on every sweep for its whole window,
     * paying an identity lookup and a roster fan-out each time. The only symptom was
     * `retryScheduled` staying high, which looks exactly like normal held work.
     */
    h.upsert.mockRejectedValue(new Error('cache down'))
    await expect(recordAttempt('news-1', 'hash-a', 'dispatch-failed')).resolves.toEqual({
      attempts: 1,
      persisted: false,
    })
  })

  it('does NOT stamp terminally just because the write failed', () => {
    /*
     * 🛑 THE VERSION THAT DID WAS AN OVERCORRECTION. One transient `sportsDataCache` timeout
     * turned a retryable hold into a permanent drop after a single attempt — and because read
     * and write share that table, a brief outage stamped every candidate in the sweep. The
     * unbounded loop it feared cannot happen: the sweep's `createdAt` look-back already ages a
     * row out of the candidate set on its own.
     */
    expect(shouldStampTerminally('no-identity-row', 1)).toBe(false)
    expect(shouldStampTerminally('no-identity-row', MAX_DISPATCH_ATTEMPTS)).toBe(true)
  })
})

describe('the policy version, which is what makes a skip recoverable', () => {
  const record = (over: Partial<AttemptRecord> = {}): AttemptRecord => ({
    contentHash: 'hash-a',
    attempts: 1,
    lastOutcome: 'policy-skipped',
    firstAttemptAt: '2026-09-10T00:00:00.000Z',
    lastAttemptAt: '2026-09-10T00:00:00.000Z',
    policyVersion: PLAYER_NEWS_POLICY_VERSION,
    ...over,
  })

  it('is written on EVERY outcome, not only on a skip', async () => {
    /*
     * A row put back by a policy review and then delivered has to come back carrying the current
     * version, or the next review finds it again and again. `isStalePolicySkip` only READS the
     * version for skips; it still has to be correct for the rest.
     */
    await recordAttempt('news-1', 'hash-a', 'delivered')
    expect(h.upsert.mock.calls[0][0].create.data.policyVersion).toBe(PLAYER_NEWS_POLICY_VERSION)
  })

  it('does not treat a current-version skip as stale', () => {
    expect(isStalePolicySkip(record())).toBe(false)
  })

  it('treats a superseded-version skip as stale', () => {
    expect(isStalePolicySkip(record({ policyVersion: PLAYER_NEWS_POLICY_VERSION - 1 }))).toBe(true)
  })

  it('treats a MISSING version as stale rather than as current', () => {
    /*
     * Entries written before this field existed are still live under the 48h TTL. Reading
     * `undefined` as "current" would silently exclude the oldest entries — which are the ones
     * most likely to predate the fix being rolled out.
     */
    expect(isStalePolicySkip(record({ policyVersion: undefined }))).toBe(true)
  })

  it.each<DispatchOutcome>(['delivered', 'no-roster', 'all-suppressed', 'no-identity-row'])(
    'never calls a %s outcome a stale policy skip, whatever its version',
    (lastOutcome) => {
      // Recovering a DELIVERED row means re-notifying everyone who already had it.
      expect(isStalePolicySkip(record({ lastOutcome, policyVersion: -1 }))).toBe(false)
    },
  )

  it('reads back through readAttemptRecord, which must not drop the field', async () => {
    // A round-trip, because the field is only useful if the read path preserves it.
    h.findUnique.mockResolvedValue(stored({ lastOutcome: 'policy-skipped', policyVersion: -1 }))
    const back = await readAttemptRecord('news-1')
    expect(back).not.toBeNull()
    expect(isStalePolicySkip(back!)).toBe(true)
  })
})

describe('a policy skip stays terminal FOR THE SWEEP', () => {
  it('is stamped on the first attempt, so it does not compete with identity holds', () => {
    /*
     * 🛑 RETRYING IT ON THE NEXT SWEEP WOULD BE PURE WASTE. The rules are a pure function of
     * content that is not changing, so attempt six answers exactly what attempt one did. What
     * changes the answer is a change to the RULES, which arrives on a deploy — long after the
     * row has aged out of the sweep's 6h `createdAt` window. Recovery lives in
     * `playerNewsPolicyReview`, off the hot path; a retry budget here would only crowd
     * `no-identity-row` holds out of a `take: 40` candidate window.
     */
    expect(isRetryableOutcome('policy-skipped')).toBe(false)
    expect(shouldStampTerminally('policy-skipped', 1)).toBe(true)
  })
})

describe('the key is scoped to the news row', () => {
  it('namespaces the cache key so it cannot collide with other cached data', async () => {
    await recordAttempt('news-1', 'hash-a', 'delivered')
    expect(h.upsert.mock.calls[0][0].where.cacheKey).toBe('player-news-dispatch:news-1')
  })
})
