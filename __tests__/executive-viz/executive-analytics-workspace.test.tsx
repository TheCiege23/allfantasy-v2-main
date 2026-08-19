/**
 * Fantasy OS Suite — Phase V2.1: Commissioner OS Executive Analytics Workspace.
 *
 * Covers the four supporting visualizations (Manager Attention, Health Breakdown, Commissioner Workload,
 * League Readiness), their provider-agnostic builders, the reusable chart primitives
 * (ExecutiveHorizontalBars, ExecutiveProgressRing), populated/empty/unavailable states, accessible
 * summaries, provider abstraction, and the dashboard hierarchy.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import {
  buildManagerAttentionDistribution,
  buildLeagueHealthBreakdown,
  buildCommissionerWorkload,
  buildLeagueReadiness,
} from '@/lib/executive-viz/commissionerLeagueHealthViewModel'
import {
  ManagerAttentionCard,
  LeagueHealthBreakdownCard,
  CommissionerWorkloadCard,
  LeagueReadinessCard,
} from '@/components/executive-viz/SupportingExecutiveViz'
import { ExecutiveHorizontalBars, ExecutiveProgressRing } from '@/components/executive-viz/ExecutiveCharts'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

function makeSnapshot(overrides: Partial<CommissionerLeagueHealthSnapshot> = {}): CommissionerLeagueHealthSnapshot {
  return {
    leagueId: 'league-1',
    leagueName: 'Sunday Money',
    sport: 'NFL',
    leagueType: 'redraft',
    season: 2026,
    status: 'active',
    teamCount: 12,
    currentWeek: 5,
    generatedAt: '2026-07-10T12:00:00.000Z',
    source: 'database',
    dataConfidence: 'high',
    healthScore: 78,
    engagementScore: 45,
    fairnessScore: 68,
    sustainabilityScore: 74,
    overallStatus: 'healthy',
    healthTrend: 'stable',
    summary: 'League health: 78/100.',
    metrics: {
      inactiveTeams: 2,
      missedLineups: 1,
      tradeActivity: 4,
      waiverActivity: 12,
      leagueEngagement: 45,
      commissionerActions: 0,
      pendingWaiverClaims: 3,
      pendingTrades: 1,
      openAiAlerts: 0,
      chatMessagesLast7Days: 30,
      activeManagers: 10,
      injuredStarters: 2,
      lineupSubmissionRate: 0.92,
      projectionCoveragePct: 82,
      lowConfidenceProjectionStarters: 1,
    },
    alerts: [],
    recommendations: [],
    actions: [],
    assistantQuestions: [],
    ...overrides,
  }
}

describe('buildManagerAttentionDistribution (Phase V2.1)', () => {
  it('ranks manager issues worst-first and labels real figures', () => {
    const model = buildManagerAttentionDistribution(makeSnapshot())
    expect(model.available).toBe(true)
    expect(model.items.map((i) => i.key)[0]).toBe('inactive') // 2 inactive -> at_risk, worst
    const inactive = model.items.find((i) => i.key === 'inactive')!
    expect(inactive.valueLabel).toBe('2 of 12')
    expect(model.headline).toContain('10 of 12 managers active')
  })

  it('is unavailable (not fabricated) when there are no teams', () => {
    const model = buildManagerAttentionDistribution(makeSnapshot({ teamCount: 0 }))
    expect(model.available).toBe(false)
    expect(model.items).toHaveLength(0)
  })
})

describe('buildLeagueHealthBreakdown (Phase V2.1)', () => {
  it('lists the 4 real sub-scores weakest-first and names the weakest', () => {
    const model = buildLeagueHealthBreakdown(makeSnapshot())
    expect(model.items).toHaveLength(4)
    expect(model.items[0].key).toBe('engagement') // 45 is lowest
    expect(model.items.every((i) => i.max === 100)).toBe(true)
    expect(model.headline).toContain('Engagement')
  })
})

describe('buildCommissionerWorkload (Phase V2.1)', () => {
  it('sums real open-item counts into a headline', () => {
    const model = buildCommissionerWorkload(makeSnapshot())
    // 3 waivers + 1 trade = 4
    expect(model.headline).toContain('4 items need your action')
  })

  it('reads cleanly when nothing is open', () => {
    const model = buildCommissionerWorkload(
      makeSnapshot({
        metrics: { ...makeSnapshot().metrics, pendingWaiverClaims: 0, pendingTrades: 0, openAiAlerts: 0, commissionerActions: 0 },
      }),
    )
    expect(model.headline).toContain('Nothing requires your action')
  })
})

describe('buildLeagueReadiness (Phase V2.1)', () => {
  it('produces 3 genuine 0-100 readiness rings and passes confidence through', () => {
    const model = buildLeagueReadiness(makeSnapshot())
    expect(model.items.map((i) => i.key)).toEqual(['lineups', 'projections', 'managers_active'])
    expect(model.confidence).toBe('high')
    const lineups = model.items.find((i) => i.key === 'lineups')!
    expect(lineups.valueLabel).toBe('92%')
  })

  it('is unavailable with no teams (no fabricated readiness)', () => {
    const model = buildLeagueReadiness(makeSnapshot({ teamCount: 0 }))
    expect(model.available).toBe(false)
    expect(model.items).toHaveLength(0)
  })
})

describe('Executive chart primitives (Phase V2.1)', () => {
  it('ExecutiveHorizontalBars renders an accessible meter per item', () => {
    render(
      <ExecutiveHorizontalBars
        items={[
          { key: 'a', label: 'Alpha', value: 3, max: 12, status: 'at_risk', valueLabel: '3 of 12' },
          { key: 'b', label: 'Beta', value: 0, max: 12, status: 'excellent', valueLabel: '0 of 12' },
        ]}
      />,
    )
    const meters = screen.getAllByRole('meter')
    expect(meters).toHaveLength(2)
    expect(meters[0].getAttribute('aria-valuenow')).toBe('25')
  })

  it('ExecutiveProgressRing renders an accessible meter with the value', () => {
    render(<ExecutiveProgressRing value={92} status="excellent" label="Lineups set" valueLabel="92%" />)
    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuenow')).toBe('92')
    expect(meter.getAttribute('aria-label')).toContain('Lineups set')
  })
})

describe('Supporting visualization cards — states + provider abstraction (Phase V2.1)', () => {
  it('render populated with an accessible summary and no provider/API/player names', () => {
    const cards = [
      <ManagerAttentionCard key="1" snapshot={makeSnapshot()} />,
      <LeagueHealthBreakdownCard key="2" snapshot={makeSnapshot()} />,
      <CommissionerWorkloadCard key="3" snapshot={makeSnapshot()} />,
      <LeagueReadinessCard key="4" snapshot={makeSnapshot()} />,
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

  it('Workload shows a positive empty state when nothing is open', () => {
    render(
      <CommissionerWorkloadCard
        snapshot={makeSnapshot({
          metrics: { ...makeSnapshot().metrics, pendingWaiverClaims: 0, pendingTrades: 0, openAiAlerts: 0, commissionerActions: 0 },
        })}
      />,
    )
    expect(screen.getByTestId('executive-viz-empty')).toBeTruthy()
  })

  it('cards show a truthful unavailable state when data is missing', () => {
    render(<ManagerAttentionCard snapshot={makeSnapshot({ teamCount: 0 })} />)
    expect(screen.getByTestId('executive-viz-unavailable')).toBeTruthy()
  })
})

describe('Dashboard hierarchy + reusable primitives (Phase V2.1)', () => {
  it('the flagship workspace renders the map plus all 4 supporting graphs', () => {
    const source = readSource('app', 'commissioner-hub', 'CommissionerHubPageClient.tsx')
    expect(source).toContain('LeagueHealthMap')
    for (const card of ['ManagerAttentionCard', 'LeagueHealthBreakdownCard', 'CommissionerWorkloadCard', 'LeagueReadinessCard']) {
      expect(source).toContain(card)
    }
  })

  it('the cross-league aggregate strip is gated to multi-league (de-duplicated for single league)', () => {
    const source = readSource('app', 'commissioner-hub', 'CommissionerHubPageClient.tsx')
    expect(source).toContain('snapshots.length > 1')
  })

  it('ExecutiveHorizontalBars is reused by more than one supporting visualization', () => {
    const source = readSource('components', 'executive-viz', 'SupportingExecutiveViz.tsx')
    const uses = source.split('ExecutiveHorizontalBars').length - 1
    expect(uses).toBeGreaterThanOrEqual(2)
  })
})
