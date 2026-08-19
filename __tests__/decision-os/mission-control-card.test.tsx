/**
 * Commissioner OS Surface Alignment — Phase B Increment 6.
 *
 * `MissionControlCard` is a pure presentation component over the already-tested
 * `MissionControlSnapshot` shape (Increment 5) — this file proves rendering/degradation only, not
 * `resolveMissionControlSnapshot`'s own composition correctness (covered by
 * `mission-control.test.ts`). Reuses the existing `DecisionOsCardPrimitives` — no new visual system.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MissionControlCard from '@/components/decision-os/MissionControlCard'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { LeagueHealthResult } from '@/lib/league-health'
import type { DecisionOsLeagueHealthResult } from '@/lib/decision-os/leagueHealthAlignment'

const NOW = '2026-07-08T12:00:00.000Z'

function makeEngine(o: Partial<LeagueHealthResult> = {}): LeagueHealthResult {
  return {
    leagueHealthScore: 70, engagementScore: 70, fairnessScore: 70, sustainabilityScore: 70,
    confidencePct: 80, overallStatus: 'healthy', biggestStrengths: [], biggestProblems: [],
    urgentAlerts: [], earlyWarningSignals: [], inactiveManagerNotes: [], transactionHealthNotes: [],
    waiverHealthNotes: [], tradeHealthNotes: [], rosterBalanceNotes: [], commissionerHealthNotes: [],
    interventionRecommendations: [], summary: 'League health: 70/100 (healthy).',
    generatedAt: NOW, healthTrend: 'stable', churnRiskScore: 10, disputeRiskScore: 0,
    abandonmentRiskScore: 0, engagementDropoffFlags: [], ...o,
  }
}

function makeSnapshot(o: Partial<MissionControlSnapshot> = {}): MissionControlSnapshot {
  const engine = makeEngine()
  const result: DecisionOsLeagueHealthResult = {
    engine,
    decisionOs: {
      activityEventCount: 20, activeManagerCount: 10, inactiveManagerCount: 0, tradeCount: 3,
      waiverClaimCount: 12, draftPickCount: 0, commissionerActionCount: 1, rosterActivityCount: 8,
      managersAtRetentionRisk: [], trend: { available: false, reason: 'no_snapshots' },
    },
    fieldProvenance: {} as DecisionOsLeagueHealthResult['fieldProvenance'],
  }
  return {
    leagueId: 'league-mc-ui',
    generatedAt: NOW,
    leagueHealth: { available: true, result },
    trend: { available: false, reason: 'no_snapshots' },
    managerCounts: { activeManagers: 10, inactiveManagers: 0 },
    activity: { tradeCount: 3, waiverClaimCount: 12, draftPickCount: 0, rosterActivityCount: 8 },
    managersAtRetentionRisk: [],
    recommendedActions: [],
    fieldProvenance: result.fieldProvenance,
    ...o,
  }
}

describe('MissionControlCard', () => {
  it('renders a populated league honestly: health status, counts, trend, retention risk, actions', () => {
    const snapshot = makeSnapshot({
      trend: { available: true, periodsTracked: 3, earliestPeriodKey: '2026-07-06', latestPeriodKey: '2026-07-08', latestEventCount: 20, latestManagerCount: 10, eventCountDelta: 4, direction: 'increasing' },
      managersAtRetentionRisk: [
        { managerId: 'mgr-1', retentionRisk: 'high', retentionRiskReasons: ['inactive 14+ days'], isInactive: false },
      ],
      recommendedActions: [
        { priority: 'urgent', message: 'ALERT: 30%+ of managers inactive.' },
        { priority: 'standard', message: 'Post a weekly recap thread.' },
      ],
    })

    render(<MissionControlCard snapshot={snapshot} />)

    expect(screen.getByTestId('mission-control-health-status')).toHaveTextContent('healthy')
    expect(screen.getByText('10')).toBeInTheDocument() // active managers
    expect(screen.getByTestId('mission-control-trend-available')).toHaveTextContent('increasing')
    expect(screen.getByTestId('mission-control-retention-list')).toHaveTextContent('mgr-1')
    expect(screen.getByTestId('mission-control-retention-list')).toHaveTextContent('inactive 14+ days')
    expect(screen.getByTestId('mission-control-actions-list')).toHaveTextContent('ALERT: 30%+ of managers inactive.')
    expect(screen.getByTestId('mission-control-actions-list')).toHaveTextContent('Post a weekly recap thread.')
  })

  it('shows the honest no_snapshots trend state, not a fabricated chart', () => {
    render(<MissionControlCard snapshot={makeSnapshot({ trend: { available: false, reason: 'no_snapshots' } })} />)
    expect(screen.getByTestId('mission-control-trend-unavailable')).toHaveTextContent('no_snapshots')
  })

  it('shows the honest insufficient_history trend state', () => {
    render(<MissionControlCard snapshot={makeSnapshot({ trend: { available: false, reason: 'insufficient_history' } })} />)
    expect(screen.getByTestId('mission-control-trend-unavailable')).toHaveTextContent('insufficient_history')
  })

  it('shows an explicit league-health-unavailable state instead of fake values', () => {
    render(<MissionControlCard snapshot={makeSnapshot({ leagueHealth: { available: false, reason: 'league_health_unavailable' } })} />)
    expect(screen.getByTestId('mission-control-health-unavailable')).toHaveTextContent('League health unavailable')
    expect(screen.getByText('League health unavailable', { selector: 'p' })).toBeInTheDocument()
  })

  it('shows "No managers currently flagged" when nobody is at retention risk', () => {
    render(<MissionControlCard snapshot={makeSnapshot({ managersAtRetentionRisk: [] })} />)
    expect(screen.getByTestId('mission-control-retention-empty')).toHaveTextContent('No managers currently flagged')
  })

  it('shows an honest empty state for recommended actions when there are none', () => {
    render(<MissionControlCard snapshot={makeSnapshot({ recommendedActions: [] })} />)
    expect(screen.getByTestId('mission-control-actions-empty')).toHaveTextContent('No recommended actions right now')
  })

  it('renders a loading/empty shell honestly when no snapshot has arrived yet (null, not fabricated)', () => {
    render(<MissionControlCard snapshot={null} />)
    expect(screen.getByText('Mission Control is loading')).toBeInTheDocument()
  })
})
