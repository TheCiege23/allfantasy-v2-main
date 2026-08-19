/**
 * Fantasy OS Suite — Phase D Increment 5.
 *
 * `UserOsCard` is a pure presentation component over the already-tested `UserOsSnapshot` shape —
 * proves rendering/degradation only, not `resolveUserOsSnapshot`'s own composition correctness
 * (covered by `user-os.test.ts`). Reuses the existing `DecisionOsCardPrimitives` — no new visual
 * system, mirroring `MissionControlCard`/`LeagueAnalyticsCard`'s own established test pattern.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import UserOsCard from '@/components/decision-os/UserOsCard'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'

const NOW = '2026-07-08T12:00:00.000Z'

function makeSnapshot(o: Partial<Extract<UserOsSnapshot, { available: true }>> = {}): UserOsSnapshot {
  return {
    leagueId: 'league-user-os-ui',
    managerId: 'mgr-1',
    generatedAt: NOW,
    available: true,
    teamHealth: {
      participationTier: 'active',
      overallEngagementScore: 62,
      retentionRisk: 'low',
      retentionRiskReasons: [],
      isInactive: false,
      daysSinceLastActivity: 2,
    },
    activitySummary: { tradeEventCount: 2, waiverEventCount: 5, lineupEventCount: 8, draftEventCount: 0 },
    leagueTrend: { available: false, reason: 'no_snapshots' },
    managerDna: null,
    recommendations: null,
    ...o,
  }
}

describe('UserOsCard', () => {
  it('renders a populated manager honestly: participation tier, activity counts, trend, retention risk', () => {
    const snapshot = makeSnapshot({
      leagueTrend: { available: true, periodsTracked: 3, earliestPeriodKey: '2026-07-06', latestPeriodKey: '2026-07-08', latestEventCount: 20, latestManagerCount: 10, eventCountDelta: 4, direction: 'increasing' },
      teamHealth: {
        participationTier: 'elite', overallEngagementScore: 90, retentionRisk: 'low',
        retentionRiskReasons: [], isInactive: false, daysSinceLastActivity: 1,
      },
    })

    render(<UserOsCard snapshot={snapshot} />)

    expect(screen.getByTestId('user-os-participation-tier')).toHaveTextContent('Elite')
    expect(screen.getByText('2')).toBeInTheDocument() // trades
    expect(screen.getByTestId('user-os-trend-available')).toHaveTextContent('increasing')
    expect(screen.getByTestId('user-os-retention-risk')).toHaveTextContent('Low')
  })

  it('shows the honest no_snapshots trend state, not a fabricated chart', () => {
    render(<UserOsCard snapshot={makeSnapshot({ leagueTrend: { available: false, reason: 'no_snapshots' } })} />)
    expect(screen.getByTestId('user-os-trend-unavailable')).toHaveTextContent('no_snapshots')
  })

  it('shows the honest insufficient_history trend state', () => {
    render(<UserOsCard snapshot={makeSnapshot({ leagueTrend: { available: false, reason: 'insufficient_history' } })} />)
    expect(screen.getByTestId('user-os-trend-unavailable')).toHaveTextContent('insufficient_history')
  })

  it('shows real retention-risk reasons when flagged, and an honest "no risk factors" message otherwise', () => {
    render(
      <UserOsCard
        snapshot={makeSnapshot({
          teamHealth: {
            participationTier: 'passive', overallEngagementScore: 20, retentionRisk: 'high',
            retentionRiskReasons: ['inactive 14+ days'], isInactive: true, daysSinceLastActivity: 20,
          },
        })}
      />,
    )
    expect(screen.getByTestId('user-os-retention-risk')).toHaveTextContent('High')
    expect(screen.getByText('inactive 14+ days')).toBeInTheDocument()
  })

  // Phase 36: insufficient_data must render as a clear, human-readable, non-alarming label —
  // never the raw snake_case enum, never indistinguishable from a real negative judgment.
  it('renders insufficient_data as "Insufficient data", not the raw enum, and explains what is missing', () => {
    render(
      <UserOsCard
        snapshot={makeSnapshot({
          teamHealth: {
            participationTier: 'inactive', overallEngagementScore: 0, retentionRisk: 'insufficient_data',
            retentionRiskReasons: ['No activity has been recorded for this league yet, so engagement cannot be assessed. This does not mean the manager is inactive.'],
            isInactive: true, daysSinceLastActivity: null,
          },
        })}
      />,
    )
    const el = screen.getByTestId('user-os-retention-risk')
    expect(el).toHaveTextContent('Insufficient data')
    expect(el).not.toHaveTextContent('insufficient_data')
    expect(screen.getByText(/does not mean the manager is inactive/)).toBeInTheDocument()
  })

  it('shows an honest zero-activity state for an inactive manager, never fabricated', () => {
    render(
      <UserOsCard
        snapshot={makeSnapshot({
          teamHealth: {
            participationTier: 'inactive', overallEngagementScore: 0, retentionRisk: 'low',
            retentionRiskReasons: [], isInactive: true, daysSinceLastActivity: null,
          },
          activitySummary: { tradeEventCount: 0, waiverEventCount: 0, lineupEventCount: 0, draftEventCount: 0 },
        })}
      />,
    )
    expect(screen.getByTestId('user-os-participation-tier')).toHaveTextContent('Inactive')
    expect(screen.getByText('No risk factors identified')).toBeInTheDocument()
  })

  it('shows an explicit unavailable state instead of fake values when the composition fails', () => {
    render(
      <UserOsCard
        snapshot={{ leagueId: 'league-user-os-ui', managerId: 'mgr-1', generatedAt: NOW, available: false, reason: 'user_os_unavailable' }}
      />,
    )
    expect(screen.getByTestId('user-os-unavailable')).toHaveTextContent('Your team intelligence is unavailable')
  })

  it('renders a loading shell honestly when no snapshot has arrived yet (null, not fabricated)', () => {
    render(<UserOsCard snapshot={null} />)
    expect(screen.getByText('Your team intelligence is loading')).toBeInTheDocument()
  })
})
