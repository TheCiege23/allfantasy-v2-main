/**
 * Fantasy OS Suite — Phase V2.3: League OS Executive Analytics Workspace.
 *
 * Covers the League Momentum flagship + three supporting graphs, their provider-agnostic builders
 * (from LeagueAnalyticsSnapshot + fairnessScore), populated/empty/unavailable states, real-vs-no-history
 * momentum, accessible summaries, provider abstraction, and workspace hierarchy.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import {
  buildLeagueMomentum,
  buildTransactionDistribution,
  buildLeagueEngagement,
  buildCompetitiveBalance,
} from '@/lib/executive-viz/leagueMomentumViewModel'
import LeagueMomentum from '@/components/executive-viz/LeagueMomentum'
import {
  TransactionDistributionCard,
  LeagueEngagementCard,
  CompetitiveBalanceCard,
} from '@/components/executive-viz/LeagueSupportingViz'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

function makeAnalytics(overrides: Partial<Extract<LeagueAnalyticsSnapshot, { available: true }>> = {}): LeagueAnalyticsSnapshot {
  return {
    leagueId: 'league-1',
    generatedAt: '2026-07-10T12:00:00.000Z',
    available: true,
    trend: {
      available: true,
      periodsTracked: 4,
      earliestPeriodKey: '2026-W01',
      latestPeriodKey: '2026-W04',
      latestEventCount: 18,
      latestManagerCount: 10,
      eventCountDelta: 6,
      direction: 'increasing',
    },
    managerCounts: { activeManagers: 10, inactiveManagers: 2 },
    activity: { tradeCount: 4, waiverClaimCount: 12, draftPickCount: 0, rosterActivityCount: 8 },
    retentionRiskCount: 1,
    ...overrides,
  }
}

function makeHealth(fairnessScore = 68): CommissionerLeagueHealthSnapshot {
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
    engagementScore: 72,
    fairnessScore,
    sustainabilityScore: 74,
    overallStatus: 'healthy',
    healthTrend: 'stable',
    summary: 'League health.',
    metrics: {
      inactiveTeams: 0, missedLineups: 0, tradeActivity: 4, waiverActivity: 12, leagueEngagement: 72,
      commissionerActions: 0, pendingWaiverClaims: 0, pendingTrades: 0, openAiAlerts: 0, chatMessagesLast7Days: 30,
      activeManagers: 12, injuredStarters: 1, lineupSubmissionRate: 0.95, projectionCoveragePct: 82, lowConfidenceProjectionStarters: 1,
    },
    alerts: [], recommendations: [], actions: [], assistantQuestions: [],
  }
}

describe('buildLeagueMomentum (Phase V2.3)', () => {
  it('uses real multi-period history when the trend is available', () => {
    const vm = buildLeagueMomentum(makeAnalytics())!
    expect(vm.available).toBe(true)
    expect(vm.hasHistory).toBe(true)
    expect(vm.status).toBe('accelerating')
    expect(vm.direction).toBe('increasing')
    expect(vm.headline).toContain('+6 moves over 4')
  })

  it('degrades to an honest current-state snapshot (no fabricated trend) when history is absent', () => {
    const vm = buildLeagueMomentum(makeAnalytics({ trend: { available: false, reason: 'insufficient_history' } }))!
    expect(vm.hasHistory).toBe(false)
    expect(vm.status).toBe('current_snapshot')
    expect(vm.direction).toBeNull()
    expect(vm.totalActivity).toBe(24) // 4+12+0+8
    expect(vm.headline).toContain('needs more history')
  })

  it('is unavailable when the analytics snapshot itself is unavailable', () => {
    const unavailable: LeagueAnalyticsSnapshot = { leagueId: 'x', generatedAt: '2026-07-10T12:00:00.000Z', available: false, reason: 'league_health_unavailable' }
    const vm = buildLeagueMomentum(unavailable)!
    expect(vm.available).toBe(false)
    expect(vm.status).toBe('unavailable')
  })

  it('marks a cooling league as at-risk toned', () => {
    const vm = buildLeagueMomentum(makeAnalytics({ trend: { available: true, periodsTracked: 3, earliestPeriodKey: 'a', latestPeriodKey: 'b', latestEventCount: 5, latestManagerCount: 8, eventCountDelta: -7, direction: 'decreasing' } }))!
    expect(vm.status).toBe('cooling')
    expect(vm.tone).toBe('at_risk')
  })
})

describe('buildTransactionDistribution + buildLeagueEngagement + buildCompetitiveBalance (Phase V2.3)', () => {
  it('ranks transaction types by volume, biggest first', () => {
    const model = buildTransactionDistribution(makeAnalytics())
    expect(model.items[0].key).toBe('waivers') // 12 is largest
    expect(model.items.find((i) => i.key === 'draft_picks')).toBeUndefined() // 0 filtered out
    expect(model.headline).toContain('waiver claims lead')
  })

  it('is empty when there are no transactions', () => {
    const model = buildTransactionDistribution(makeAnalytics({ activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 } }))
    expect(model.items).toHaveLength(0)
    expect(model.available).toBe(true)
  })

  it('summarizes active vs quiet managers', () => {
    const model = buildLeagueEngagement(makeAnalytics())
    expect(model.items.map((i) => i.key)).toEqual(['active', 'inactive', 'at_risk'])
    expect(model.headline).toContain('10 of 12 managers active')
  })

  it('reads cleanly (no "0 of 0" bars) when no managers are tracked yet', () => {
    const model = buildLeagueEngagement(makeAnalytics({ managerCounts: { activeManagers: 0, inactiveManagers: 0 }, retentionRiskCount: 0 }))
    expect(model.items).toHaveLength(0)
    expect(model.available).toBe(true)
    expect(model.headline).toContain('No manager activity')
  })

  it('reads fairness into a plain-language balance label', () => {
    expect(buildCompetitiveBalance(makeHealth(90)).label).toBe('Well balanced')
    expect(buildCompetitiveBalance(makeHealth(40)).label).toBe('Lopsided')
    expect(buildCompetitiveBalance(null).available).toBe(false)
  })
})

describe('League OS visualization components — states + provider abstraction (Phase V2.3)', () => {
  it('render populated with accessible summaries and no provider/player names', () => {
    const a = makeAnalytics()
    const cards = [
      <LeagueMomentum key="1" snapshot={a} />,
      <TransactionDistributionCard key="2" snapshot={a} />,
      <LeagueEngagementCard key="3" snapshot={a} />,
      <CompetitiveBalanceCard key="4" healthSnapshot={makeHealth()} />,
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

  it('League Momentum shows the hero + headline and an unavailable state', () => {
    render(<LeagueMomentum snapshot={makeAnalytics()} />)
    expect(screen.getByText('League Momentum')).toBeTruthy()
    expect(screen.getByTestId('executive-viz-summary').textContent).toContain('increasing')

    const unavailable: LeagueAnalyticsSnapshot = { leagueId: 'x', generatedAt: '2026-07-10T12:00:00.000Z', available: false, reason: 'league_health_unavailable' }
    const { getByTestId } = render(<LeagueMomentum snapshot={unavailable} />)
    expect(getByTestId('executive-viz-unavailable')).toBeTruthy()
  })

  it('Competitive Balance renders an accessible ring meter', () => {
    render(<CompetitiveBalanceCard healthSnapshot={makeHealth()} />)
    expect(screen.getByRole('meter').getAttribute('aria-label')).toContain('Balanced')
  })
})

describe('League OS workspace hierarchy (Phase V2.3)', () => {
  it('CommissionerHubPageClient renders the League OS workspace in League Focus', () => {
    const source = readSource('app', 'commissioner-hub', 'CommissionerHubPageClient.tsx')
    expect(source).toContain('league-os-workspace')
    expect(source).toContain('LeagueMomentum')
    for (const card of ['TransactionDistributionCard', 'LeagueEngagementCard', 'CompetitiveBalanceCard']) {
      expect(source).toContain(card)
    }
  })

  it('the flagship + balance reuse the shared engine primitives (no one-off charts)', () => {
    const flagship = readSource('components', 'executive-viz', 'LeagueMomentum.tsx')
    expect(flagship).toContain('ExecutiveVisualizationShell')
    const supporting = readSource('components', 'executive-viz', 'LeagueSupportingViz.tsx')
    expect(supporting).toContain('ExecutiveHorizontalBars')
    expect(supporting).toContain('ExecutiveProgressRing')
  })
})
