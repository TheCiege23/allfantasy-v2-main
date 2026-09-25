import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recovering the rows a wrong rule silenced.
 *
 * A policy skip stamps `notificationDispatchedAt` and leaves the sweep's candidate set forever —
 * and because the rules are a pure function of unchanged content, no retry can ever produce a
 * different answer. Correcting the rule therefore fixes nothing already stamped. This module is
 * what puts those rows back, and these tests pin the two properties that make it safe to run:
 * it never touches a row it cannot prove was a stale skip, and it reports what the database
 * actually did.
 */

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findUnique: h.findUnique, upsert: h.upsert },
    playerNewsRecord: { findMany: h.findMany, updateMany: h.updateMany },
  },
}))

import { PLAYER_NEWS_POLICY_VERSION } from '@/lib/notifications/playerNewsEligibility'
import {
  MAX_REVIEW_LOOKBACK_HOURS,
  findStalePolicySkips,
  reviewPolicySkips,
} from '@/lib/notifications/playerNewsPolicyReview'

const HOUR = 60 * 60 * 1000

/** A `player_news` row as the review's own query selects it. */
const newsRow = (id: string, ageHours = 1) => ({
  id,
  headline: `headline ${id}`,
  createdAt: new Date(Date.now() - ageHours * HOUR),
})

/** A live ledger entry, as `readAttemptRecord` reads it out of `SportsDataCache`. */
const ledger = (over: Record<string, unknown> = {}) => ({
  expiresAt: new Date(Date.now() + HOUR),
  data: {
    contentHash: 'hash-a',
    attempts: 1,
    lastOutcome: 'policy-skipped',
    firstAttemptAt: '2026-09-10T00:00:00.000Z',
    lastAttemptAt: '2026-09-10T00:00:00.000Z',
    policyVersion: PLAYER_NEWS_POLICY_VERSION - 1,
    ...over,
  },
})

/** Route each `findUnique` to the entry for the id it asked about. */
const ledgerFor = (entries: Record<string, ReturnType<typeof ledger> | null>) => {
  h.findUnique.mockImplementation(async ({ where }: { where: { cacheKey: string } }) => {
    const id = where.cacheKey.replace('player-news-dispatch:', '')
    return entries[id] ?? null
  })
}

beforeEach(() => {
  h.findUnique.mockReset().mockResolvedValue(null)
  h.upsert.mockReset().mockResolvedValue({})
  h.findMany.mockReset().mockResolvedValue([])
  h.updateMany.mockReset().mockResolvedValue({ count: 0 })
})

describe('what counts as recoverable', () => {
  it('selects a skip recorded under a superseded rules version', async () => {
    h.findMany.mockResolvedValue([newsRow('n1')])
    ledgerFor({ n1: ledger() })

    const { candidates } = await findStalePolicySkips()
    expect(candidates).toEqual([
      { newsId: 'n1', headline: 'headline n1', skippedUnderVersion: PLAYER_NEWS_POLICY_VERSION - 1 },
    ])
  })

  it('treats a skip with NO recorded version as stale', async () => {
    /*
     * Entries written before versioning are still live under the 48h TTL, and they are the ones
     * most likely to predate the fix being rolled out. Reading `undefined` as "current" would
     * silently exclude exactly them.
     */
    h.findMany.mockResolvedValue([newsRow('n1')])
    ledgerFor({ n1: ledger({ policyVersion: undefined }) })

    const { candidates } = await findStalePolicySkips()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].skippedUnderVersion).toBeNull()
  })

  it('leaves a skip already recorded under the CURRENT version alone', async () => {
    // Otherwise every review re-examines every skip forever, and running it twice does work twice.
    h.findMany.mockResolvedValue([newsRow('n1')])
    ledgerFor({ n1: ledger({ policyVersion: PLAYER_NEWS_POLICY_VERSION }) })

    expect((await findStalePolicySkips()).candidates).toEqual([])
  })

  it.each(['delivered', 'no-roster', 'all-suppressed', 'no-identity-row'])(
    'never touches a row whose outcome was %s',
    async (lastOutcome) => {
      // Clearing the stamp on a DELIVERED row re-notifies everyone who already had it.
      h.findMany.mockResolvedValue([newsRow('n1')])
      ledgerFor({ n1: ledger({ lastOutcome, policyVersion: PLAYER_NEWS_POLICY_VERSION - 1 }) })

      expect((await findStalePolicySkips()).candidates).toEqual([])
    },
  )
})

