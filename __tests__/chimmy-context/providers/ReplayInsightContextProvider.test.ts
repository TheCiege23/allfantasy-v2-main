/**
 * Phase 22 — ReplayInsightContextProvider tests.
 * Proves the provider gates on the feature flag + league scope, returns the
 * user-safe insight set (never the internal correlation summary), maps the
 * data/no-data states, and never throws. The DB-touching provider factory is
 * mocked; `buildManagerReplayInsights` runs for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DecisionReplayCorrelationSummary } from '@/lib/replay-framework/metrics/decisionReplayCorrelation'

const { providerState } = vi.hoisted(() => ({
  providerState: { summary: null as DecisionReplayCorrelationSummary | null, throwErr: false },
}))

vi.mock('@/lib/decision-os/replay-insights/replayInsightResolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/decision-os/replay-insights/replayInsightResolver')>()
  return {
    ...actual,
    createLiveReplayInsightDataProvider: () => ({
      getReplayCorrelationSummary: async () => {
        if (providerState.throwErr) throw new Error('boom')
        return providerState.summary
      },
    }),
  }
})

import { ReplayInsightContextProvider } from '@/lib/chimmy-context/providers/ReplayInsightContextProvider'

function makeSummary(overrides: Partial<{ totalTradesConsidered: number; totalTradesWithLineupData: number; avgRetainedButUnusedRate: number | null; avgChurnedAwayRate: number | null; starterCount: number; matchedTrades: number; matchedDeltaEff: number | null }> = {}): DecisionReplayCorrelationSummary {
  const involvement: Array<Record<string, unknown>> = []
  if ((overrides.starterCount ?? 0) > 0) {
    involvement.push({ involvement: 'starter_involved', count: overrides.starterCount!, avgTradeROI: null, avgStarterConversionRate: null, avgTotalPointsContributed: null, avgZeroAppearanceRate: null, avgRetainedButUnusedRate: 0.08, avgDeltaEfficiency: 0.0138, avgDeltaPointsLeftOnBench: null })
  }
  return {
    totalTradesConsidered: overrides.totalTradesConsidered ?? 0,
    totalTradesWithLineupData: overrides.totalTradesWithLineupData ?? 0,
    perTradeImpacts: [] as never,
    avgStarterConversionRate: null, avgBenchConversionRate: null, avgTradeROI: null, avgLineupROI: null,
    avgTotalPointsContributed: null, avgZeroAppearanceRate: null,
    avgRetainedButUnusedRate: overrides.avgRetainedButUnusedRate ?? null,
    avgChurnedAwayRate: overrides.avgChurnedAwayRate ?? null,
    byVerdict: [], byConfidenceTier: [], byFairnessCategory: [],
    byLineupInvolvement: involvement as never,
    matchedWindowAggregate: { weeksPerSide: 3, tradesWithMatchedData: overrides.matchedTrades ?? 0, avgDeltaEfficiency: overrides.matchedDeltaEff ?? null, avgDeltaPointsLeftOnBench: null },
    lineupImprovementScore: { avgEfficiencyBeforeTrade: null, avgEfficiencyAfterTrade: null, sampleSizeBefore: 0, sampleSizeAfter: 0 },
  }
}

const REQ = { userId: 'u1', leagueId: 'L1' }

beforeEach(() => {
  providerState.summary = null
  providerState.throwErr = false
})
afterEach(() => vi.unstubAllEnvs())

describe('ReplayInsightContextProvider', () => {
  it('returns status "disabled" when the feature flag is off (default), without hitting the resolver', async () => {
    // flag unset
    const r = await new ReplayInsightContextProvider().load(REQ)
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ status: 'disabled', insightSet: null })
  })

  it('returns status "disabled" when there is no active league', async () => {
    vi.stubEnv('CHIMMY_REPLAY_CONTEXT_ENABLED', 'true')
    const r = await new ReplayInsightContextProvider().load({ userId: 'u1', leagueId: null })
    expect(r.data?.status).toBe('disabled')
  })

  it('returns status "empty" when the league has no completed-trade history', async () => {
    vi.stubEnv('CHIMMY_REPLAY_CONTEXT_ENABLED', 'true')
    providerState.summary = makeSummary() // zero trades → empty insight set
    const r = await new ReplayInsightContextProvider().load(REQ)
    expect(r.ok).toBe(true)
    expect(r.data?.status).toBe('empty')
  })

  it('returns status "ready" with a user-safe insight set when the league has replay data', async () => {
    vi.stubEnv('CHIMMY_REPLAY_CONTEXT_ENABLED', 'true')
    providerState.summary = makeSummary({ totalTradesConsidered: 141, totalTradesWithLineupData: 114, avgRetainedButUnusedRate: 0.0944, avgChurnedAwayRate: 0.0646, starterCount: 44, matchedTrades: 110, matchedDeltaEff: -0.0006545 })
    const r = await new ReplayInsightContextProvider().load(REQ)
    expect(r.ok).toBe(true)
    expect(r.data?.status).toBe('ready')
    expect(r.data?.insightSet?.insights.length).toBeGreaterThan(0)
    // The slice carries ONLY the user-safe contract — never the internal summary shape.
    const serialized = JSON.stringify(r.data)
    expect(serialized).not.toContain('perTradeImpacts')
    expect(serialized).not.toContain('byLineupInvolvement')
    expect(serialized).not.toContain('avgTradeROI')
  })

  it('never throws — a resolver failure surfaces as ok:false, not a rejection', async () => {
    vi.stubEnv('CHIMMY_REPLAY_CONTEXT_ENABLED', 'true')
    providerState.throwErr = true
    const r = await new ReplayInsightContextProvider().load(REQ)
    expect(r.ok).toBe(false)
    expect(r.data).toBeNull()
    expect(typeof r.error).toBe('string')
  })
})
