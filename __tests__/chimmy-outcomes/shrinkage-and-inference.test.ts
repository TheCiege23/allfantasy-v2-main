import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BEHAVIOR_RATE_DEFAULTS, decayWeight, shrunkRate } from '@/lib/chimmy-outcomes/shrinkage'

/**
 * Chimmy item 10: no single result may dominate a rate Chimmy acts on.
 */

describe('shrunkRate', () => {
  it('says nothing below the minimum sample', () => {
    expect(shrunkRate(1, 1)).toBeNull()
    expect(shrunkRate(9, 9)).toBeNull()
  })

  it('pulls a perfect record toward the prior', () => {
    // (10 + 0.5 * 10) / (10 + 10)
    expect(shrunkRate(10, 10)).toBeCloseTo(0.75)
  })

  it('approaches the raw rate as evidence grows', () => {
    expect(shrunkRate(100, 100)!).toBeGreaterThan(0.95)
    expect(shrunkRate(50, 100)).toBeCloseTo(0.5)
  })

  it('clamps nonsense inputs rather than returning a rate above 1', () => {
    expect(shrunkRate(15, 10)).toBeCloseTo(0.75)
    expect(shrunkRate(Number.NaN, 10)).toBeNull()
  })

  it('uses the documented defaults', () => {
    expect(BEHAVIOR_RATE_DEFAULTS).toEqual({ priorRate: 0.5, priorWeight: 10, minSample: 10 })
  })
})

describe('decayWeight', () => {
  it('halves at the half-life and never exceeds 1', () => {
    expect(decayWeight(0, 28)).toBe(1)
    expect(decayWeight(28, 28)).toBeCloseTo(0.5)
    expect(decayWeight(56, 28)).toBeCloseTo(0.25)
    expect(decayWeight(-3, 28)).toBe(1)
  })
})

/*
 * 🛑 ONE VOTE USED TO FLIP A USER'S ANSWER STYLE. A single accepted recommendation read as a 100%
 * accept rate and switched Chimmy to "one quick move" — for a signal of one.
 */
const h = vi.hoisted(() => ({
  feedbackFindMany: vi.fn(),
  leagueFindMany: vi.fn(),
  profileFindUnique: vi.fn(),
  getAiMemory: vi.fn(),
  recordQuality: vi.fn(),
  readSnapshot: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aIUserFeedback: { findMany: h.feedbackFindMany },
    league: { findMany: h.leagueFindMany },
    aIUserProfile: { findUnique: h.profileFindUnique },
  },
}))
vi.mock('@/lib/ai-memory/ai-memory-store', () => ({ getAiMemory: h.getAiMemory, upsertAiMemory: vi.fn() }))
vi.mock('@/lib/chimmy-quality/ChimmyQualityAnalytics', () => ({ recordChimmyQualityEvent: h.recordQuality }))
vi.mock('@/lib/chimmy-outcomes/learningStore', () => ({ readAdviceLearningSnapshot: h.readSnapshot }))

import { resolveChimmyPersonalizationProfile } from '@/lib/chimmy-personalization/service'
import { buildAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningSnapshot'

function events(accepted: number, rejected: number) {
  return [
    ...Array.from({ length: accepted }, () => ({ actionType: 'chimmy_recommendation_accepted', result: {} })),
    ...Array.from({ length: rejected }, () => ({ actionType: 'chimmy_recommendation_rejected', result: {} })),
  ]
}

describe('personalization reads acceptance through the same guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.leagueFindMany.mockResolvedValue([])
    h.profileFindUnique.mockResolvedValue(null)
    h.getAiMemory.mockResolvedValue(null)
    h.recordQuality.mockResolvedValue(undefined)
    h.readSnapshot.mockResolvedValue(null)
  })

  it('one accepted recommendation changes nothing', async () => {
    h.feedbackFindMany.mockResolvedValue(events(1, 0))
    const p = await resolveChimmyPersonalizationProfile('u1')
    expect(p.inferred.signals.recommendationAcceptRate).toBeNull()
    expect(p.inferred.actionPreference).toBe('top-3-options')
  })

  it('a sustained pattern still does', async () => {
    h.feedbackFindMany.mockResolvedValue(events(10, 0))
    const p = await resolveChimmyPersonalizationProfile('u1')
    expect(p.inferred.signals.recommendationAcceptRate).toBeCloseTo(0.75)
    expect(p.inferred.actionPreference).toBe('quick-one-move')
  })

  it('eight of ten is not yet enough to flip it', async () => {
    h.feedbackFindMany.mockResolvedValue(events(8, 2))
    const p = await resolveChimmyPersonalizationProfile('u1')
    expect(p.inferred.signals.recommendationAcceptRate).toBeCloseTo(0.65)
    expect(p.inferred.actionPreference).toBe('top-3-options')
  })
})

