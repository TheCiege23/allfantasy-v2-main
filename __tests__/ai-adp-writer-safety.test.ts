// @vitest-environment node
/**
 * Guards the three properties that make scheduling `runAiAdpJob` safe.
 *
 * The writer was unscheduled, so `ai_adp_snapshots` held zero rows while eight surfaces read
 * it. Wiring the cron fixes that — but rows arriving changes behaviour everywhere at once,
 * and two of those changes are harmful today:
 *   - RecommendationEngine's `getAdp` returns the AI number IN PREFERENCE to the real ADP.
 *   - `getAiAdpForLeague` answers a dynasty miss with the REDRAFT board (45 NFL dynasty
 *     leagues in production, and nothing renders the `segment` field).
 * plus the input is thin: excluding 18 all-autopick seed sessions, real segments are 6/4/2
 * completed drafts, and `lowSample` is stamped but read by no consumer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const snapshotFindMany = vi.fn()
const snapshotFindFirst = vi.fn()
const draftPickFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiAdpSnapshot: {
      findMany: (...a: unknown[]) => snapshotFindMany(...a),
      findFirst: (...a: unknown[]) => snapshotFindFirst(...a),
      upsert: vi.fn(),
      create: vi.fn(),
    },
    aiAdpSnapshotHistory: { create: vi.fn() },
    draftPick: { findMany: (...a: unknown[]) => draftPickFindMany(...a) },
    mockDraft: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

import {
  isAiAdpConsumerEnabled,
  AI_ADP_MIN_DRAFTS_TO_PUBLISH,
} from '@/lib/ai-adp-engine/aiAdpConsumerFlag'
import { aggregateLiveDraftPicks } from '@/lib/ai-adp-engine/aggregate-draft-picks'

const ORIGINAL = process.env.AI_ADP_CONSUMERS_ENABLED

beforeEach(() => {
  snapshotFindMany.mockReset().mockResolvedValue([])
  snapshotFindFirst.mockReset().mockResolvedValue(null)
  draftPickFindMany.mockReset().mockResolvedValue([])
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AI_ADP_CONSUMERS_ENABLED
  else process.env.AI_ADP_CONSUMERS_ENABLED = ORIGINAL
})

describe('isAiAdpConsumerEnabled', () => {
  it('is OFF when unset — a new environment must not enable draft overrides by omission', () => {
    delete process.env.AI_ADP_CONSUMERS_ENABLED
    expect(isAiAdpConsumerEnabled()).toBe(false)
  })

  it('is OFF for every value that is not exactly true', () => {
    for (const v of ['', 'false', '0', 'no', 'off', '1', 'yes', 'TRUE ', 'truthy']) {
      process.env.AI_ADP_CONSUMERS_ENABLED = v
      const expected = v.trim().toLowerCase() === 'true'
      expect(isAiAdpConsumerEnabled(), `value ${JSON.stringify(v)}`).toBe(expected)
    }
  })

  it('is ON only for an explicit true, case and padding tolerant', () => {
    for (const v of ['true', 'TRUE', '  true  ', 'True']) {
      process.env.AI_ADP_CONSUMERS_ENABLED = v
      expect(isAiAdpConsumerEnabled(), `value ${JSON.stringify(v)}`).toBe(true)
    }
  })
})

describe('publish floor', () => {
  it('requires more drafts than the per-player minimum, which is the only other gate', () => {
    // minSampleSize is 2 and filters PLAYERS; nothing filters a thin SEGMENT without this.
    expect(AI_ADP_MIN_DRAFTS_TO_PUBLISH).toBeGreaterThan(2)
  })
})

describe('aggregateLiveDraftPicks', () => {
  it('excludes autopicked seed drafts at the query, not after aggregation', async () => {
    await aggregateLiveDraftPicks(new Date('2026-05-01T00:00:00Z'))

    expect(draftPickFindMany).toHaveBeenCalledTimes(1)
    const where = draftPickFindMany.mock.calls[0]?.[0]?.where
    /*
     * At the query matters: filtering in the reducer would still let `draftCount` claim the
     * seeded draft, which is the number that makes a thin board look sampled.
     */
    expect(where?.source).toEqual({ not: 'auto' })
    expect(where?.session?.status).toBe('completed')
  })

  it('still scopes to completed sessions inside the lookback window', async () => {
    const since = new Date('2026-05-01T00:00:00Z')
    await aggregateLiveDraftPicks(since)
    const where = draftPickFindMany.mock.calls[0]?.[0]?.where
    expect(where?.session?.updatedAt).toEqual({ gte: since })
  })
})
