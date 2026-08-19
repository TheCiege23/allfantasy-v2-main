/**
 * Phase 36 — UserOsCardConnected is the new self-fetching wrapper that lets
 * NFL/NCAAF's NflRedraftLeagueHomeDashboard.tsx reuse UserOsCard's own
 * rendering/degradation logic without duplicating it. This test proves the
 * fetch wiring only — UserOsCard's own visual states are covered by
 * user-os-card.test.tsx.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserOsCardConnected from '@/components/decision-os/UserOsCardConnected'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'

const AVAILABLE_SNAPSHOT: UserOsSnapshot = {
  leagueId: 'league-nfl-1',
  managerId: 'mgr-1',
  generatedAt: '2026-07-11T12:00:00.000Z',
  available: true,
  teamHealth: {
    participationTier: 'active',
    overallEngagementScore: 55,
    retentionRisk: 'low',
    retentionRiskReasons: [],
    isInactive: false,
    daysSinceLastActivity: 3,
  },
  activitySummary: { tradeEventCount: 1, waiverEventCount: 2, lineupEventCount: 5, draftEventCount: 0 },
  leagueTrend: { available: false, reason: 'no_snapshots' },
  managerDna: null,
  recommendations: null,
}

describe('UserOsCardConnected (Phase 36)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the real /api/decision-os/user-os route for the given leagueId, same-origin, no-store', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => AVAILABLE_SNAPSHOT,
    })

    render(<UserOsCardConnected leagueId="league-nfl-1" />)

    await waitFor(() => expect(screen.getByTestId('user-os-card-league')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/decision-os/user-os?leagueId=league-nfl-1',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    )
  })

  it('renders the loading state before the fetch resolves, then the populated card', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    ;(global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    render(<UserOsCardConnected leagueId="league-nfl-1" />)
    expect(screen.getByText('Your team intelligence is loading')).toBeInTheDocument()

    resolveFetch({ ok: true, json: async () => AVAILABLE_SNAPSHOT })
    await waitFor(() => expect(screen.getByTestId('user-os-retention-risk')).toBeInTheDocument())
  })

  it('never crashes when the fetch fails — same honest degradation LeagueTab.tsx already uses for other sports', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'))

    render(<UserOsCardConnected leagueId="league-nfl-1" />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // Matches the exact real fetch-error pattern already shipped in
    // app/league/[leagueId]/tabs/LeagueTab.tsx (setUserOs(null) on catch) — reused
    // verbatim here, not a new behavior. No crash, no fabricated data.
    expect(screen.getByText('Your team intelligence is loading')).toBeInTheDocument()
  })
})
