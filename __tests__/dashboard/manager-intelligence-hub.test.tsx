/**
 * Decision OS Manager Intelligence Platform Phase 1 — Manager Intelligence Hub
 * test (display-only). Proves the hub feature flag, section rendering, the
 * wired League Context module's states (loading / populated / empty / error),
 * the honest "expanding soon" placeholders, and the responsive grid — all
 * without touching any backend (fetch is mocked).
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ManagerIntelligenceHub } from '@/components/manager-intelligence/ManagerIntelligenceHub'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  // Hub on; the reused Replay card's own client flag stays OFF so it renders
  // inert (its own 12 tests cover it) and never fetches during hub tests.
  vi.stubEnv('NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED', 'true')
  // default: standings resolves empty so the hub renders without a hanging fetch
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ standings: [], season: 2025 }) })
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
})

function standings(rows: unknown[]) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ standings: rows, season: 2025 }) })
}

describe('ManagerIntelligenceHub — feature flag', () => {
  it('renders a quiet "not available" state when the hub flag is off', () => {
    vi.stubEnv('NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED', 'false')
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(screen.getByTestId('manager-hub-disabled')).toBeTruthy()
    expect(screen.queryByTestId('manager-intelligence-hub')).toBeNull()
  })

  it('renders the hub with all sections when the flag is on', () => {
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(screen.getByTestId('manager-intelligence-hub')).toBeTruthy()
    expect(screen.getByText('Manager Intelligence')).toBeTruthy()
    expect(screen.getByTestId('hub-league-context')).toBeTruthy()
    expect(screen.getByTestId('hub-weekly-outlook')).toBeTruthy()
    expect(screen.getByTestId('hub-team-health')).toBeTruthy()
    expect(screen.getByTestId('hub-transaction-readiness')).toBeTruthy()
  })
})

describe('ManagerIntelligenceHub — League Context module states', () => {
  it('shows a loading state before the standings fetch resolves', () => {
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('renders the standings rows when populated', async () => {
    standings([
      { rank: 1, teamName: 'Team Alpha', wins: 9, losses: 3, pointsFor: 1450.5 },
      { rank: 2, teamName: 'Team Bravo', wins: 8, losses: 4, pointsFor: 1402.1 },
    ])
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('league-context-content')).toBeTruthy()
    expect(screen.getByText(/Team Alpha/)).toBeTruthy()
    expect(screen.getByText(/Team Bravo/)).toBeTruthy()
  })

  it('shows an honest empty state when there are no standings', async () => {
    standings([])
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('league-context-empty')).toBeTruthy()
  })

  it('shows an error state when the standings request fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByText(/Could not load/i)).toBeTruthy()
  })
})

describe('ManagerIntelligenceHub — honest placeholders', () => {
  it('renders "expanding soon" placeholders for the sections without a clean reusable source', () => {
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(screen.getByText(/Matchup, projected difficulty, and schedule — expanding soon\./i)).toBeTruthy()
    expect(screen.getByText(/Injuries, byes, and roster readiness — expanding soon\./i)).toBeTruthy()
    expect(screen.getByText(/Waiver availability, roster flexibility, and bench pressure — expanding soon\./i)).toBeTruthy()
  })
})

describe('ManagerIntelligenceHub — responsive layout', () => {
  it('uses a responsive grid (single column on mobile, two columns from the md breakpoint)', () => {
    render(<ManagerIntelligenceHub leagueId="L1" />)
    const grid = screen.getByTestId('manager-hub-grid')
    expect(grid.className).toContain('grid')
    expect(grid.className).toContain('md:grid-cols-2')
  })
})
