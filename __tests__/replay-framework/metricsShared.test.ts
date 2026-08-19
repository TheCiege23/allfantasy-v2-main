/**
 * Decision OS Replay Framework Phase 11 — direct coverage for the
 * decision-type-agnostic metrics primitives extracted from
 * `tradeReplayMetrics.ts` (bytewise-unchanged relocation, not a rewrite).
 * These were previously only exercised indirectly through trade-specific
 * fixtures; this file proves they behave correctly on their own, decision-
 * type-agnostic terms, for any future `{decisionType}ReplayMetrics.ts`.
 */
import { describe, it, expect } from 'vitest'
import { average, bucketize, bucketizeSignedMagnitude } from '@/lib/replay-framework/metrics/shared'

describe('average', () => {
  it('returns null for an empty array', () => {
    expect(average([])).toBeNull()
  })

  it('computes the arithmetic mean', () => {
    expect(average([1, 2, 3])).toBe(2)
  })
})

describe('bucketize', () => {
  it('buckets a 0-1 scale into 10 even buckets by default', () => {
    const dist = bucketize([0.05, 0.15, 0.95])
    expect(dist).toHaveLength(10)
    expect(dist[0]).toEqual({ bucket: '0–10%', count: 1 })
    expect(dist[1]).toEqual({ bucket: '10–20%', count: 1 })
    expect(dist[9]).toEqual({ bucket: '90–100%', count: 1 })
  })

  it('buckets a 0-100 scale when scaleTo100 is set', () => {
    const dist = bucketize([5, 95], true)
    expect(dist[0]).toEqual({ bucket: '0–10', count: 1 })
    expect(dist[9]).toEqual({ bucket: '90–100', count: 1 })
  })

  it('includes the exact upper bound only in the final bucket', () => {
    const dist = bucketize([1.0])
    expect(dist[9].count).toBe(1)
  })
})

describe('bucketizeSignedMagnitude', () => {
  it('classifies zero, small, and large signed values by absolute magnitude', () => {
    const dist = bucketizeSignedMagnitude([0, 0, 1, -1.5, 3, -4, 7, -8, 12, -15])
    const byBucket = Object.fromEntries(dist.map((d) => [d.bucket, d.count]))
    expect(byBucket['zero']).toBe(2)
    expect(byBucket['0 to 2 (abs)']).toBe(2)
    expect(byBucket['2 to 5 (abs)']).toBe(2)
    expect(byBucket['5 to 10 (abs)']).toBe(2)
    expect(byBucket['10+ (abs)']).toBe(2)
  })

  it('is not trade-specific -- works on any signed magnitude array', () => {
    const dist = bucketizeSignedMagnitude([0.4, -0.4, 100, -100])
    const byBucket = Object.fromEntries(dist.map((d) => [d.bucket, d.count]))
    expect(byBucket['0 to 2 (abs)']).toBe(2)
    expect(byBucket['10+ (abs)']).toBe(2)
  })
})
