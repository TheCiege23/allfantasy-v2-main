/**
 * Fantasy OS Suite — Phase OS-C6: Fantasy OS Production Readiness Audit.
 *
 * Found during the observability audit: `composeNotificationFeed`/`resolveDeliveryPlan` were called
 * inside a `useMemo` with zero error handling in both `CommissionerCommandCenterSection.tsx` and
 * `ManagerCommandCenterSection.tsx` — a malformed signal/brief throwing would crash the whole section
 * (caught only by the page-level error boundary, with no record of which signal caused it). Both
 * sections now wrap composition in try/catch, degrading to an honest empty notification feed instead
 * of taking down the entire Multi-League Overview.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

vi.mock('@/lib/decision-os/notifications', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/notifications')>(
    '@/lib/decision-os/notifications',
  )
  return {
    ...actual,
    composeNotificationFeed: vi.fn(() => {
      throw new Error('Simulated notification composition failure — should not crash the page')
    }),
  }
})

const LEAGUE_ATTENTION_QUEUE = [
  {
    id: 'signal-1',
    leagueId: 'league-1',
    type: 'manager_engagement_risk',
    severity: 'critical',
    priorityScore: 500,
    title: 'Real signal',
    explanation: 'Real explanation',
    recommendedAction: null,
    timestamp: '2026-07-09T00:00:00.000Z',
    source: 'user_os',
  },
]

describe('Notification composition error handling (Phase OS-C6)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('ManagerCommandCenterSection: a composition failure degrades to an honest empty notification feed, never crashes the section', async () => {
    const { default: ManagerCommandCenterSection } = await import(
      '@/components/decision-os/ManagerCommandCenterSection'
    )
    fetchMock.mockResolvedValueOnce(
      okResponse({
        generatedAt: '2026-07-09T00:00:00.000Z',
        totalLeagues: 1,
        healthyLeagueCount: 0,
        atRiskLeagueCount: 1,
        unavailableLeagueCount: 0,
        leagueSummaries: [],
        attentionQueue: LEAGUE_ATTENTION_QUEUE,
        recommendations: [],
        leagueTrends: [],
        warnings: [],
        draftsApproachingCount: 0,
      }),
    )
    render(<ManagerCommandCenterSection leagues={[{ id: 'league-1', name: 'Dynasty Warriors' }]} />)

    await waitFor(() => {
      expect(screen.getByTestId('manager-command-center-overview')).toBeInTheDocument()
    })
    // The section itself rendered fully (proving no crash), AND the real Attention Queue signal
    // still renders correctly (proving the failure was scoped to notification composition only) —
    // the Notification Center degrades to its own honest empty state since composition threw.
    expect(screen.getByTestId('attention-queue-item-signal-1')).toBeInTheDocument()
    expect(screen.getByTestId('notification-center-empty')).toBeInTheDocument()
    expect(console.error).toHaveBeenCalled()
  })

  it('CommissionerCommandCenterSection: a composition failure degrades to an honest empty notification feed, never crashes the section', async () => {
    const { default: CommissionerCommandCenterSection } = await import(
      '@/components/decision-os/CommissionerCommandCenterSection'
    )
    fetchMock.mockResolvedValueOnce(
      okResponse({
        generatedAt: '2026-07-09T00:00:00.000Z',
        totalLeagues: 1,
        healthyLeagueCount: 0,
        atRiskLeagueCount: 1,
        unavailableLeagueCount: 0,
        totalActiveManagers: 0,
        totalInactiveManagers: 0,
        totalRetentionRiskManagers: 0,
        leagueSummaries: [],
        attentionQueue: LEAGUE_ATTENTION_QUEUE,
        recentChanges: [],
        warnings: [],
        draftsApproachingCount: 0,
      }),
    )
    render(
      <CommissionerCommandCenterSection
        commissionerLeagues={[{ id: 'league-1', name: 'Dynasty Warriors' }]}
        onSelectLeague={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('command-center-overview')).toBeInTheDocument()
    })
    expect(screen.getByTestId('attention-queue-item-signal-1')).toBeInTheDocument()
    expect(screen.getByTestId('notification-center-empty')).toBeInTheDocument()
    expect(console.error).toHaveBeenCalled()
  })
})
