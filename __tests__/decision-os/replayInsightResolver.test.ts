/**
 * Decision OS Replay Framework Phase 18 — Manager OS Replay Insight resolver
 * coverage. Proves the thin read-only handler: (1) is protected by the
 * existing intelligence-API auth/tenant gate (flag/key/scope); (2) produces
 * deterministic user-facing insight copy; (3) leaks no raw replay IDs; and
 * (4) returns 200-with-empty-insights (not an error) for an empty corpus,
 * while the unwired stub returns 503.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  replayInsightHandler,
  stubReplayInsightDataProvider,
  type ReplayInsightDataProvider,
  type ReplayInsightApiResponse,
} from '@/lib/decision-os/replay-insights/replayInsightResolver'
import type { DecisionReplayCorrelationSummary } from '@/lib/replay-framework/metrics/decisionReplayCorrelation'

const FIXED_NOW = new Date('2026-07-07T00:00:00.000Z')

// Valid gate keys: token must be ≥16 alphanumeric chars (afk_{env}_{token}).
const COMMISSIONER_KEY = 'afk_test_commissionerkey0001' // mapped → 'commissioner' (has league:read)
const BASIC_KEY = 'afk_test_unmappedbasickey0001'         // not in map → 'basic' (lacks league:read)

let savedEnabled: string | undefined
let savedKeys: string | undefined

beforeEach(() => {
  savedEnabled = process.env.DECISION_OS_INTELLIGENCE_API_ENABLED
  savedKeys = process.env.INTELLIGENCE_API_TEST_KEYS
  process.env.DECISION_OS_INTELLIGENCE_API_ENABLED = 'true'
  process.env.INTELLIGENCE_API_TEST_KEYS = JSON.stringify({ [COMMISSIONER_KEY]: 'commissioner' })
})

afterEach(() => {
  if (savedEnabled === undefined) delete process.env.DECISION_OS_INTELLIGENCE_API_ENABLED
  else process.env.DECISION_OS_INTELLIGENCE_API_ENABLED = savedEnabled
  if (savedKeys === undefined) delete process.env.INTELLIGENCE_API_TEST_KEYS
  else process.env.INTELLIGENCE_API_TEST_KEYS = savedKeys
})

function makeCtx(opts: { apiKey?: string; leagueId?: string } = {}) {
  const headers = {
    get: (k: string) => (k.toLowerCase() === 'x-allfantasy-api-key' ? (opts.apiKey ?? null) : null),
  }
  const searchParams = new URLSearchParams()
  if (opts.leagueId !== undefined) searchParams.set('leagueId', opts.leagueId)
  return { headers, searchParams }
}

function makeSummary(overrides: Partial<{
  totalTradesConsidered: number
  totalTradesWithLineupData: number
  avgRetainedButUnusedRate: number | null
  avgChurnedAwayRate: number | null
  starterCount: number
  starterDelta: number | null
  benchCount: number
  benchDelta: number | null
  matchedTrades: number
  matchedDeltaEff: number | null
  perTradeImpacts: unknown[]
}> = {}): DecisionReplayCorrelationSummary {
  const g = (count: number, avgDeltaEfficiency: number | null) => ({
    count, avgTradeROI: null, avgStarterConversionRate: null, avgTotalPointsContributed: null,
    avgZeroAppearanceRate: null, avgRetainedButUnusedRate: 0.1, avgDeltaEfficiency, avgDeltaPointsLeftOnBench: null,
  })
  const involvement: Array<Record<string, unknown>> = []
  if ((overrides.starterCount ?? 0) > 0) involvement.push({ involvement: 'starter_involved', ...g(overrides.starterCount!, overrides.starterDelta ?? 0.0138) })
  if ((overrides.benchCount ?? 0) > 0) involvement.push({ involvement: 'bench_depth', ...g(overrides.benchCount!, overrides.benchDelta ?? -0.011) })

  return {
    totalTradesConsidered: overrides.totalTradesConsidered ?? 0,
    totalTradesWithLineupData: overrides.totalTradesWithLineupData ?? 0,
    perTradeImpacts: (overrides.perTradeImpacts ?? []) as never,
    avgStarterConversionRate: null,
    avgBenchConversionRate: null,
    avgTradeROI: null,
    avgLineupROI: null,
    avgTotalPointsContributed: null,
    avgZeroAppearanceRate: null,
    avgRetainedButUnusedRate: overrides.avgRetainedButUnusedRate ?? null,
    avgChurnedAwayRate: overrides.avgChurnedAwayRate ?? null,
    byVerdict: [],
    byConfidenceTier: [],
    byFairnessCategory: [],
    byLineupInvolvement: involvement as never,
    matchedWindowAggregate: {
      weeksPerSide: 3,
      tradesWithMatchedData: overrides.matchedTrades ?? 0,
      avgDeltaEfficiency: overrides.matchedDeltaEff ?? null,
      avgDeltaPointsLeftOnBench: null,
    },
    lineupImprovementScore: { avgEfficiencyBeforeTrade: null, avgEfficiencyAfterTrade: null, sampleSizeBefore: 0, sampleSizeAfter: 0 },
  }
}

function providerReturning(summary: DecisionReplayCorrelationSummary | null): ReplayInsightDataProvider {
  return { getReplayCorrelationSummary: async () => summary }
}

const POPULATED = () => makeSummary({
  totalTradesConsidered: 141, totalTradesWithLineupData: 114,
  avgRetainedButUnusedRate: 0.0944, avgChurnedAwayRate: 0.0646,
  starterCount: 44, starterDelta: 0.013825, benchCount: 70, benchDelta: -0.010969,
  matchedTrades: 110, matchedDeltaEff: -0.0006545,
})

describe('replayInsightHandler — auth/tenant protection', () => {
  it('returns 503 when the intelligence API feature flag is not enabled', async () => {
    process.env.DECISION_OS_INTELLIGENCE_API_ENABLED = 'false'
    const res = await replayInsightHandler(makeCtx({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }), providerReturning(POPULATED()))
    expect(res.status).toBe(503)
  })

  it('returns 401 when the API key header is missing', async () => {
    const res = await replayInsightHandler(makeCtx({ leagueId: 'L1' }), providerReturning(POPULATED()))
    expect(res.status).toBe(401)
  })

  it('returns 403 when the key tier lacks league:read scope (basic tier)', async () => {
    const res = await replayInsightHandler(makeCtx({ apiKey: BASIC_KEY, leagueId: 'L1' }), providerReturning(POPULATED()))
    expect(res.status).toBe(403)
  })

  it('returns 200 for a commissioner-tier key with league:read scope', async () => {
    const res = await replayInsightHandler(makeCtx({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }), providerReturning(POPULATED()), { now: FIXED_NOW })
    expect(res.status).toBe(200)
    const body = res.body as ReplayInsightApiResponse
    expect(body.meta.tier).toBe('commissioner')
    expect(body.data.scope).toBe('league')
  })

  it('returns 400 when leagueId is missing', async () => {
    const res = await replayInsightHandler(makeCtx({ apiKey: COMMISSIONER_KEY }), providerReturning(POPULATED()))
    expect(res.status).toBe(400)
  })

  it('never calls the data provider when the gate rejects the request', async () => {
    let called = false
    const spyProvider: ReplayInsightDataProvider = { getReplayCorrelationSummary: async () => { called = true; return POPULATED() } }
    await replayInsightHandler(makeCtx({ apiKey: BASIC_KEY, leagueId: 'L1' }), spyProvider)
    expect(called).toBe(false)
  })
})

describe('replayInsightHandler — data availability', () => {
  it('returns 503 with the unwired stub provider', async () => {
    const res = await replayInsightHandler(makeCtx({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }), stubReplayInsightDataProvider)
    expect(res.status).toBe(503)
  })

  it('returns 200 with an empty insight set (not an error) for a league with no replay corpus', async () => {
    const res = await replayInsightHandler(makeCtx({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }), providerReturning(makeSummary()), { now: FIXED_NOW })
    expect(res.status).toBe(200)
    const body = res.body as ReplayInsightApiResponse
    expect(body.data.insights).toEqual([])
    expect(body.data.tradesAnalyzed).toBe(0)
    expect(body.meta.completeness).toBe(0)
  })

  it('reports honest completeness as the share of considered trades with usable lineup data', async () => {
    const res = await replayInsightHandler(makeCtx({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }), providerReturning(POPULATED()), { now: FIXED_NOW })
    const body = res.body as ReplayInsightApiResponse
    expect(body.meta.completeness).toBe(81) // round(114/141 * 100)
  })
})

describe('replayInsightHandler — deterministic output', () => {
  it('produces identical user-facing insight copy across calls (clock/requestId-independent)', async () => {
    const summary = POPULATED()
    const a = await replayInsightHandler(makeCtx({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }), providerReturning(summary))
    const b = await replayInsightHandler(makeCtx({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }), providerReturning(summary))
    const bodyA = a.body as ReplayInsightApiResponse
    const bodyB = b.body as ReplayInsightApiResponse
    expect(bodyA.data.insights).toEqual(bodyB.data.insights)
  })
})

describe('replayInsightHandler — no raw replay ID leakage', () => {
  it('never surfaces a raw replay/league/roster/player ID from perTradeImpacts in the response body', async () => {
    const SENTINEL = 'SENTINEL-REPLAY-INTERNAL-LEAK-18ab'
    const poisoned = makeSummary({
      totalTradesConsidered: 44, totalTradesWithLineupData: 44,
      avgRetainedButUnusedRate: 0.1, avgChurnedAwayRate: 0.05,
      starterCount: 44, benchCount: 0, matchedTrades: 44, matchedDeltaEff: -0.0006,
      perTradeImpacts: [
        { tradeReplayId: SENTINEL, providerLeagueId: SENTINEL, receivingRosterId: SENTINEL, acquiredPlayers: [{ providerAssetId: SENTINEL }] },
      ],
    })
    const res = await replayInsightHandler(makeCtx({ apiKey: COMMISSIONER_KEY, leagueId: 'L1' }), providerReturning(poisoned), { now: FIXED_NOW })
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain(SENTINEL)
    expect(serialized).not.toContain('perTradeImpacts')
    expect(serialized).not.toContain('providerAssetId')
  })
})
