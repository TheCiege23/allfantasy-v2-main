/**
 * Phase 22 — Chimmy Historical Replay context renderer tests.
 * Proves `renderReplayInsightSection` (the prompt-layer guardrail): replay
 * context present/absent, the exact disclaimer, an honest empty state, and
 * that it NEVER leaks raw replay/asset IDs, internal correlation objects, or
 * recommendation language.
 */
import { describe, it, expect } from 'vitest'
import { renderReplayInsightSection } from '@/lib/chimmy-context/prompt/sections'
import type { ReplayInsightSlice } from '@/lib/chimmy-context/types'
import type { ManagerReplayInsightSetV1, ManagerReplayInsightV1 } from '@/lib/replay-framework/insights/managerReplayInsight'

const DISCLAIMER = 'Historical replay observations summarize past outcomes and are not recommendations for future decisions.'

function insight(overrides: Partial<ManagerReplayInsightV1> = {}): ManagerReplayInsightV1 {
  return {
    insightId: 'replay_insight_starter_impact_trades',
    category: 'starter_impact_trades',
    headline: 'Your starter-impact trades paid off',
    detail: 'Trades that upgraded your active starting lineup changed your lineup efficiency by about +1.4 pts and left roughly 8% of acquired players unused.',
    displayValue: '+1.4 pts efficiency',
    sentiment: 'positive',
    confidence: 'high',
    sampleSize: 44,
    caveat: null,
    ...overrides,
  }
}

function set(insights: ManagerReplayInsightV1[]): ManagerReplayInsightSetV1 {
  return {
    scope: 'league',
    insights,
    tradesAnalyzed: 141,
    tradesWithLineupData: 114,
    validationSource: 'decision_replay_correlation',
    version: 'replay-insight-v1',
    derivedAt: '2026-07-07T00:00:00.000Z',
  }
}

const READY: ReplayInsightSlice = {
  status: 'ready',
  insightSet: set([
    insight(),
    insight({ insightId: 'replay_insight_bench_depth_trades', category: 'bench_depth_trades', headline: "Bench-depth trades didn't move your lineup", displayValue: '-1.1 pts efficiency', sentiment: 'caution', confidence: 'moderate', sampleSize: 70 }),
    insight({ insightId: 'replay_insight_wasted_acquisitions', category: 'wasted_acquisitions', headline: '9% of acquired players never started', displayValue: '9% unused', sentiment: 'neutral', sampleSize: 141 }),
  ]),
}

describe('renderReplayInsightSection — presence / absence', () => {
  it('renders the observational section when replay context is present', () => {
    const out = renderReplayInsightSection(READY)
    expect(out).toContain('## HISTORICAL REPLAY SUMMARY (observational only)')
    expect(out).toContain('Your starter-impact trades paid off')
    expect(out).toContain('+1.4 pts efficiency')
    expect(out).toContain('Based on 141 completed trades (114 with lineup data).')
  })

  it('renders nothing when the slice is null (absent)', () => {
    expect(renderReplayInsightSection(null)).toBe('')
  })

  it('renders nothing when the feature is disabled', () => {
    expect(renderReplayInsightSection({ status: 'disabled', insightSet: null })).toBe('')
  })

  it('renders an honest empty section (with disclaimer) when there is no replay history', () => {
    const out = renderReplayInsightSection({ status: 'empty', insightSet: null })
    expect(out).toContain('## HISTORICAL REPLAY SUMMARY (observational only)')
    expect(out).toContain('No completed historical replay data is available for this league yet.')
    expect(out).toContain(DISCLAIMER)
  })
})

describe('renderReplayInsightSection — disclaimer', () => {
  it('includes the exact dashboard disclaimer in the ready state', () => {
    expect(renderReplayInsightSection(READY)).toContain(DISCLAIMER)
  })
})

describe('renderReplayInsightSection — no leakage', () => {
  it('never surfaces the internal insightId slug', () => {
    expect(renderReplayInsightSection(READY)).not.toContain('replay_insight_')
  })

  it('never surfaces internal correlation object field names', () => {
    const out = renderReplayInsightSection(READY)
    for (const forbidden of ['perTradeImpacts', 'byLineupInvolvement', 'avgTradeROI', 'deltaThem', 'avgDeltaEfficiency', 'providerAssetId', 'providerLeagueId', 'tradeReplayId']) {
      expect(out).not.toContain(forbidden)
    }
  })

  it('never surfaces the raw provenance token or version', () => {
    const out = renderReplayInsightSection(READY)
    expect(out).not.toContain('decision_replay_correlation')
    expect(out).not.toContain('replay-insight-v1')
  })
})

describe('renderReplayInsightSection — no recommendation language', () => {
  it('emits only descriptive observations, never imperative recommendation phrasing', () => {
    // Note: the disclaimer legitimately contains the noun "recommendations"
    // ("are not recommendations…"); the guardrail is that no *imperative /
    // prescriptive* advice is injected, so we check for those phrasings.
    const lower = renderReplayInsightSection(READY).toLowerCase()
    for (const phrase of ['you should', 'i suggest', 'trade for', 'you ought', 'i advise', 'i recommend', 'we recommend', 'you must']) {
      expect(lower).not.toContain(phrase)
    }
  })
})
