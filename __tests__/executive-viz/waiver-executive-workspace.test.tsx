/**
 * Fantasy OS Suite — Phase V2.5: Waiver OS Executive Analytics Workspace.
 *
 * Covers the Waiver Impact Sequence flagship + two supporting graphs, their provider-agnostic builders,
 * populated/empty/unavailable states, recommendation ordering, urgency + impact mapping, confidence
 * display, the mandatory "ordered sequence, NOT a fake timeline" rule, the deferred Resource Strategy,
 * player-context restraint, provider abstraction, hierarchy, and reuse of the shared engine primitives.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import type { Recommendation, RecommendationPriority, RecommendationConfidence, RecommendationCategory } from '@/lib/decision-os/phase6/recommendations/types'
import {
  buildWaiverImpactSequence,
  buildWaiverOpportunityImpact,
  buildWaiverUrgency,
  WAIVER_RESOURCE_STRATEGY_DEFERRED,
} from '@/lib/executive-viz/waiverDecisionViewModel'
import WaiverImpactSequence from '@/components/executive-viz/WaiverImpactSequence'
import { WaiverOpportunityImpactCard, WaiverUrgencyCard } from '@/components/executive-viz/WaiverSupportingViz'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

function makeRec(
  id: string,
  priority: RecommendationPriority,
  confidence: RecommendationConfidence = 'high',
  category: RecommendationCategory = 'waiver_opportunity',
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
    expectedImpact: 'Upgrade your flex spot.',
    derivation: [],
    evidence: [],
    benchmarkComparison: null,
    prerequisites: [],
    recommendedActions: [{ action: 'Submit a claim before processing.', rationale: 'because' }],
    rollbackCriteria: [],
    completeness: 80,
    uncertainty: [],
  }
}

function makeSnapshot(recs: Recommendation[]): ManagerCommandCenterSnapshot {
  return {
    generatedAt: '2026-07-10T12:00:00.000Z',
    totalLeagues: 2,
    healthyLeagueCount: 2,
    atRiskLeagueCount: 0,
    unavailableLeagueCount: 0,
    leagueSummaries: [],
    attentionQueue: [],
    recommendations: recs.map((r) => ({ leagueId: 'a', recommendation: r })),
    leagueTrends: [],
    warnings: [],
  }
}

const WAIVER_RECS = [
  makeRec('w1', 'critical', 'high'),
  makeRec('w2', 'high', 'medium'),
  makeRec('w3', 'low', 'high'),
  makeRec('t1', 'critical', 'high', 'trade_coaching'), // NOT a waiver → excluded
]

describe('buildWaiverImpactSequence (Phase V2.5)', () => {
  it('orders waiver opportunities by existing recommendation priority and excludes non-waivers', () => {
    const vm = buildWaiverImpactSequence(makeSnapshot(WAIVER_RECS))
    expect(vm.opportunities.map((o) => o.key)).toEqual(['w1', 'w2', 'w3'])
    expect(vm.urgentCount).toBe(2) // critical + high
    expect(vm.totalCount).toBe(3)
    expect(vm.headline).toContain('cannot wait')
  })

  it('MANDATORY: exposes no temporal data — an ordered sequence, never a fabricated timeline', () => {
    const vm = buildWaiverImpactSequence(makeSnapshot(WAIVER_RECS))
    expect(vm.hasTemporalData).toBe(false)
    // No opportunity carries a deadline/date/expiration field.
    for (const o of vm.opportunities) {
      expect(Object.keys(o)).not.toContain('deadline')
      expect(Object.keys(o)).not.toContain('expiresAt')
      expect(Object.keys(o)).not.toContain('processAt')
    }
  })

  it('surfaces confidence and the required action in the decision detail', () => {
    const vm = buildWaiverImpactSequence(makeSnapshot(WAIVER_RECS))
    expect(vm.opportunities[0].confidenceLabel).toBe('High confidence')
    expect(vm.opportunities[0].detail).toContain('Submit a claim')
  })

  it('is empty (not fabricated) with no waiver recs, and unavailable with no snapshot', () => {
    const empty = buildWaiverImpactSequence(makeSnapshot([]))
    expect(empty.opportunities).toHaveLength(0)
    expect(empty.available).toBe(true)
    expect(empty.headline).toContain('No waiver opportunities')

    const unavailable = buildWaiverImpactSequence(null)
    expect(unavailable.available).toBe(false)
  })
})

describe('buildWaiverOpportunityImpact + buildWaiverUrgency (Phase V2.5)', () => {
  it('maps impact to the engine priority tiers (no invented scores) and ranks them', () => {
    const model = buildWaiverOpportunityImpact(makeSnapshot(WAIVER_RECS))
    expect(model.items.map((i) => i.key)).toEqual(['critical', 'high', 'low']) // medium has 0 → filtered
    expect(model.items.every((i) => i.max === 3)).toBe(true)
    expect(model.headline).toContain('total')
  })

  it('uses correct singular/plural grammar for the impact headline', () => {
    expect(buildWaiverOpportunityImpact(makeSnapshot([makeRec('w1', 'low')])).headline).toBe(
      '1 low priority opportunity leads the board (1 total).',
    )
  })

  it('is unavailable without a snapshot, empty with no waiver recs', () => {
    expect(buildWaiverOpportunityImpact(null).available).toBe(false)
    expect(buildWaiverOpportunityImpact(makeSnapshot([])).items).toHaveLength(0)
  })

  it('computes the share of decisions that cannot wait', () => {
    const model = buildWaiverUrgency(makeSnapshot(WAIVER_RECS))
    expect(model.urgentCount).toBe(2)
    expect(model.totalCount).toBe(3)
    expect(model.urgentPct).toBe(67)
    expect(model.headline).toContain('2 of 3')
  })

  it('reads clean (grammatically) when nothing is urgent or nothing is open', () => {
    expect(buildWaiverUrgency(makeSnapshot([makeRec('w9', 'low')])).headline).toBe(
      'Your one waiver opportunity is not urgent.',
    )
    expect(buildWaiverUrgency(makeSnapshot([makeRec('w9', 'low'), makeRec('w8', 'medium')])).headline).toBe(
      'None of your 2 waiver opportunities are urgent.',
    )
    expect(buildWaiverUrgency(makeSnapshot([])).headline).toContain('Nothing on the waiver wire')
  })

  it('Resource Strategy is deliberately deferred, not fabricated', () => {
    expect(WAIVER_RESOURCE_STRATEGY_DEFERRED.deferred).toBe(true)
    expect(WAIVER_RESOURCE_STRATEGY_DEFERRED.reason).toContain('not exposed by any customer-facing route')
    // Nothing in the waiver view model invents FAAB/bid/budget numbers.
    const source = readSource('lib', 'executive-viz', 'waiverDecisionViewModel.ts')
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n')
    expect(codeOnly).not.toMatch(/faabRemaining|faabBudget|bidAmount/)
  })
})

describe('Waiver OS components — states, accessibility, provider abstraction (Phase V2.5)', () => {
  it('render populated with accessible summaries and no provider/player/API names', () => {
    const s = makeSnapshot(WAIVER_RECS)
    const cards = [
      <WaiverImpactSequence key="1" snapshot={s} />,
      <WaiverOpportunityImpactCard key="2" snapshot={s} />,
      <WaiverUrgencyCard key="3" snapshot={s} />,
    ]
    for (const card of cards) {
      const { container, unmount } = render(card)
      expect(container.querySelector('[data-testid="executive-viz-summary"]')).not.toBeNull()
      const text = (container.textContent ?? '').toLowerCase()
      for (const banned of ['sleeper', 'espn', 'yahoo', 'fantrax', 'payload', 'resolver', 'decision os', 'platformuserid', 'ownership%']) {
        expect(text).not.toContain(banned)
      }
      unmount()
    }
  })

  it('the flagship renders numbered priority steps and states it is ordered, not dated', () => {
    render(<WaiverImpactSequence snapshot={makeSnapshot(WAIVER_RECS)} />)
    expect(screen.getByText('Waiver Impact Sequence')).toBeTruthy()
    expect(screen.getByTestId('waiver-step-w1')).toBeTruthy()
    expect(screen.getByText(/Ordered by priority, not by date/)).toBeTruthy()
  })

  it('the flagship shows honest empty and unavailable states', () => {
    const { unmount } = render(<WaiverImpactSequence snapshot={makeSnapshot([])} />)
    expect(screen.getByTestId('executive-viz-empty')).toBeTruthy()
    unmount()
    render(<WaiverImpactSequence snapshot={null} />)
    expect(screen.getByTestId('executive-viz-unavailable')).toBeTruthy()
  })

  it('Waiver Urgency exposes an accessible ring meter', () => {
    render(<WaiverUrgencyCard snapshot={makeSnapshot(WAIVER_RECS)} />)
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('67')
  })
})

describe('Waiver OS hierarchy + engine reuse (Phase V2.5)', () => {
  it('ManagerCommandCenterSection renders the Waiver OS workspace and drops the duplicate Waiver Priorities module', () => {
    const source = readSource('components', 'decision-os', 'ManagerCommandCenterSection.tsx')
    expect(source).toContain('waiver-os-workspace')
    expect(source).toContain('WaiverImpactSequence')
    expect(source).not.toContain('title="Waiver Priorities"')
    expect(source).not.toContain("'waiver_opportunity'")
  })

  it('ExecutiveDecisionSequence is a shared primitive with three real consumers', () => {
    expect(readSource('components', 'executive-viz', 'ExecutiveCharts.tsx')).toContain('export function ExecutiveDecisionSequence')
    for (const file of ['ManagerSupportingViz.tsx', 'TradeSupportingViz.tsx', 'WaiverImpactSequence.tsx']) {
      expect(readSource('components', 'executive-viz', file)).toContain('ExecutiveDecisionSequence')
    }
  })

  it('the waiver flagship reuses the shared shell (no one-off chart library)', () => {
    expect(readSource('components', 'executive-viz', 'WaiverImpactSequence.tsx')).toContain('ExecutiveVisualizationShell')
  })
})