/*
 * "Did it / Not doing it" plus what the platform shows: one vote per piece of advice, weighted by age.
 */
describe('personalization merges your votes with what the platform shows', () => {
  const NOW = Date.now()
  beforeEach(() => {
    // `clearAllMocks` keeps implementations — without the reset a snapshot leaks between tests.
    vi.clearAllMocks()
    h.leagueFindMany.mockResolvedValue([])
    h.profileFindUnique.mockResolvedValue(null)
    h.getAiMemory.mockResolvedValue(null)
    h.recordQuality.mockResolvedValue(undefined)
    h.readSnapshot.mockResolvedValue(null)
  })

  function inferred(followed: boolean, keys: string[]) {
    return buildAdviceLearningSnapshot(
      keys.map((key) => ({ userId: 'u1', key, adviceType: 'add' as const, confidencePct: null, givenAt: new Date(NOW), followed: followed ? ('yes' as const) : ('no' as const) })),
      { now: new Date(NOW), complete: true, users: 1 },
    )
  }

  it('counts a piece of advice once, and your newest vote on it wins over the platform', async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `L1:2026:5:add:${i}`)
    h.readSnapshot.mockResolvedValue(inferred(true, keys))
    // Newest first: "not doing it" on k0, after an earlier "did it" on k0.
    h.feedbackFindMany.mockResolvedValue([
      { actionType: 'chimmy_recommendation_rejected', result: { adviceKey: keys[0] }, createdAt: new Date(NOW) },
      { actionType: 'chimmy_recommendation_accepted', result: { adviceKey: keys[0] }, createdAt: new Date(NOW - 60_000) },
    ])
    const p = await resolveChimmyPersonalizationProfile('u1')
    // Ten pieces of advice: nine followed per Sleeper, one you declined → (9 + 5) / (10 + 10).
    expect(p.inferred.signals.recommendationAcceptRate).toBeCloseTo(0.7, 5)
    expect(p.inferred.signals.recommendationRejectRate).toBeCloseTo(0.3, 5)
  })

  it('platform verdicts alone reach the minimum sample', async () => {
    h.readSnapshot.mockResolvedValue(inferred(false, Array.from({ length: 10 }, (_, i) => `k${i}`)))
    h.feedbackFindMany.mockResolvedValue([])
    const p = await resolveChimmyPersonalizationProfile('u1')
    expect(p.inferred.signals.recommendationRejectRate).toBeCloseTo(0.75)
    expect(p.inferred.actionPreference).toBe('full-breakdown')
  })

  it('old votes weigh less than new ones', async () => {
    const old = new Date(NOW - 120 * 86_400_000)
    h.feedbackFindMany.mockResolvedValue([
      ...Array.from({ length: 10 }, () => ({ actionType: 'chimmy_recommendation_rejected', result: {}, createdAt: new Date(NOW) })),
      ...Array.from({ length: 10 }, () => ({ actionType: 'chimmy_recommendation_accepted', result: {}, createdAt: old })),
    ])
    const p = await resolveChimmyPersonalizationProfile('u1')
    // Accepts two half-lives old weigh 0.25 each: rejects (10 + 5) / (12.5 + 10).
    expect(p.inferred.signals.recommendationRejectRate).toBeCloseTo(15 / 22.5)
    expect(p.inferred.actionPreference).toBe('full-breakdown')
  })
})
