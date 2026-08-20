/**
 * Phase 20 — internal Manager Replay Insights route test.
 *
 * Exercises the real GET export of app/api/leagues/[leagueId]/replay-insights/route.ts
 * — the INTERNAL, session-authenticated, league-scoped A1 path (server-side
 * resolver consumption, NOT the public keyed Intelligence API). Auth (session),
 * tenant scope (league role), the disabled feature gate, a successful response,
 * an empty corpus, and no raw-replay-ID leakage all run without any DB access:
 * next-auth, the league-permission helper, and the DB-touching provider factory
 * are mocked; `buildManagerReplayInsights` runs for real.
 */
import { vi, describe, it, expect, afterEach } from 'vitest'
import type { DecisionReplayCorrelationSummary } from '@/lib/replay-framework/metrics/decisionReplayCorrelation'

const { sessionState, roleState, providerState } = vi.hoisted(() => ({
  sessionState: { session: null as { user?: { id?: string } } | null },
  roleState: { role: null as 'commissioner' | 'member' | 'viewer' | null },
  providerState: { summary: null as DecisionReplayCorrelationSummary | null },
}))

vi.mock('next-auth', () => ({ getServerSession: async () => sessionState.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: async () => roleState.role }))
vi.mock('@/lib/decision-os/replay-insights/replayInsightResolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/decision-os/replay-insights/replayInsightResolver')>()
  return {
    ...actual,
    createLiveReplayInsightDataProvider: () => ({
      getReplayCorrelationSummary: async () => providerState.summary,
    }),
  }
})

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/leagues/[leagueId]/replay-insights/handler'

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/leagues/L1/replay-insights')
}
function call() {
  return GET(makeReq(), { params: Promise.resolve({ leagueId: 'L1' }) })
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

function enableCard() {
  vi.stubEnv('MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED', 'true')
}

afterEach(() => {
  vi.unstubAllEnvs()
  sessionState.session = null
  roleState.role = null
  providerState.summary = null
})

describe('GET /api/leagues/[leagueId]/replay-insights — feature gate', () => {
  it('returns { enabled: false } (200) and does not auth when the dashboard flag is off', async () => {
    vi.stubEnv('MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED', 'false')
    sessionState.session = null // no session — but must not 401 because the gate short-circuits first
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
  })
})

describe('GET /api/leagues/[leagueId]/replay-insights — auth / tenant scope', () => {
  it('returns 401 when there is no session', async () => {
    enableCard()
    sessionState.session = null
    const res = await call()
    expect(res.status).toBe(401)
  })

  it('returns 403 when the user has no role in the league', async () => {
    enableCard()
    sessionState.session = { user: { id: 'u1' } }
    roleState.role = null
    const res = await call()
    expect(res.status).toBe(403)
  })

  it('returns 200 for a league member', async () => {
    enableCard()
    sessionState.session = { user: { id: 'u1' } }
    roleState.role = 'member'
    providerState.summary = POPULATED()
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.data.scope).toBe('league')
    expect(body.data.insights.length).toBeGreaterThan(0)
  })
})

describe('GET /api/leagues/[leagueId]/replay-insights — data states', () => {
  it('returns enabled with an empty insight set for a league with no replay corpus', async () => {
    enableCard()
    sessionState.session = { user: { id: 'u1' } }
    roleState.role = 'commissioner'
    providerState.summary = makeSummary() // zero trades
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.data.insights).toEqual([])
  })

  it('never leaks a raw replay/roster/player ID from perTradeImpacts into the response', async () => {
    enableCard()
    sessionState.session = { user: { id: 'u1' } }
    roleState.role = 'member'
    const SENTINEL = 'SENTINEL-REPLAY-INTERNAL-LEAK-20ef'
    providerState.summary = makeSummary({
      totalTradesConsidered: 44, totalTradesWithLineupData: 44,
      avgRetainedButUnusedRate: 0.1, avgChurnedAwayRate: 0.05,
      starterCount: 44, matchedTrades: 44, matchedDeltaEff: -0.0006,
      perTradeImpacts: [{ tradeReplayId: SENTINEL, providerLeagueId: SENTINEL, acquiredPlayers: [{ providerAssetId: SENTINEL }] }],
    })
    const res = await call()
    const serialized = JSON.stringify(await res.json())
    expect(serialized).not.toContain(SENTINEL)
    expect(serialized).not.toContain('perTradeImpacts')
  })
})
