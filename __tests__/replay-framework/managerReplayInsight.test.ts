/**
 * Decision OS Replay Framework Phase 17 — Manager OS Replay Insight coverage.
 * Proves the insight contract/formatter is: (1) leak-proof — no raw replay
 * IDs or internals ever reach the output; (2) deterministic — identical
 * inputs produce byte-identical copy; (3) honest about small samples — a
 * low-sample caveat appears exactly when the backing sample is too small,
 * and is absent when it is large; and (4) a faithful, user-safe rendering
 * of the Phase 16 validated finding.
 */
import { describe, it, expect } from 'vitest'
import {
  buildManagerReplayInsights,
  REPLAY_INSIGHT_VERSION,
  type DecisionReplayCorrelationSummaryLike,
} from '@/lib/replay-framework/insights/managerReplayInsight'
import type { DecisionReplayCorrelationSummary } from '@/lib/replay-framework/metrics/decisionReplayCorrelation'

const FIXED_NOW = new Date('2026-07-07T00:00:00.000Z')

function makeGroupStats(overrides: Record<string, unknown> = {}) {
  return {
    count: 0,
    avgTradeROI: null,
    avgStarterConversionRate: null,
    avgTotalPointsContributed: null,
    avgZeroAppearanceRate: null,
    avgRetainedButUnusedRate: null,
    avgDeltaEfficiency: null,
    avgDeltaPointsLeftOnBench: null,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<{
  totalTradesConsidered: number
  totalTradesWithLineupData: number
  avgRetainedButUnusedRate: number | null
  avgChurnedAwayRate: number | null
  starter: Record<string, unknown> | null
  bench: Record<string, unknown> | null
  matchedTrades: number
  matchedDeltaEff: number | null
  perTradeImpacts: unknown[]
}> = {}): DecisionReplayCorrelationSummary {
  const involvement: Array<Record<string, unknown>> = []
  if (overrides.starter !== null) involvement.push({ involvement: 'starter_involved', ...makeGroupStats(overrides.starter ?? {}) })
  if (overrides.bench !== null) involvement.push({ involvement: 'bench_depth', ...makeGroupStats(overrides.bench ?? {}) })

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

/** The real Phase 16 staging numbers, so the test doubles as a regression lock on the validated finding's user-safe rendering. */
function makeValidatedSummary(): DecisionReplayCorrelationSummary {
  return makeSummary({
    totalTradesConsidered: 141,
    totalTradesWithLineupData: 114,
    avgRetainedButUnusedRate: 0.0944,
    avgChurnedAwayRate: 0.0646,
    starter: { count: 44, avgDeltaEfficiency: 0.013825, avgRetainedButUnusedRate: 0.0758, avgTradeROI: 0.052 },
    bench: { count: 70, avgDeltaEfficiency: -0.010969, avgRetainedButUnusedRate: 0.1143, avgTradeROI: 0.0395 },
    matchedTrades: 110,
    matchedDeltaEff: -0.0006545,
  })
}

describe('buildManagerReplayInsights — leak safety', () => {
  it('never leaks a raw replay ID / league ID / roster ID from perTradeImpacts into any output string', () => {
    const SENTINEL = 'SENTINEL-REPLAY-INTERNAL-LEAK-9f8e7d'
    const poisoned = makeSummary({
      totalTradesConsidered: 44,
      starter: { count: 44, avgDeltaEfficiency: 0.0138, avgRetainedButUnusedRate: 0.076 },
      matchedTrades: 44,
      matchedDeltaEff: -0.0006,
      perTradeImpacts: [
        { tradeReplayId: SENTINEL, providerLeagueId: SENTINEL, receivingRosterId: SENTINEL, verdict: SENTINEL, acquiredPlayers: [{ providerAssetId: SENTINEL, name: SENTINEL }] },
      ],
    })

    const set = buildManagerReplayInsights(poisoned, { scope: 'platform', now: FIXED_NOW })
    const serialized = JSON.stringify(set)

    expect(serialized).not.toContain(SENTINEL)
    expect(serialized).not.toContain('tradeReplayId')
    expect(serialized).not.toContain('providerLeagueId')
    expect(serialized).not.toContain('receivingRosterId')
    expect(serialized).not.toContain('providerAssetId')
  })

  it('exposes only the curated V1 fields on each insight — no internal metric names', () => {
    const set = buildManagerReplayInsights(makeValidatedSummary(), { scope: 'platform', now: FIXED_NOW })
    for (const insight of set.insights) {
      expect(Object.keys(insight).sort()).toEqual(
        ['category', 'caveat', 'confidence', 'detail', 'displayValue', 'headline', 'insightId', 'sampleSize', 'sentiment'],
      )
    }
  })
})

describe('buildManagerReplayInsights — determinism', () => {
  it('produces byte-identical insight copy across calls with identical inputs (clock-independent)', () => {
    const summary = makeValidatedSummary()
    const a = buildManagerReplayInsights(summary, { scope: 'manager' }) // no `now` → default clock
    const b = buildManagerReplayInsights(summary, { scope: 'manager' })
    // The copy path must not depend on wall-clock time.
    expect(a.insights).toEqual(b.insights)
  })

  it('is fully deterministic (including derivedAt) when `now` is injected', () => {
    const summary = makeValidatedSummary()
    const a = buildManagerReplayInsights(summary, { scope: 'platform', now: FIXED_NOW })
    const b = buildManagerReplayInsights(summary, { scope: 'platform', now: FIXED_NOW })
    expect(a).toEqual(b)
    expect(a.version).toBe(REPLAY_INSIGHT_VERSION)
    expect(a.derivedAt).toBe('2026-07-07T00:00:00.000Z')
  })
})

describe('buildManagerReplayInsights — low-sample caveats', () => {
  it('attaches a caveat citing the platform baseline when the backing sample is small', () => {
    const smallSample = makeSummary({
      totalTradesConsidered: 2,
      starter: { count: 2, avgDeltaEfficiency: 0.02, avgRetainedButUnusedRate: 0.1 },
      bench: null,
      matchedTrades: 2,
      matchedDeltaEff: 0.01,
    })

    const set = buildManagerReplayInsights(smallSample, { scope: 'manager', now: FIXED_NOW })
    const starter = set.insights.find((i) => i.category === 'starter_impact_trades')!
    expect(starter.confidence).toBe('insufficient')
    expect(starter.caveat).not.toBeNull()
    expect(starter.caveat).toContain('Based on only 2 of your trades')
    expect(starter.caveat).toContain('+1.4 pts') // cites the validated baseline
  })

  it('omits the caveat entirely at high sample size', () => {
    const set = buildManagerReplayInsights(makeValidatedSummary(), { scope: 'platform', now: FIXED_NOW })
    const starter = set.insights.find((i) => i.category === 'starter_impact_trades')!
    expect(starter.confidence).toBe('high')
    expect(starter.caveat).toBeNull()
  })

  it('uses the singular "trade" in the caveat when exactly one trade backs it', () => {
    const oneTrade = makeSummary({
      totalTradesConsidered: 1,
      starter: { count: 1, avgDeltaEfficiency: 0.03, avgRetainedButUnusedRate: 0 },
      bench: null,
    })
    const set = buildManagerReplayInsights(oneTrade, { scope: 'manager', now: FIXED_NOW })
    const starter = set.insights.find((i) => i.category === 'starter_impact_trades')!
    expect(starter.caveat).toContain('Based on only 1 of your trade —')
  })
})

describe('buildManagerReplayInsights — faithful rendering of the Phase 16 validated finding', () => {
  const set = buildManagerReplayInsights(makeValidatedSummary(), { scope: 'platform', now: FIXED_NOW })

  it('renders the starter-impact trade insight as a positive +1.4 pts efficiency gain', () => {
    const starter = set.insights.find((i) => i.category === 'starter_impact_trades')!
    expect(starter.displayValue).toBe('+1.4 pts efficiency')
    expect(starter.sentiment).toBe('positive')
    expect(starter.sampleSize).toBe(44)
  })

  it('renders the bench-depth trade insight as a cautionary -1.1 pts efficiency change', () => {
    const bench = set.insights.find((i) => i.category === 'bench_depth_trades')!
    expect(bench.displayValue).toBe('-1.1 pts efficiency')
    expect(bench.sentiment).toBe('caution')
    expect(bench.sampleSize).toBe(70)
  })

  it('renders the wasted-acquisition insight from the real retained-but-unused rate', () => {
    const wasted = set.insights.find((i) => i.category === 'wasted_acquisitions')!
    expect(wasted.displayValue).toBe('9% unused')
    expect(wasted.headline).toContain('9% of acquired players never started')
  })

  it('renders the overall lineup-efficiency-impact insight as the honest near-null result', () => {
    const impact = set.insights.find((i) => i.category === 'lineup_efficiency_impact')!
    expect(impact.displayValue).toBe('-0.1 pts')
    expect(impact.headline).toContain("didn't measurably change")
    expect(impact.sentiment).toBe('neutral')
  })

  it('stamps the set envelope with scope, validation source, and counts', () => {
    expect(set.scope).toBe('platform')
    expect(set.validationSource).toBe('decision_replay_correlation')
    expect(set.tradesAnalyzed).toBe(141)
    expect(set.tradesWithLineupData).toBe(114)
    expect(set.insights).toHaveLength(4)
  })
})

describe('buildManagerReplayInsights — empty/degenerate input', () => {
  it('returns an empty insight set (no throw, no NaN) for a corpus with no trades', () => {
    const set = buildManagerReplayInsights(makeSummary(), { scope: 'league', now: FIXED_NOW })
    expect(set.insights).toEqual([])
    expect(set.tradesAnalyzed).toBe(0)
  })
})

// Type-only assertion: the exported convenience alias stays assignable from the real summary,
// so the formatter and the Phase 16 module can never silently drift apart.
const _typeCheck: DecisionReplayCorrelationSummaryLike = makeSummary()
void _typeCheck
