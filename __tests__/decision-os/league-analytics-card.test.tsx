/**
 * Commissioner OS Demo Breadth — Phase C Increment 4.
 *
 * `LeagueAnalyticsCard` is a pure presentation component over the already-tested
 * `LeagueAnalyticsSnapshot` shape (this increment) — proves rendering/degradation only, not
 * `resolveLeagueAnalyticsSnapshot`'s own composition correctness (covered by
 * `league-analytics.test.ts`). Reuses the existing `DecisionOsCardPrimitives` — no new visual
 * system, mirroring `MissionControlCard`'s own established test pattern.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import LeagueAnalyticsCard from '@/components/decision-os/LeagueAnalyticsCard'
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'

const NOW = '2026-07-08T12:00:00.000Z'

function makeSnapshot(o: Partial<Extract<LeagueAnalyticsSnapshot, { available: true }>> = {}): LeagueAnalyticsSnapshot {
  return {
    leagueId: 'league-analytics-ui',
    generatedAt: NOW,
    available: true,
    trend: { available: false, reason: 'no_snapshots' },
    managerCounts: { activeManagers: 10, inactiveManagers: 0 },
    activity: { tradeCount: 3, waiverClaimCount: 12, draftPickCount: 0, rosterActivityCount: 8 },
    retentionRiskCount: 0,
    ...o,
  }
}

describe('LeagueAnalyticsCard', () => {
  it('renders a populated league honestly: counts, an available trend, and a retention-risk count', () => {
    const snapshot = makeSnapshot({
      trend: { available: true, periodsTracked: 3, earliestPeriodKey: '2026-07-06', latestPeriodKey: '2026-07-08', latestEventCount: 20, latestManagerCount: 10, eventCountDelta: 4, direction: 'increasing' },
      retentionRiskCount: 2,
    })

    render(<LeagueAnalyticsCard snapshot={snapshot} />)

    expect(screen.getByText('10')).toBeInTheDocument() // active managers
    expect(screen.getByTestId('league-analytics-trend-available')).toHaveTextContent('increasing')
    expect(screen.getByTestId('league-analytics-retention-risk-count')).toHaveTextContent('2')
  })

  it('shows the honest no_snapshots trend state, not a fabricated chart', () => {
    render(<LeagueAnalyticsCard snapshot={makeSnapshot({ trend: { available: false, reason: 'no_snapshots' } })} />)
    expect(screen.getByTestId('league-analytics-trend-unavailable')).toHaveTextContent('no_snapshots')
  })

  it('shows the honest insufficient_history trend state', () => {
    render(<LeagueAnalyticsCard snapshot={makeSnapshot({ trend: { available: false, reason: 'insufficient_history' } })} />)
    expect(screen.getByTestId('league-analytics-trend-unavailable')).toHaveTextContent('insufficient_history')
  })

  it('shows an honest all-zero state for a league with no activity, not fabricated data', () => {
    render(<LeagueAnalyticsCard snapshot={makeSnapshot()} />)
    expect(screen.getByTestId('league-analytics-retention-risk-count')).toHaveTextContent('0')
    expect(screen.getByText('No managers currently flagged')).toBeInTheDocument()
  })

  it('shows an explicit unavailable state instead of fake values when League Health cannot be resolved', () => {
    render(
      <LeagueAnalyticsCard
        snapshot={{ leagueId: 'league-analytics-ui', generatedAt: NOW, available: false, reason: 'league_health_unavailable' }}
      />,
    )
    expect(screen.getByTestId('league-analytics-unavailable')).toHaveTextContent('League Analytics unavailable')
  })

  it('renders a loading/empty shell honestly when no snapshot has arrived yet (null, not fabricated)', () => {
    render(<LeagueAnalyticsCard snapshot={null} />)
    expect(screen.getByText('League Analytics is loading')).toBeInTheDocument()
  })
})
