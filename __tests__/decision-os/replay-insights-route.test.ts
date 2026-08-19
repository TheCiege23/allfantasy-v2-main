/**
 * Decision OS Replay Framework Phase 19 — Replay Insight API route test.
 *
 * Exercises the real `GET` export of app/api/v1/intelligence/replay-insights/route.ts
 * — the thin adapter that turns a NextRequest into the handler's context and
 * forwards the handler's `{ status, body }` via NextResponse.json(). The
 * handler's own auth/tenant/scope/param/leak logic is covered separately in
 * `replayInsightResolver.test.ts` (Phase 18); this file proves the route
 * wiring end-to-end through the HTTP boundary.
 *
 * The DB-touching `createLiveReplayInsightDataProvider` is replaced with a
 * controllable fake (the real `replayInsightHandler` is kept), so every
 * required case — auth, feature flag, tier, missing leagueId, empty corpus,
 * successful response, no replay-ID leakage — runs without any DB access.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DecisionReplayCorrelationSummary } from '@/lib/replay-framework/metrics/decisionReplayCorrelation'

const { providerState } = vi.hoisted(() => ({
  providerState: { summary: null as DecisionReplayCorrelationSummary | null },
}))

vi.mock('@/lib/decision-os/replay-insights/replayInsightResolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/decision-os/replay-insights/replayInsightResolver')>()
  return {
    ...actual,
    // Keep the REAL handler; replace only the DB-touching live provider factory.
    createLiveReplayInsightDataProvider: () => ({
      getReplayCorrelationSummary: async () => providerState.summary,
    }),
  }
})

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/intelligence/replay-insights/route'

const COMMISSIONER_KEY = 'afk_test_commissionerkey0001' // mapped → 'commissioner' (has league:read)
const BASIC_KEY = 'afk_test_unmappedbasickey0001'         // not in map → 'basic' (lacks league:read)

function enableApi() {
  vi.stubEnv('DECISION_OS_INTELLIGENCE_API_ENABLED', 'true')
  vi.stubEnv('INTELLIGENCE_API_TEST_KEYS', JSON.stringify({ [COMMISSIONER_KEY]: 'commissioner' }))
}

function makeReq(opts: { apiKey?: string; leagueId?: string } = {}): NextRequest {
  const url = new URL('http://localhost/api/v1/intelligence/replay-insights')
  if (opts.leagueId !== undefined) url.searchParams.set('leagueId', opts.leagueId)
  const headers = new Headers()
  if (opts.apiKey) headers.set('x-allfantasy-api-key', opts.apiKey)
  return new NextRequest(url, { headers })
}

function makeSummary(overrides: Partial<{
  totalTradesConsidered: number
  totalTradesWithLineupData: number
  avgRetainedButUnusedRate: number | null
  avgChurnedAwayRate: number | null
  starterCount: number
  benchCount: number
  matchedTrades: number
  matchedDeltaEff: number | null
  perTradeImpacts: unknown[]
}> = {}): DecisionReplayCorrelationSummary {
  const g = (count: number, avgDeltaEfficiency: number | null) => ({
    count, avgTradeROI: null, avgStarterConversionRate: null, avgTotalPointsContributed: null,
    avgZeroAppearanceRate: null, avgRetainedButUnusedRate: 0.1, avgDeltaEfficiency, avgDeltaPointsLeftOnBench: null,
  })
  const involvement: Array<Record<string, unknown>> = []
  if ((overrides.starterCount ?? 0) > 0) involvement.push({ involvement: 'starter_involved', ...g(overrides.starterCount!, 0.0138) })
  if ((overrides.benchCount ?? 0) > 0) involvement.push({ involvement: 'bench_depth', ...g(overrides.benchCount!, -0.011) })

  return {
    totalTradesConsidered: overrides.totalTradesConsidered ?? 0,
    totalTradesWithLineupData: overrides.totalTradesWithLineupData ?? 0,
    perTradeImpacts: (overrides.perTradeImpacts ?? []) as never,
    avgStarterConversionRate: null, avgBenchConversionRate: null, avgTradeROI: null, avgLineupROI: null,
    avgTotalPointsContributed: null, avgZeroAppearanceRate: null,
    avgRetainedButUnusedRate: overrides.avgRetainedButUnusedRate ?? null,
    avgChurnedAwayRate: overrides.avgChurnedAwayRate ?? null,
    byVerdict: [], byConfidenceTier: [], byFairnessCategory: [],
    byLineupInvolvement: involvement as never,
    matchedWindowAggregate: {
      weeksPerSide: 3, tradesWithMatchedData: overrides.matchedTrades ?? 0,
      avgDeltaEfficiency: overrides.matchedDeltaEff ?? null, avgDeltaPointsLeftOnBench: null,
    },
    lineupImprovementScore: { avgEfficiencyBeforeTrade: null, avgEfficiencyAfterTrade: null, sampleSizeBefore: 0, sampleSizeAfter: 0 },
  }
}

const POPULATED = () => makeSummary({
  totalTradesConsidered: 141, totalTradesWithLineupData: 114,
  avgRetainedButUnusedRate: 0.0944, avgChurnedAwayRate: 0.0646,
  starterCount: 44, benchCount: 70, matchedTrades: 110, matchedDeltaEff: -0.0006545,
})

beforeEach(() => {
  providerState.summary = POPULATED() // provider-reached tests get real data unless overridden
})

afterEach(() => {
  vi.unstubAllEnvs()
  providerState.summary = null
})

describe('GET /api/v1/intelligence/replay-insights — auth / feature flag / tier', () => {
  it('returns 503 when the feature flag is not enabled', async () => {
    // deliberately do NOT call enableApi()
    const res = await GET(makeReq({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }))
    expect(res.status).toBe(503)
  })

  it('returns 401 when the API key header is missing', async () => {
    enableApi()
    const res = await GET(makeReq({ leagueId: 'L1' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when the key tier lacks league:read scope (basic tier)', async () => {
    enableApi()
    const res = await GET(makeReq({ apiKey: BASIC_KEY, leagueId: 'L1' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when leagueId is missing', async () => {
    enableApi()
    const res = await GET(makeReq({ apiKey: COMMISSIONER_KEY }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/intelligence/replay-insights — successful response', () => {
  it('returns 200 with the ManagerReplayInsightSetV1 envelope for a commissioner key', async () => {
    enableApi()
    const res = await GET(makeReq({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.scope).toBe('league')
    expect(body.data.validationSource).toBe('decision_replay_correlation')
    expect(Array.isArray(body.data.insights)).toBe(true)
    expect(body.data.insights.length).toBeGreaterThan(0)
    expect(body.meta.tier).toBe('commissioner')
    expect(body.meta.version).toBe('v1')
    expect(typeof body.meta.requestId).toBe('string')
    expect(body.meta.completeness).toBe(81) // round(114/141 * 100)
  })

  it('returns 200 with an empty insight set (not an error) for a league with no replay corpus', async () => {
    enableApi()
    providerState.summary = makeSummary() // zero trades
    const res = await GET(makeReq({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.insights).toEqual([])
    expect(body.data.tradesAnalyzed).toBe(0)
    expect(body.meta.completeness).toBe(0)
  })
})

describe('GET /api/v1/intelligence/replay-insights — no raw replay ID leakage', () => {
  it('never surfaces a raw replay/league/roster/player ID through the HTTP response', async () => {
    enableApi()
    const SENTINEL = 'SENTINEL-REPLAY-INTERNAL-LEAK-19cd'
    providerState.summary = makeSummary({
      totalTradesConsidered: 44, totalTradesWithLineupData: 44,
      avgRetainedButUnusedRate: 0.1, avgChurnedAwayRate: 0.05,
      starterCount: 44, matchedTrades: 44, matchedDeltaEff: -0.0006,
      perTradeImpacts: [
        { tradeReplayId: SENTINEL, providerLeagueId: SENTINEL, receivingRosterId: SENTINEL, acquiredPlayers: [{ providerAssetId: SENTINEL }] },
      ],
    })
    const res = await GET(makeReq({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }))
    const serialized = JSON.stringify(await res.json())
    expect(serialized).not.toContain(SENTINEL)
    expect(serialized).not.toContain('perTradeImpacts')
    expect(serialized).not.toContain('providerAssetId')
  })
})
