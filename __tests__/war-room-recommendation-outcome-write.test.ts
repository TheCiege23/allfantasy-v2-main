import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `logAiRecommendation` must write BOTH recommendation tables.
 *
 * 🛑 THE BUG THIS PINS: `ai_recommendation_outcomes` was EMPTY in production (0 rows, newest NULL)
 * while `getAIMetrics` read it five times behind two live admin routes — so those dashboards
 * reported "no recommendations followed" when nothing had ever been recorded. An empty result and
 * a never-populated one are indistinguishable on a chart, and only one of them is information.
 *
 * ⚠ `followed` MUST STAY NULL WHEN UNKNOWN. `getAIMetrics` computes a follow RATE from this column;
 * defaulting an unresolved recommendation to `false` invents a denominator and would make the
 * dashboard confidently wrong instead of merely empty — the same class of defect, in a new costume.
 */

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  trackRecommendationOutcome: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { aiRecommendationLog: { create: mocks.create } },
}))

vi.mock('@/lib/ai/outcomes/trackRecommendationOutcome', () => ({
  trackRecommendationOutcome: mocks.trackRecommendationOutcome,
}))

const BASE = {
  userId: 'u1',
  leagueId: 'lg1',
  feature: 'war_room_recommend',
  inputJson: {},
  outputJson: {},
}

describe('logAiRecommendation writes the outcome row too', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({ id: 'rec-1', createdAt: new Date() })
    mocks.trackRecommendationOutcome.mockResolvedValue('outcome-1')
  })

  it('writes an outcome row keyed on the LOG ROW ID, so the two tables join', async () => {
    const { logAiRecommendation } = await import('@/lib/war-room/war-room-persist')

    await logAiRecommendation({ ...BASE, recommendationType: 'draft_pick' })

    expect(mocks.trackRecommendationOutcome).toHaveBeenCalledTimes(1)
    expect(mocks.trackRecommendationOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        recommendationId: 'rec-1', // the id the log row returned — not a second identifier
        type: 'draft_pick',
        userId: 'u1',
        leagueId: 'lg1',
      }),
    )
  })

  it('leaves `followed` NULL when acceptance is unknown, rather than defaulting to false', async () => {
    const { logAiRecommendation } = await import('@/lib/war-room/war-room-persist')

    await logAiRecommendation(BASE) // no `accepted`

    const arg = mocks.trackRecommendationOutcome.mock.calls[0]![0]
    expect(arg.followed).toBeNull()
    // Unresolved must not look resolved, or the follow-rate denominator is invented.
    expect(arg.resolvedAt).toBeNull()
  })

  it('records `followed` and resolves it when the caller already knows', async () => {
    const { logAiRecommendation } = await import('@/lib/war-room/war-room-persist')

    await logAiRecommendation({ ...BASE, accepted: true })

    const arg = mocks.trackRecommendationOutcome.mock.calls[0]![0]
    expect(arg.followed).toBe(true)
    expect(arg.resolvedAt).toBeInstanceOf(Date)
  })

  it('falls back to `feature` when no recommendationType is given', async () => {
    const { logAiRecommendation } = await import('@/lib/war-room/war-room-persist')

    await logAiRecommendation(BASE)

    expect(mocks.trackRecommendationOutcome.mock.calls[0]![0].type).toBe('war_room_recommend')
  })

  it('🛑 a telemetry failure must NOT break the served recommendation', async () => {
    mocks.trackRecommendationOutcome.mockRejectedValueOnce(new Error('db down'))
    const { logAiRecommendation } = await import('@/lib/war-room/war-room-persist')

    // The recommendation still returns its log row. This is the whole point: instrumentation
    // must never turn a working feature into a 500.
    await expect(logAiRecommendation(BASE)).resolves.toMatchObject({ id: 'rec-1' })
  })

  it('still returns the log row unchanged, so existing callers are untouched', async () => {
    const { logAiRecommendation } = await import('@/lib/war-room/war-room-persist')

    const out = await logAiRecommendation(BASE)

    expect(out).toMatchObject({ id: 'rec-1' })
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
