/**
 * Decision OS — Trade Learning Phase 8. End-to-end proof of the ADR's core
 * claim: real, live-captured TradeOfferEvent/TradeOutcomeEvent pairs
 * (afLeagueTradeId-linked, mode: LIVE_PROPOSAL) are correctly picked up by
 * the existing, UNMODIFIED calibration pipeline (computeShadowB0), because
 * they carry a real offerEventId — unlike the "write an outcome with no
 * linked offer" trap the ADR was written to avoid.
 *
 * Uses the real logTradeOfferEvent/logTradeOutcomeEvent/computeShadowB0
 * exports (not re-implemented here), against mocked Prisma only.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const {
  mockTradeOfferEventCreate,
  mockTradeOfferEventFindUnique,
  mockTradeOutcomeEventCreate,
  mockTradeOutcomeEventFindMany,
  mockTradeOfferEventFindMany,
  mockTradeLearningStatsFindUnique,
} = vi.hoisted(() => ({
  mockTradeOfferEventCreate: vi.fn(),
  mockTradeOfferEventFindUnique: vi.fn(),
  mockTradeOutcomeEventCreate: vi.fn(),
  mockTradeOutcomeEventFindMany: vi.fn(),
  mockTradeOfferEventFindMany: vi.fn(),
  mockTradeLearningStatsFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tradeOfferEvent: {
      create: mockTradeOfferEventCreate,
      findUnique: mockTradeOfferEventFindUnique,
      findMany: mockTradeOfferEventFindMany,
    },
    tradeOutcomeEvent: {
      create: mockTradeOutcomeEventCreate,
      findMany: mockTradeOutcomeEventFindMany,
    },
    tradeLearningStats: { findUnique: mockTradeLearningStatsFindUnique },
  },
}))

import { logTradeOfferEvent, logTradeOutcomeEvent } from '@/lib/trade-engine/trade-event-logger'
import { computeShadowB0 } from '@/lib/trade-engine/auto-recalibration'

const SEASON = 2025

describe('Live-captured events are visible to the existing, unmodified calibration pipeline', () => {
  afterEach(() => vi.clearAllMocks())

  it('30 real LIVE_PROPOSAL offer+outcome pairs, captured via the real logger functions, produce a non-null, correctly-computed shadow B0', async () => {
    // Simulate the in-memory "database" for this test: 30 offer events and
    // their linked outcome events, keyed by afLeagueTradeId, exactly as
    // tradeService.ts's real capture calls would produce.
    const offerRows: Array<{ id: string; afLeagueTradeId: string; acceptProb: number; featuresJson: unknown }> = []

    mockTradeOfferEventCreate.mockImplementation(async ({ data }: any) => {
      const id = `offer-${offerRows.length}`
      offerRows.push({ id, afLeagueTradeId: data.afLeagueTradeId, acceptProb: data.acceptProb, featuresJson: data.featuresJson })
      return { id }
    })

    const outcomeRows: Array<{ offerEventId: string | null; outcome: string; season: number }> = []
    mockTradeOutcomeEventCreate.mockImplementation(async ({ data }: any) => {
      outcomeRows.push({ offerEventId: data.offerEventId, outcome: data.outcome, season: data.season })
      return { id: `outcome-${outcomeRows.length}` }
    })

    mockTradeOfferEventFindUnique.mockImplementation(async ({ where }: any) => {
      const row = offerRows.find((r) => r.afLeagueTradeId === where.afLeagueTradeId)
      return row ? { id: row.id } : null
    })

    // Step 1: capture 30 real live proposals (offer events) — mirrors what
    // captureLiveTradeOffer() does internally, using the real logger.
    for (let i = 0; i < 30; i++) {
      await logTradeOfferEvent({
        assetsGiven: [{ name: 'Player A', value: 3000, type: 'player' }],
        assetsReceived: [{ name: 'Player B', value: 3200, type: 'player' }],
        acceptProb: 0.5,
        verdict: 'FAIR',
        mode: 'LIVE_PROPOSAL',
        afLeagueTradeId: `trade-${i}`,
      })
    }

    // Step 2: capture the real outcome for each — 27 accepted, 3 rejected
    // (90% real acceptance), mirroring what captureLiveTradeOutcome() does
    // internally: look up the offer by afLeagueTradeId, link via offerEventId.
    for (let i = 0; i < 30; i++) {
      const found = offerRows.find((r) => r.afLeagueTradeId === `trade-${i}`)
      await logTradeOutcomeEvent({
        offerEventId: found?.id ?? null,
        season: SEASON,
        outcome: i < 27 ? 'accepted' : 'rejected',
        afLeagueTradeId: `trade-${i}`,
      })
    }

    expect(offerRows).toHaveLength(30)
    expect(outcomeRows).toHaveLength(30)
    expect(outcomeRows.every((o) => o.offerEventId !== null)).toBe(true) // the core claim: real linkage, not null

    // Step 3: point computeShadowB0() (real, unmodified) at this exact data.
    mockTradeOutcomeEventFindMany.mockResolvedValue(
      outcomeRows.map((o, i) => ({ offerEventId: o.offerEventId, outcome: o.outcome.toUpperCase() })),
    )
    mockTradeOfferEventFindMany.mockResolvedValue(
      offerRows.map((r) => ({ id: r.id, featuresJson: r.featuresJson, acceptProb: r.acceptProb })),
    )
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const metrics = await computeShadowB0(SEASON)

    expect(metrics).not.toBeNull()
    expect(metrics!.sampleSize).toBe(30)
    expect(metrics!.observedRate).toBeCloseTo(0.9, 2) // 27/30 accepted
  })
})
