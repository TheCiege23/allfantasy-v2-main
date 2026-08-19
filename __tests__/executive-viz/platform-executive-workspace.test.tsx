/**
 * Fantasy OS Suite — Phase V2.7: Platform OS Executive Analytics Workspace.
 *
 * Covers the Platform Focus flagship + two supporting graphs, their provider-agnostic builders,
 * populated/empty/unavailable states, cross-OS focus ranking, workload/attention distributions, the
 * mandatory "no platform history/trend — a current-state focus view, not a fabricated Pulse" rule,
 * provider abstraction, hierarchy, and reuse of the shared engine primitives.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import type { Recommendation, RecommendationPriority, RecommendationCategory } from '@/lib/decision-os/phase6/recommendations/types'
import type { DecisionOsAttentionSignal, AttentionSignalSeverity } from '@/lib/decision-os/attentionSignals'
import {
  buildPlatformFocus,
  buildExecutiveWorkload,
  buildAttentionSummary,
  PLATFORM_TREND_ANALYTICS_DEFERRED,
} from '@/lib/executive-viz/platformFocusViewModel'
import PlatformFocus from '@/components/executive-viz/PlatformFocus'
import { ExecutiveWorkloadCard, AttentionSummaryCard } from '@/components/executive-viz/PlatformSupportingViz'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

function makeRec(id: string, priority: RecommendationPriority, category: RecommendationCategory): Recommendation {
  return {
    id,
    tier: 'manager',
    category,
    entityId: 'manager-1',
    priority,
    severity: 'standard',
    confidence: 'high',
    affectedDimensions: [],
    expectedImpact: 'Improve your footprint.',
    derivation: [],
    evidence: [],
    benchmarkComparison: null,
    prerequisites: [],
    recommendedActions: [{ action: 'Do the thing.', rationale: 'because' }],
    rollbackCriteria: [],
    completeness: 80,
    uncertainty: [],
  }
}

function makeSignal(id: string, severity: AttentionSignalSeverity): DecisionOsAttentionSignal {
  return {
    id,
    leagueId: 'a',
    type: 'manager_recommendation',
    severity,
    priorityScore: 100,
    title: 'Signal',
    explanation: 'A signal',
    recommendedAction: null,
    timestamp: '2026-07-10T12:00:00.000Z',
    source: 'user_os',
  }
}

function makeSnapshot(overrides: Partial<ManagerCommandCenterSnapshot> = {}): ManagerCommandCenterSnapshot {
  return {
    generatedAt: '2026-07-10T12:00:00.000Z',
    totalLeagues: 3,
    healthyLeagueCount: 2,
    atRiskLeagueCount: 1,
    unavailableLeagueCount: 0,
    leagueSummaries: [],
    attentionQueue: [makeSignal('s1', 'critical'), makeSignal('s2', 'high'), makeSignal('s3', 'low')],
    recommendations: [
      makeRec('w1', 'critical', 'waiver_opportunity'),
      makeRec('w2', 'high', 'waiver_opportunity'),
      makeRec('t1', 'medium', 'trade_coaching'),
      makeRec('l1', 'low', 'lineup_discipline'),
      makeRec('e1', 'low', 'engagement_boost'),
    ].map((r) => ({ leagueId: 'a', recommendation: r })),
    leagueTrends: [],
    warnings: [],
    ...overrides,
  }
}

describe('buildPlatformFocus (Phase V2.7)', () => {
  it('rolls recommendations up into ranked Operating-System focus areas', () => {
    const vm = buildPlatformFocus(makeSnapshot(), 1)
    expect(vm.available).toBe(true)
    // Waivers has the critical rec -> highest severity -> first
    expect(vm.areas[0].key).toBe('waivers')
    expect(vm.areas[0].openCount).toBe(2)
    expect(vm.areas[0].urgentCount).toBe(2)
    expect(vm.totalOpenDecisions).toBe(5)
    expect(vm.totalLeagues).toBe(3)
    expect(vm.leaguesNeedingAttention).toBe(1)
    expect(vm.draftsApproaching).toBe(1)
    expect(vm.headline).toContain('Waivers')
  })

  it('MANDATORY: exposes no platform history — a current-state focus view, not a Pulse', () => {
    const vm = buildPlatformFocus(makeSnapshot(), 0)
    expect(vm.hasPlatformHistory).toBe(false)
    for (const a of vm.areas) {
      expect(Object.keys(a)).not.toContain('trend')
      expect(Object.keys(a)).not.toContain('history')
      expect(Object.keys(a)).not.toContain('momentum')
    }
  })

  it('reads clean when nothing needs attention, and is unavailable without a snapshot', () => {
    const clean = buildPlatformFocus(makeSnapshot({ recommendations: [], attentionQueue: [], atRiskLeagueCount: 0 }), 0)
    expect(clean.areas).toHaveLength(0)
    expect(clean.headline).toContain('Nothing needs your attention')
    expect(buildPlatformFocus(null, 0).available).toBe(false)
  })
})

describe('buildExecutiveWorkload + buildAttentionSummary (Phase V2.7)', () => {
  it('buckets all open decisions by priority', () => {
    const model = buildExecutiveWorkload(makeSnapshot())
    expect(model.items.map((i) => i.key)).toEqual(['critical', 'high', 'medium', 'low']) // all present
    expect(model.items.find((i) => i.key === 'low')!.value).toBe(2) // lineup + engagement
    expect(model.headline).toContain('2 high priority')
  })

  it('buckets attention signals by severity, and both handle empty + unavailable', () => {
    const model = buildAttentionSummary(makeSnapshot())
    expect(model.items.map((i) => i.key)).toEqual(['critical', 'high', 'low'])
    expect(model.headline).toContain('1 critical')

    expect(buildExecutiveWorkload(makeSnapshot({ recommendations: [] })).items).toHaveLength(0)
    expect(buildAttentionSummary(makeSnapshot({ attentionQueue: [] })).items).toHaveLength(0)
    expect(buildExecutiveWorkload(null).available).toBe(false)
    expect(buildAttentionSummary(null).available).toBe(false)
  })

  it('platform history/trend analytics are deferred, not fabricated', () => {
    expect(PLATFORM_TREND_ANALYTICS_DEFERRED.deferred).toBe(true)
    expect(PLATFORM_TREND_ANALYTICS_DEFERRED.reason).toContain('No platform-level historical')
  })
})

describe('Platform OS components — states, accessibility, provider abstraction (Phase V2.7)', () => {
  it('render populated with accessible summaries and no provider/player names', () => {
    const s = makeSnapshot()
    const cards = [
      <PlatformFocus key="1" snapshot={s} draftsApproachingCount={1} />,
      <ExecutiveWorkloadCard key="2" snapshot={s} />,
      <AttentionSummaryCard key="3" snapshot={s} />,
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

  it('the flagship renders footprint KPIs and the ranked focus bars', () => {
    render(<PlatformFocus snapshot={makeSnapshot()} draftsApproachingCount={1} />)
    expect(screen.getByText('Platform Focus')).toBeTruthy()
    expect(screen.getByTestId('executive-bar-waivers')).toBeTruthy()
    // meters: 4 focus bars (waivers/trades/lineups/engagement)
    expect(screen.getAllByRole('meter').length).toBe(4)
  })

  it('the flagship shows an honest all-clear and unavailable state', () => {
    const { unmount } = render(
      <PlatformFocus snapshot={makeSnapshot({ recommendations: [], attentionQueue: [], atRiskLeagueCount: 0 })} draftsApproachingCount={0} />,
    )
    expect(screen.getByTestId('executive-viz-empty')).toBeTruthy()
    unmount()
    render(<PlatformFocus snapshot={null} draftsApproachingCount={0} />)
    expect(screen.getByTestId('executive-viz-unavailable')).toBeTruthy()
  })
})

describe('Platform OS hierarchy + engine reuse (Phase V2.7)', () => {
  it('ManagerCommandCenterSection renders the Platform OS workspace ABOVE the Manager workspace', () => {
    const source = readSource('components', 'decision-os', 'ManagerCommandCenterSection.tsx')
    expect(source).toContain('platform-os-workspace')
    expect(source).toContain('PlatformFocus')
    for (const card of ['ExecutiveWorkloadCard', 'AttentionSummaryCard']) {
      expect(source).toContain(card)
    }
    // Platform OS must appear before the Manager OS workspace (executive layer above).
    expect(source.indexOf('platform-os-workspace')).toBeLessThan(source.indexOf('manager-executive-workspace'))
  })

  it('the flagship + supporting reuse shared engine primitives (no one-off chart library)', () => {
    expect(readSource('components', 'executive-viz', 'PlatformFocus.tsx')).toContain('ExecutiveHorizontalBars')
    expect(readSource('components', 'executive-viz', 'PlatformFocus.tsx')).toContain('ExecutiveVisualizationShell')
    expect(readSource('components', 'executive-viz', 'PlatformSupportingViz.tsx')).toContain('ExecutiveHorizontalBars')
  })
})