describe('an unreadable ledger entry is left ALONE', () => {
  it('does not select a row whose entry is missing, and counts it', async () => {
    /*
     * 🛑 THE OPPOSITE OF HOW THE LEDGER FAILS OPEN IN THE SWEEP, AND BOTH ARE RIGHT. There, an
     * unreadable entry must not turn a retryable hold into a permanent drop. Here it cannot tell
     * a skip from a delivery, and the unsafe direction is a duplicate blast — which, unlike
     * silence, no later run can undo.
     */
    h.findMany.mockResolvedValue([newsRow('n1'), newsRow('n2')])
    ledgerFor({ n1: null, n2: ledger() })

    const result = await findStalePolicySkips()
    expect(result.candidates.map((c) => c.newsId)).toEqual(['n2'])
    expect(result.undecidable).toBe(1)
    expect(result.examined).toBe(2)
  })

  it('does not select a row whose entry has EXPIRED', async () => {
    h.findMany.mockResolvedValue([newsRow('n1')])
    ledgerFor({ n1: { ...ledger(), expiresAt: new Date(Date.now() - 1000) } })

    const result = await findStalePolicySkips()
    expect(result.candidates).toEqual([])
    expect(result.undecidable).toBe(1)
  })
})

describe('the lookback the caller is handed back', () => {
  it('is sized from createdAt, not from the stamp time', async () => {
    /*
     * 🛑 CLEARING THE STAMP IS ONLY HALF OF PUTTING A ROW BACK. The sweep also filters
     * `createdAt >= since` and production passes 6 hours, so a nine-hour-old row stays invisible
     * and the review reports a success that changes nothing. Sizing this from the stamp instead
     * would under-state it by however long the row waited to be swept.
     */
    h.findMany.mockResolvedValue([newsRow('n1', 2), newsRow('n2', 9)])
    ledgerFor({ n1: ledger(), n2: ledger() })

    const result = await reviewPolicySkips()
    expect(result.requiredSweepLookbackHours).toBeGreaterThanOrEqual(9)
  })

  it('is zero when there is nothing to put back', async () => {
    expect((await reviewPolicySkips()).requiredSweepLookbackHours).toBe(0)
  })

  it('cannot reach past the ledger TTL, however large a window is asked for', async () => {
    // Beyond 48h there is no record of WHY a row was stamped, so a review would be guessing.
    await findStalePolicySkips({ withinHours: 500 })
    const since: Date = h.findMany.mock.calls[0][0].where.notificationDispatchedAt.gte
    const askedHours = (Date.now() - since.getTime()) / HOUR
    expect(askedHours).toBeLessThanOrEqual(MAX_REVIEW_LOOKBACK_HOURS + 0.01)
  })
})

describe('dry run is the default', () => {
  it('changes nothing unless apply is passed', async () => {
    h.findMany.mockResolvedValue([newsRow('n1')])
    ledgerFor({ n1: ledger() })

    const result = await reviewPolicySkips()
    expect(result.applied).toBe(false)
    expect(result.cleared).toBe(0)
    expect(result.candidates).toHaveLength(1)
    expect(h.updateMany).not.toHaveBeenCalled()
  })

  it('clears exactly the candidate ids when applied', async () => {
    h.findMany.mockResolvedValue([newsRow('n1'), newsRow('n2')])
    ledgerFor({ n1: ledger(), n2: ledger({ lastOutcome: 'delivered' }) })
    h.updateMany.mockResolvedValue({ count: 1 })

    const result = await reviewPolicySkips({ apply: true })
    expect(h.updateMany).toHaveBeenCalledTimes(1)
    expect(h.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: ['n1'] } },
      data: { notificationDispatchedAt: null },
    })
    expect(result.cleared).toBe(1)
  })

  it('reports what the DATABASE did, not what was asked', async () => {
    /*
     * A failed `updateMany` reported as a full success is the exact shape of silent no-op this
     * module exists to remove. `cleared = candidates.length` would have done that.
     */
    h.findMany.mockResolvedValue([newsRow('n1')])
    ledgerFor({ n1: ledger() })
    h.updateMany.mockRejectedValue(new Error('db down'))

    const result = await reviewPolicySkips({ apply: true })
    expect(result.applied).toBe(true)
    expect(result.cleared).toBe(0)
  })

  it('issues no write at all when there is nothing to clear', async () => {
    await reviewPolicySkips({ apply: true })
    expect(h.updateMany).not.toHaveBeenCalled()
  })
})
