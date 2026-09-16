import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Admin AI metrics: each recommendation's follow verdict counts ONCE, and follow-vs-ignore says
 * nothing until each side has a real sample.
 */

const h = vi.hoisted(() => ({
  outcomeFindMany: vi.fn(),
  logFindMany: vi.fn(),
  eventCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiRecommendationOutcome: { findMany: h.outcomeFindMany },
    aiRecommendationLog: { findMany: h.logFindMany },
    aiPlatformEvent: { count: h.eventCount },
  },
}))

import {
  countFollowSignals,
  getFeatureBreakdown,
  getFollowVsIgnore,
  MIN_SCORED_OUTCOMES_PER_SIDE,
} from '@/lib/ai/admin/getAIMetrics'

const FILTERS = { dateFrom: new Date('2026-09-01'), dateTo: new Date('2026-09-30') }

beforeEach(() => {
  vi.clearAllMocks()
  h.outcomeFindMany.mockResolvedValue([])
  h.logFindMany.mockResolvedValue([])
  h.eventCount.mockResolvedValue(0)
})

describe('countFollowSignals', () => {
  /*
   * 🛑 THE DOUBLE COUNT. War-room telemetry sets `log.accepted`, the draft resolver sets
   * `outcome.followed`, for the SAME recommendation (outcome.recommendationId === log.id).
   */
  it('counts a recommendation once when its log and its outcome both carry the verdict', () => {
    expect(
      countFollowSignals([{ recommendationId: 'r1', followed: true }], [{ id: 'r1', accepted: true }]),
    ).toEqual({ followed: 1, ignored: 0 })
  })

  it('lets the resolved outcome win over the log', () => {
    expect(
      countFollowSignals([{ recommendationId: 'r1', followed: false }], [{ id: 'r1', accepted: true }]),
    ).toEqual({ followed: 0, ignored: 1 })
  })

  it('still counts a log verdict that has no outcome verdict', () => {
    expect(
      countFollowSignals(
        [{ recommendationId: 'r1', followed: null }],
        [
          { id: 'r1', accepted: true },
          { id: 'r2', accepted: false },
          { id: 'r3', accepted: null },
        ],
      ),
    ).toEqual({ followed: 1, ignored: 1 })
  })

  it('counts several outcome rows for one recommendation once', () => {
    expect(
      countFollowSignals(
        [
          { recommendationId: 'r1', followed: true },
          { recommendationId: 'r1', followed: true },
        ],
        [],
      ),
    ).toEqual({ followed: 1, ignored: 0 })
  })
})

describe('the feature breakdown uses it', () => {
  it('reports 100% from one followed pick, not a doubled count', async () => {
    h.logFindMany.mockResolvedValue([
      { id: 'r1', feature: 'war_room', recommendationType: 'war_room_pick', accepted: true },
      { id: 'r2', feature: 'war_room', recommendationType: 'war_room_pick', accepted: false },
    ])
    // r1's verdict is in BOTH tables; r2's only in the log.
    h.outcomeFindMany.mockResolvedValue([
      { recommendationId: 'r1', type: 'war_room_pick', followed: true, outcomeScore: null },
    ])
    const rows = await getFeatureBreakdown(FILTERS)
    const draft = rows.find((r) => r.feature === 'draft')!
    // Doubled, r1 counted twice: 2 follows / 3 verdicts = 66.7%. Once each: 1 / 2.
    expect(draft.followRatePct).toBe(50)
    expect(h.logFindMany.mock.calls[0][0].select).toMatchObject({ id: true })
    expect(h.outcomeFindMany.mock.calls[0][0].select).toMatchObject({ recommendationId: true })
  })
})

describe('follow vs ignore needs a real sample', () => {
  const scored = (followed: boolean, n: number, score: number) =>
    Array.from({ length: n }, (_, i) => ({ followed, outcomeScore: score, userId: `u${i}`, type: 'war_room_pick' }))

  it('says nothing, and shows no averages, below the floor on either side', async () => {
    h.outcomeFindMany.mockResolvedValue([...scored(true, 1, 0.9), ...scored(false, 1, 0.1)])
    const r = await getFollowVsIgnore(FILTERS)
    expect(r.avgOutcomeWhenFollowed).toBeNull()
    expect(r.avgOutcomeWhenIgnored).toBeNull()
    expect(r.insight).toMatch(/^Not enough resolved outcomes/)
    expect(r.insight).toContain(`${MIN_SCORED_OUTCOMES_PER_SIDE} each needed`)
  })

  it('compares once both sides reach the floor', async () => {
    const n = MIN_SCORED_OUTCOMES_PER_SIDE
    h.outcomeFindMany.mockResolvedValue([...scored(true, n, 0.7), ...scored(false, n, 0.5)])
    const r = await getFollowVsIgnore(FILTERS)
    expect(r.avgOutcomeWhenFollowed).toBeCloseTo(0.7)
    expect(r.insight).toMatch(/followed AI show ~20\.0 points higher/)
  })

  it('one side at the floor is not enough', async () => {
    const n = MIN_SCORED_OUTCOMES_PER_SIDE
    h.outcomeFindMany.mockResolvedValue([...scored(true, n, 0.7), ...scored(false, n - 1, 0.5)])
    const r = await getFollowVsIgnore(FILTERS)
    expect(r.avgOutcomeWhenIgnored).toBeNull()
    expect(r.insight).toMatch(/^Not enough/)
  })
})
