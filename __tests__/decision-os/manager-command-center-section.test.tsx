import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import ManagerCommandCenterSection from '@/components/decision-os/ManagerCommandCenterSection'

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

const LEAGUES = [
  { id: 'league-1', name: 'Dynasty Warriors' },
  { id: 'league-2', name: 'Redraft Rebels' },
]

const SNAPSHOT = {
  generatedAt: '2026-07-09T00:00:00.000Z',
  totalLeagues: 2,
  healthyLeagueCount: 1,
  atRiskLeagueCount: 1,
  unavailableLeagueCount: 0,
  leagueSummaries: [
    { leagueId: 'league-1', available: true, participationTier: 'active', engagementScore: 70, retentionRisk: 'low', isInactive: false, recommendationCount: 0 },
    { leagueId: 'league-2', available: true, participationTier: 'passive', engagementScore: 30, retentionRisk: 'critical', isInactive: false, recommendationCount: 1 },
  ],
  attentionQueue: [
    {
      id: 'manager_engagement_risk:league-2',
      leagueId: 'league-2',
      type: 'manager_engagement_risk',
      severity: 'critical',
      priorityScore: 500,
      title: "This team's engagement needs attention",
      explanation: 'Your retention risk for this team is "critical".',
      recommendedAction: 'Check in on your lineup, waivers, and league activity to stay engaged.',
      timestamp: '2026-07-09T00:00:00.000Z',
      source: 'user_os',
    },
  ],
  recommendations: [
    {
      leagueId: 'league-1',
      recommendation: {
        id: 'rec-lineup-1',
        tier: 'manager',
        category: 'lineup_discipline',
        entityId: 'user-1',
        priority: 'high',
        severity: 'elevated',
        confidence: 'high',
        affectedDimensions: [],
        expectedImpact: 'Setting your lineup improves weekly win probability.',
        derivation: [],
        evidence: [],
        benchmarkComparison: null,
        prerequisites: [],
        recommendedActions: [{ action: 'Start your bench RB over your injured starter.', rationale: 'r' }],
        rollbackCriteria: [],
        completeness: 100,
        uncertainty: [],
      },
    },
  ],
  leagueTrends: [],
  warnings: [],
  draftsApproachingCount: 1,
}

describe('ManagerCommandCenterSection', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows an honest empty state and never fetches when the user belongs to no leagues', () => {
    render(<ManagerCommandCenterSection leagues={[]} />)
    expect(screen.getByText(/Your multi-league overview will appear here/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the manager command center snapshot and renders every reused module with real data', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SNAPSHOT))
    render(<ManagerCommandCenterSection leagues={LEAGUES} />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/decision-os/manager-command-center',
        expect.objectContaining({ credentials: 'same-origin' }),
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('manager-command-center-overview')).toBeInTheDocument()
    })

    // Reused CommissionerAttentionQueue, unchanged — renders real manager signals.
    expect(screen.getByTestId('attention-queue-item-manager_engagement_risk:league-2')).toHaveTextContent('Redraft Rebels')
    expect(screen.getByTestId('attention-queue-item-manager_engagement_risk:league-2')).toHaveTextContent(
      'Your retention risk for this team is "critical".',
    )

    // Reused TodaysBriefCard, composed from the SAME fetched snapshot — zero additional request.
    expect(screen.getByTestId('todays-brief-card')).toBeInTheDocument()
    expect(screen.getByTestId('todays-brief-priority-items')).toHaveTextContent('Redraft Rebels')

    // Reused NotificationCenter, composed with zero additional request.
    expect(screen.getByTestId('notification-center')).toBeInTheDocument()

    // Phase OS-C2: Lineup Priorities renders the real recommendation; Trade shows its honest empty
    // state since the fixture has no recommendation in that category.
    expect(screen.getByTestId('manager-priority-lineup_discipline-item-rec-lineup-1')).toHaveTextContent(
      'Start your bench RB over your injured starter.',
    )
    expect(screen.getByTestId('manager-priority-trade_coaching-empty')).toBeInTheDocument()

    // Phase V2.5: the "Waiver Priorities" module was removed — those exact recommendations are now the
    // dominant Waiver Impact Sequence in the Waiver OS workspace, so rendering both would duplicate them.
    expect(screen.queryByTestId('manager-priority-waiver_opportunity-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('waiver-os-workspace')).toBeInTheDocument()

    // New Manager League Switcher, real navigation hrefs.
    expect(screen.getByTestId('manager-league-switcher-list')).toBeInTheDocument()
    expect(screen.getByTestId('manager-league-switcher-item-league-2')).toHaveAttribute('href', '/league/league-2')
  })

  it('Phase OS-C3: collapses to ONE combined empty state (not 3 separate empty boxes) when no priorities exist in any category', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ...SNAPSHOT, recommendations: [] }))
    render(<ManagerCommandCenterSection leagues={LEAGUES} />)

    await waitFor(() => {
      expect(screen.getByTestId('manager-priorities-empty')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('manager-priority-lineup_discipline-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manager-priority-trade_coaching-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manager-priority-waiver_opportunity-empty')).not.toBeInTheDocument()
  })

  it("Today's Brief renders an honest healthy state before the snapshot has loaded, with no extra fetch", () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    render(<ManagerCommandCenterSection leagues={LEAGUES} />)

    expect(screen.getByTestId('todays-brief-card')).toBeInTheDocument()
    expect(screen.getByTestId('todays-brief-summary')).toHaveTextContent('Every league looks healthy today.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows a real error message, not a silent failure, when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    render(<ManagerCommandCenterSection leagues={LEAGUES} />)

    await waitFor(() => {
      expect(screen.getByTestId('manager-command-center-error')).toBeInTheDocument()
    })
  })
})
