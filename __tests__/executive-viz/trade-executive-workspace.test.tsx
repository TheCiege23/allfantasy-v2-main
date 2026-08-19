/**
 * Fantasy OS Suite — Phase V2.4: Trade OS Executive Analytics Workspace.
 *
 * Covers the Trade Opportunity Matrix flagship + two supporting graphs, their provider-agnostic builders,
 * populated/empty/unavailable states, quadrant placement, recommendation ordering, accessibility, provider
 * abstraction, and workspace hierarchy.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import type { Recommendation, RecommendationPriority, RecommendationConfidence, RecommendationCategory } from '@/lib/decision-os/phase6/recommendations/types'
import {
  buildTradeOpportunityMatrix,
  buildTradeMarketActivity,
  buildTradePipeline,
} from '@/lib/executive-viz/tradeMarketViewModel'
import TradeOpportunityMatrix from '@/components/executive-viz/TradeOpportunityMatrix'
import { MarketActivityCard, TradePipelineCard } from '@/components/executive-viz/TradeSupportingViz'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

function makeRec(
  id: string,
  priority: RecommendationPriority,
  confidence: RecommendationConfidence,
  category: RecommendationCategory = 'trade_coaching',
): Recommendation {
  return {
    id,
    tier: 'manager',
    category,
    entityId: 'manager-1',
    priority,
    severity: 'standard',
    confidence,
    affectedDimensions: [],
    expectedImpact: 'Improve your roster balance.',
    derivation: [],
    evidence: [],
    benchmarkComparison: null,
    prerequisites: [],
    recommendedActions: [{ action: `Pursue the ${category} move`, rationale: 'because' }],
    rollbackCriteria: [],
    completeness: 80,
    uncertainty: [],
  }
}

function makeAnalytics(tradeCount = 6): LeagueAnalyticsSnapshot {
  return {
    leagueId: 'league-1',
    generatedAt: '2026-07-10T12:00:00.000Z',
    available: true,
    trend: { available: true, periodsTracked: 3, earliestPeriodKey: 'a', latestPeriodKey: 'b', latestEventCount: 10, latestManagerCount: 8, eventCountDelta: 4, direction: 'increasing' },
    managerCounts: { activeManagers: 10, inactiveManagers: 2 },
    activity: { tradeCount, waiverClaimCount: 12, draftPickCount: 0, rosterActivityCount: 8 },
    retentionRiskCount: 1,
  }
}

const TRADE_RECS: Recommendation[] = [
  makeRec('t1', 'critical', 'high'), // pursue_now
  makeRec('t2', 'high', 'low'), // investigate
  makeRec('t3', 'low', 'high'), // easy_win
  makeRec('t4', 'medium', 'low', 'trade_activation'), // monitor
  makeRec('w1', 'high', 'high', 'waiver_opportunity'), // NOT a trade → excluded
]

describe('buildTradeOpportunityMatrix (Phase V2.4)', () => {
  it('places each real trade recommendation in the right value×confidence quadrant, excluding non-trades', () => {
    const vm = buildTradeOpportunityMatrix(TRADE_RECS, makeAnalytics())
    expect(vm.opportunities).toHaveLength(4) // waiver excluded
    expect(vm.quadrantCounts).toEqual({ pursue_now: 1, investigate: 1, easy_win: 1, monitor: 1 })
    expect(vm.opportunities[0].quadrant).toBe('pursue_now') // critical/high sorted first
    expect(vm.marketActivity).toBe('active') // tradeCount 6
    expect(vm.headline).toContain('worth pursuing now')
  })

  it('shows an honest empty market (no fabricated opportunities) when there are no trade recs', () => {
    const vm = buildTradeOpportunityMatrix([], makeAnalytics(0))
    expect(vm.opportunities).toHaveLength(0)
    expect(vm.marketActivity).toBe('quiet')
    expect(vm.headline).toContain('market is quiet')
  })
})

describe('buildTradeMarketActivity + buildTradePipeline (Phase V2.4)', () => {
  it('classifies market temperature from real trade count', () => {
    expect(buildTradeMarketActivity(makeAnalytics(0)).activity).toBe('quiet')
    expect(buildTradeMarketActivity(makeAnalytics(2)).activity).toBe('moderate')
    expect(buildTradeMarketActivity(makeAnalytics(9)).activity).toBe('active')
  })

  it('is unavailable when analytics is unavailable', () => {
    const unavailable: LeagueAnalyticsSnapshot = { leagueId: 'x', generatedAt: '2026-07-10T12:00:00.000Z', available: false, reason: 'league_health_unavailable' }
    expect(buildTradeMarketActivity(unavailable).available).toBe(false)
  })

  it('orders the trade pipeline by priority and excludes non-trades', () => {
    const model = buildTradePipeline(TRADE_RECS)
    expect(model.items).toHaveLength(4)
    expect(model.items[0].priorityLabel).toBe('Critical')
    expect(model.items.every((i) => !i.key.startsWith('w'))).toBe(true)
    expect(model.headline).toContain('high-priority')
  })

  it('the pipeline is empty (not fabricated) when there are no trade recs', () => {
    expect(buildTradePipeline([]).items).toHaveLength(0)
    expect(buildTradePipeline(null).items).toHaveLength(0)
  })
})

describe('Trade OS visualization components — states + provider abstraction (Phase V2.4)', () => {
  it('render populated with accessible summaries and no provider/player names', () => {
    const cards = [
      <TradeOpportunityMatrix key="1" recommendations={TRADE_RECS} analytics={makeAnalytics()} />,
      <MarketActivityCard key="2" analytics={makeAnalytics()} />,
      <TradePipelineCard key="3" recommendations={TRADE_RECS} />,
    ]
    for (const card of cards) {
      const { container, unmount } = render(card)
      expect(container.querySelector('[data-testid="executive-viz-summary"]')).not.toBeNull()
      const text = (container.textContent ?? '').toLowerCase()
      for (const banned of ['sleeper', 'espn', 'yahoo', 'fantrax', 'payload', 'resolver', 'decision os', 'platformuserid']) {
        expect(text).not.toContain(banned)
      }
      unmount()
    }
  })

  it('the matrix renders its four quadrants and places the top opportunity in Pursue now', () => {
    render(<TradeOpportunityMatrix recommendations={TRADE_RECS} analytics={makeAnalytics()} />)
    expect(screen.getByText('Trade Opportunity Matrix')).toBeTruthy()
    const pursue = screen.getByTestId('trade-quadrant-pursue_now')
    expect(pursue.textContent).toContain('Pursue now')
  })

  it('the matrix shows an honest empty state when the market has no opportunities', () => {
    render(<TradeOpportunityMatrix recommendations={[]} analytics={makeAnalytics(0)} />)
    expect(screen.getByTestId('executive-viz-empty')).toBeTruthy()
    expect(screen.getByTestId('executive-viz-empty').textContent).toContain('no sample opportunities')
  })

  it('the pipeline renders numbered priority steps', () => {
    render(<TradePipelineCard recommendations={TRADE_RECS} />)
    expect(screen.getByTestId('trade-step-t1')).toBeTruthy()
  })
})

describe('Trade OS workspace hierarchy (Phase V2.4)', () => {
  it('CommissionerHubPageClient renders the Trade OS workspace in League Focus', () => {
    const source = readSource('app', 'commissioner-hub', 'CommissionerHubPageClient.tsx')
    expect(source).toContain('trade-os-workspace')
    expect(source).toContain('TradeOpportunityMatrix')
    for (const card of ['MarketActivityCard', 'TradePipelineCard']) {
      expect(source).toContain(card)
    }
  })

  it('the flagship + supporting reuse the shared shell (no one-off chart libraries)', () => {
    expect(readSource('components', 'executive-viz', 'TradeOpportunityMatrix.tsx')).toContain('ExecutiveVisualizationShell')
    expect(readSource('components', 'executive-viz', 'TradeSupportingViz.tsx')).toContain('ExecutiveVisualizationShell')
  })
})
