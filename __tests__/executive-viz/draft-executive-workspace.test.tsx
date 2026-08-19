/**
 * Fantasy OS Suite — Phase V2.6: Draft OS Executive Analytics Workspace.
 *
 * Covers the Draft Decision Ladder flagship + two supporting graphs, their provider-agnostic builders,
 * populated/empty/unavailable states, recommendation ordering, readiness mapping, the mandatory
 * "ordered ladder, NOT a value curve / pick timeline" rule, the deferred value/ADP analytics, provider
 * and player-context restraint, hierarchy, and reuse of the shared ExecutiveDecisionSequence primitive.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import type { Recommendation, RecommendationPriority, RecommendationConfidence, RecommendationCategory } from '@/lib/decision-os/phase6/recommendations/types'
import {
  buildDraftDecisionLadder,
  buildDraftPreparationImpact,
  buildDraftReadiness,
  DRAFT_VALUE_ANALYTICS_DEFERRED,
} from '@/lib/executive-viz/draftDecisionViewModel'
import DraftDecisionLadder from '@/components/executive-viz/DraftDecisionLadder'
import { DraftReadinessCard, DraftPreparationImpactCard } from '@/components/executive-viz/DraftSupportingViz'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

function makeRec(
  id: string,
  priority: RecommendationPriority,
  confidence: RecommendationConfidence = 'high',
  category: RecommendationCategory = 'draft_preparation',
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
    expectedImpact: 'Tighten your draft board.',
    derivation: [],
    evidence: [],
    benchmarkComparison: null,
    prerequisites: [],
    recommendedActions: [{ action: 'Set tiers before the draft.', rationale: 'because' }],
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

const DRAFT_RECS = [
  makeRec('d1', 'critical', 'high'),
  makeRec('d2', 'high', 'medium'),
  makeRec('d3', 'low', 'high'),
  makeRec('w1', 'critical', 'high', 'waiver_opportunity'), // NOT a draft rec → excluded
]

describe('buildDraftDecisionLadder (Phase V2.6)', () => {
  it('orders draft-prep steps by priority and excludes non-draft recs', () => {
    const vm = buildDraftDecisionLadder(makeSnapshot(DRAFT_RECS))
    expect(vm.decisions.map((d) => d.key)).toEqual(['d1', 'd2', 'd3'])
    expect(vm.urgentCount).toBe(2)
    expect(vm.totalCount).toBe(3)
    expect(vm.headline).toContain('high priority')
  })

  it('MANDATORY: exposes no value series and no pick data — a ladder, not a curve or timeline', () => {
    const vm = buildDraftDecisionLadder(makeSnapshot(DRAFT_RECS))
    expect(vm.hasValueSeries).toBe(false)
    expect(vm.hasPickData).toBe(false)
    for (const d of vm.decisions) {
      expect(Object.keys(d)).not.toContain('value')
      expect(Object.keys(d)).not.toContain('adp')
      expect(Object.keys(d)).not.toContain('pick')
    }
  })

  it('surfaces confidence + required action, and is empty/unavailable honestly', () => {
    const vm = buildDraftDecisionLadder(makeSnapshot(DRAFT_RECS))
    expect(vm.decisions[0].confidenceLabel).toBe('High confidence')
    expect(vm.decisions[0].detail).toContain('Set tiers')

    expect(buildDraftDecisionLadder(makeSnapshot([])).decisions).toHaveLength(0)
    expect(buildDraftDecisionLadder(makeSnapshot([])).available).toBe(true)
    expect(buildDraftDecisionLadder(null).available).toBe(false)
  })
})

describe('buildDraftPreparationImpact + buildDraftReadiness (Phase V2.6)', () => {
  it('buckets prep by the engine priority tiers (no invented value scores)', () => {
    const model = buildDraftPreparationImpact(makeSnapshot(DRAFT_RECS))
    expect(model.items.map((i) => i.key)).toEqual(['critical', 'high', 'low']) // medium 0 filtered
    expect(model.items.every((i) => i.max === 3)).toBe(true)
    expect(buildDraftPreparationImpact(null).available).toBe(false)
    expect(buildDraftPreparationImpact(makeSnapshot([])).items).toHaveLength(0)
  })

  it('reads readiness honestly across the real combinations of drafts + prep', () => {
    expect(buildDraftReadiness(makeSnapshot([]), 0).readinessLabel).toBe('No drafts on the horizon')
    expect(buildDraftReadiness(makeSnapshot([]), 2).readinessLabel).toBe('Ready to draft')
    expect(buildDraftReadiness(makeSnapshot([makeRec('d1', 'critical')]), 1).status).toBe('at_risk')
    expect(buildDraftReadiness(makeSnapshot([makeRec('d1', 'low')]), 0).readinessLabel).toBe('Prep in progress')
    expect(buildDraftReadiness(null, 0).available).toBe(false)
  })

  it('draft value/ADP/pick analytics are deliberately deferred, not fabricated', () => {
    expect(DRAFT_VALUE_ANALYTICS_DEFERRED.deferred).toBe(true)
    expect(DRAFT_VALUE_ANALYTICS_DEFERRED.reason).toContain('no customer-facing route exposes')
    // Scan for ADP/value data being READ as identifiers/fields — not the word "ADP" appearing in the
    // deferred-reason prose, which legitimately explains what is NOT surfaced.
    const source = readSource('lib', 'executive-viz', 'draftDecisionViewModel.ts')
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n')
    expect(codeOnly).not.toMatch(/\.adp\b|adpValue|valueOverExpected|bestAvailable|projectedAvailability/i)
  })
})

describe('Draft OS components — states, accessibility, provider abstraction (Phase V2.6)', () => {
  it('render populated with accessible summaries and no provider/player/ADP names', () => {
    const s = makeSnapshot(DRAFT_RECS)
    const cards = [
      <DraftDecisionLadder key="1" snapshot={s} />,
      <DraftReadinessCard key="2" snapshot={s} draftsApproachingCount={1} />,
      <DraftPreparationImpactCard key="3" snapshot={s} />,
    ]
    for (const card of cards) {
      const { container, unmount } = render(card)
      expect(container.querySelector('[data-testid="executive-viz-summary"]')).not.toBeNull()
      const text = (container.textContent ?? '').toLowerCase()
      for (const banned of ['sleeper', 'espn', 'yahoo', 'fantrax', 'payload', 'resolver', 'decision os', 'platformuserid', ' adp']) {
        expect(text).not.toContain(banned)
      }
      unmount()
    }
  })

  it('the flagship renders numbered priority steps and states it is a ladder, not a value curve', () => {
    render(<DraftDecisionLadder snapshot={makeSnapshot(DRAFT_RECS)} />)
    expect(screen.getByText('Draft Decision Ladder')).toBeTruthy()
    expect(screen.getByTestId('draft-step-d1')).toBeTruthy()
    expect(screen.getByText(/Ordered by priority, not by draft value or pick number/)).toBeTruthy()
  })

  it('the flagship shows honest empty and unavailable states', () => {
    const { unmount } = render(<DraftDecisionLadder snapshot={makeSnapshot([])} />)
    expect(screen.getByTestId('executive-viz-empty')).toBeTruthy()
    unmount()
    render(<DraftDecisionLadder snapshot={null} />)
    expect(screen.getByTestId('executive-viz-unavailable')).toBeTruthy()
  })
})

describe('Draft OS hierarchy + engine reuse (Phase V2.6)', () => {
  it('ManagerCommandCenterSection renders the Draft OS workspace', () => {
    const source = readSource('components', 'decision-os', 'ManagerCommandCenterSection.tsx')
    expect(source).toContain('draft-os-workspace')
    expect(source).toContain('DraftDecisionLadder')
    for (const card of ['DraftReadinessCard', 'DraftPreparationImpactCard']) {
      expect(source).toContain(card)
    }
  })

  it('the flagship reuses the shared ExecutiveDecisionSequence primitive (now four consumers)', () => {
    expect(readSource('components', 'executive-viz', 'DraftDecisionLadder.tsx')).toContain('ExecutiveDecisionSequence')
    expect(readSource('components', 'executive-viz', 'DraftDecisionLadder.tsx')).toContain('ExecutiveVisualizationShell')
  })
})
