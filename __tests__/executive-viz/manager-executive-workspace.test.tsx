/**
 * Fantasy OS Suite — Phase V2.2: User (Manager) OS Executive Analytics Workspace.
 *
 * Covers the Championship Trajectory flagship + three supporting graphs, their provider-agnostic
 * builders (all from ManagerCommandCenterSnapshot), populated/empty/unavailable states, recommendation
 * ordering, accessible summaries, provider abstraction, and workspace hierarchy.
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
  buildChampionshipTrajectory,
  buildWeeklyDecisionTimeline,
  buildTeamRiskSummary,
} from '@/lib/executive-viz/managerSeasonViewModel'
import ChampionshipTrajectory from '@/components/executive-viz/ChampionshipTrajectory'
import {
  WeeklyDecisionTimelineCard,
  TeamRiskSummaryCard,
} from '@/components/executive-viz/ManagerSupportingViz'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

function makeRec(
  leagueId: string,
  category: RecommendationCategory,
  priority: RecommendationPriority,
  id: string,
): ManagerCommandCenterSnapshot['recommendations'][number] {
  const rec: Recommendation = {
    id,
    tier: 'manager',
    category,
    entityId: 'manager-1',
    priority,
    severity: 'standard',
    confidence: 'high',
    affectedDimensions: [],
    expectedImpact: 'Improve your team.',
    derivation: [],
    evidence: [],
    benchmarkComparison: null,
    prerequisites: [],
    recommendedActions: [{ action: `Do the ${category} move`, rationale: 'because' }],
    rollbackCriteria: [],
    completeness: 80,
    uncertainty: [],
  }
  return { leagueId, recommendation: rec }
}

function makeSignal(leagueId: string, severity: AttentionSignalSeverity, id: string): DecisionOsAttentionSignal {
  return {
    id,
    leagueId,
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

function makeManagerSnapshot(overrides: Partial<ManagerCommandCenterSnapshot> = {}): ManagerCommandCenterSnapshot {
  return {
    generatedAt: '2026-07-10T12:00:00.000Z',
    totalLeagues: 3,
    healthyLeagueCount: 2,
    atRiskLeagueCount: 1,
    unavailableLeagueCount: 0,
    leagueSummaries: [
      { leagueId: 'a', available: true, participationTier: 'active', engagementScore: 80, retentionRisk: 'low', isInactive: false, recommendationCount: 2 },
      { leagueId: 'b', available: true, participationTier: 'active', engagementScore: 70, retentionRisk: 'low', isInactive: false, recommendationCount: 1 },
      { leagueId: 'c', available: true, participationTier: 'casual', engagementScore: 40, retentionRisk: 'high', isInactive: true, recommendationCount: 1 },
    ],
    attentionQueue: [makeSignal('c', 'critical', 's1'), makeSignal('a', 'high', 's2')],
    recommendations: [
      makeRec('a', 'lineup_discipline', 'critical', 'r1'),
      makeRec('a', 'waiver_opportunity', 'high', 'r2'),
      makeRec('b', 'trade_coaching', 'medium', 'r3'),
      makeRec('c', 'lineup_discipline', 'low', 'r4'),
    ],
    leagueTrends: [
      { leagueId: 'a', direction: 'increasing', eventCountDelta: 5 },
      { leagueId: 'b', direction: 'increasing', eventCountDelta: 3 },
      { leagueId: 'c', direction: 'flat', eventCountDelta: 0 },
    ],
    warnings: [],
    ...overrides,
  }
}

describe('buildChampionshipTrajectory (Phase V2.2)', () => {
  it('summarizes teams on track + urgent decisions from real counts', () => {
    const vm = buildChampionshipTrajectory(makeManagerSnapshot())!
    expect(vm.available).toBe(true)
    expect(vm.teamsOnTrack).toBe(2)
    expect(vm.trackedTeams).toBe(3)
    expect(vm.urgentDecisions).toBe(2) // 1 critical + 1 high recommendation
    expect(vm.status).toBe('mixed') // 1 at-risk of 3 tracked
    expect(vm.headline).toContain('2 of 3 teams on track')
    expect(vm.activityDirection).toBe('increasing')
  })

  it('ranks the top decisions by priority', () => {
    const vm = buildChampionshipTrajectory(makeManagerSnapshot())!
    expect(vm.topDecisions[0].priorityLabel).toBe('Critical')
    expect(vm.topDecisions).toHaveLength(3)
  })

  it('is unavailable (not fabricated) when there are no tracked teams', () => {
    const vm = buildChampionshipTrajectory(makeManagerSnapshot({ totalLeagues: 1, unavailableLeagueCount: 1 }))!
    expect(vm.available).toBe(false)
    expect(vm.status).toBe('unavailable')
  })

  it('reports on_track when no team needs attention', () => {
    const vm = buildChampionshipTrajectory(makeManagerSnapshot({ atRiskLeagueCount: 0, healthyLeagueCount: 3 }))!
    expect(vm.status).toBe('on_track')
  })
})

describe('buildWeeklyDecisionTimeline (Phase V2.2; scoped in V3.1)', () => {
  it('orders decisions by priority and leads with critical guidance', () => {
    const model = buildWeeklyDecisionTimeline(makeManagerSnapshot())
    expect(model.items[0].priorityLabel).toBe('Critical')
    // Phase V3.1: waiver (r2) is now excluded — it belongs to the Waiver OS workspace — so 3 remain.
    expect(model.items).toHaveLength(3)
    expect(model.items.map((i) => i.key)).not.toContain('r2')
    expect(model.headline).toContain('critical')
  })

  it('Phase V3.1: excludes waiver and draft recommendations (owned by Waiver OS / Draft OS)', () => {
    const model = buildWeeklyDecisionTimeline(
      makeManagerSnapshot({
        recommendations: [
          makeRec('a', 'waiver_opportunity', 'critical', 'wv'),
          makeRec('a', 'draft_preparation', 'high', 'dr'),
        ],
      }),
    )
    expect(model.items).toHaveLength(0)
    expect(model.headline).toContain('No lineup, trade, or engagement')
  })

  it('is empty (not fabricated) when there are no recommendations', () => {
    const model = buildWeeklyDecisionTimeline(makeManagerSnapshot({ recommendations: [] }))
    expect(model.items).toHaveLength(0)
    expect(model.available).toBe(true)
  })
})

describe('buildTeamRiskSummary (Phase V2.2)', () => {
  it('ranks risk factors worst-first from real counts', () => {
    const model = buildTeamRiskSummary(makeManagerSnapshot())
    expect(model.available).toBe(true)
    // critical alerts (1) should outrank a single inactive team
    expect(model.items[0].status === 'critical' || model.items[0].status === 'at_risk').toBe(true)
    expect(model.headline).toContain('risk')
  })

  it('is unavailable when there are no teams', () => {
    const model = buildTeamRiskSummary(makeManagerSnapshot({ totalLeagues: 0 }))
    expect(model.available).toBe(false)
  })
})

describe('Manager OS visualization components — states + provider abstraction (Phase V2.2)', () => {
  it('render populated with accessible summaries and no provider/player names', () => {
    const s = makeManagerSnapshot()
    const cards = [
      <ChampionshipTrajectory key="1" snapshot={s} />,
      <WeeklyDecisionTimelineCard key="2" snapshot={s} />,
      <TeamRiskSummaryCard key="3" snapshot={s} />,
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

  it('Championship Trajectory shows the hero metric and headline', () => {
    render(<ChampionshipTrajectory snapshot={makeManagerSnapshot()} />)
    expect(screen.getByText('Championship Trajectory')).toBeTruthy()
    expect(screen.getByRole('meter')).toBeTruthy() // the on-track ring
    expect(screen.getByTestId('executive-viz-summary').textContent).toContain('2 of 3 teams on track')
  })

  it('Championship Trajectory shows an honest unavailable state (no fabricated season)', () => {
    render(<ChampionshipTrajectory snapshot={makeManagerSnapshot({ totalLeagues: 0, unavailableLeagueCount: 0, healthyLeagueCount: 0, atRiskLeagueCount: 0 })} />)
    expect(screen.getByTestId('executive-viz-unavailable')).toBeTruthy()
  })

  it('Weekly Decision Timeline renders numbered priority steps', () => {
    render(<WeeklyDecisionTimelineCard snapshot={makeManagerSnapshot()} />)
    expect(screen.getByTestId('decision-step-r1')).toBeTruthy()
  })
})

describe('Manager OS workspace hierarchy (Phase V2.2)', () => {
  it('ManagerCommandCenterSection renders the executive workspace with the flagship + supporting graphs', () => {
    const source = readSource('components', 'decision-os', 'ManagerCommandCenterSection.tsx')
    expect(source).toContain('manager-executive-workspace')
    expect(source).toContain('ChampionshipTrajectory')
    for (const card of ['WeeklyDecisionTimelineCard', 'TeamRiskSummaryCard']) {
      expect(source).toContain(card)
    }
    // Phase V3.1: DecisionFocusCard was removed (its by-category view is now Platform OS's job).
    expect(source).not.toContain('DecisionFocusCard')
  })

  it('the flagship reuses the shared ExecutiveProgressRing rather than a one-off chart', () => {
    const source = readSource('components', 'executive-viz', 'ChampionshipTrajectory.tsx')
    expect(source).toContain('ExecutiveProgressRing')
  })
})
