/**
 * Decision OS Manager Intelligence Platform — Manager Intelligence Hub test
 * (display-only). Proves the hub feature flag, section rendering, the wired
 * League Context module states (loading / populated / empty / error), the
 * Phase 2 Team Health module states (flag-off / empty / populated), the honest
 * "expanding soon" placeholders, and the responsive grid — all without touching
 * any backend (fetch is mocked, routed by URL).
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ManagerIntelligenceHub } from '@/components/manager-intelligence/ManagerIntelligenceHub'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

interface RouteHandlers {
  standings?: unknown
  teamHealth?: unknown
}
function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}
// Route each request by URL so League Context and Team Health can be controlled
// independently. Handlers are RAW response bodies — routeFetch wraps them in the
// Response-like shape useResource expects. Defaults: standings empty, TH flag-off.
function routeFetch(handlers: RouteHandlers = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/team-health')) {
      return ok(handlers.teamHealth ?? { enabled: false })
    }
    if (typeof url === 'string' && url.includes('/standings')) {
      return ok(handlers.standings ?? { standings: [], season: 2025 })
    }
    return ok({})
  })
}

beforeEach(() => {
  // Hub on; the reused Replay card's own client flag stays OFF so it renders
  // inert (its own tests cover it) and never fetches during hub tests.
  vi.stubEnv('NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED', 'true')
  routeFetch()
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
})

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
    expect(screen.getByTestId('hub-team-health')).toBeTruthy()
    expect(screen.getByTestId('hub-weekly-outlook')).toBeTruthy()
    expect(screen.getByTestId('hub-transaction-readiness')).toBeTruthy()
  })
})

describe('ManagerIntelligenceHub — League Context module states', () => {
  it('shows a loading state before the fetches resolve', () => {
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('renders the standings rows when populated', async () => {
    routeFetch({
      standings: {
        standings: [
          { rank: 1, teamName: 'Team Alpha', wins: 9, losses: 3, pointsFor: 1450.5 },
          { rank: 2, teamName: 'Team Bravo', wins: 8, losses: 4, pointsFor: 1402.1 },
        ],
        season: 2025,
      },
    })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('league-context-content')).toBeTruthy()
    expect(screen.getByText(/Team Alpha/)).toBeTruthy()
    expect(screen.getByText(/Team Bravo/)).toBeTruthy()
  })

  it('shows an honest empty state when there are no standings', async () => {
    routeFetch({ standings: { standings: [], season: 2025 } })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('league-context-empty')).toBeTruthy()
  })

  it('shows an error state when the standings request fails', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/standings') ? { ok: false, status: 500, json: async () => ({}) } : ok({ enabled: false }),
    )
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('hub-league-context')).toBeTruthy()
    // League Context surfaces the error copy (Team Health is flag-off here).
    const ctx = screen.getByTestId('hub-league-context')
    expect(ctx.textContent).toMatch(/Could not load/i)
  })
})

describe('ManagerIntelligenceHub — Team Health module states (Phase 2)', () => {
  it('renders a quiet "expanding soon" note when the Team Health server flag is off', async () => {
    routeFetch({ teamHealth: { enabled: false } })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('team-health-disabled')).toBeTruthy()
  })

  it('renders an honest empty state when enabled but the user has no roster data', async () => {
    routeFetch({ teamHealth: { enabled: true } })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('team-health-empty')).toBeTruthy()
  })

  it('renders the deterministic health summary and counts when data is present', async () => {
    routeFetch({
      teamHealth: {
        enabled: true,
        data: {
          version: 'manager-team-health.v1',
          derivedAt: '2026-09-01T00:00:00.000Z',
          starterCount: 9,
          availableStarterCount: 7,
          injuredStarterCount: 2,
          questionableStarterCount: 1,
          byeWeekStarterCount: 0,
          benchAvailability: 'thin',
          rosterCompleteness: 'needs_attention',
          summary: '2 projected starters are currently unavailable. Bench depth looks thin.',
        },
      },
    })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('team-health-content')).toBeTruthy()
    expect(screen.getByText(/2 projected starters are currently unavailable/i)).toBeTruthy()
    expect(screen.getByText('7 / 9')).toBeTruthy()
    expect(screen.getByText(/Roster: needs attention/i)).toBeTruthy()
  })
})

describe('ManagerIntelligenceHub — honest placeholders', () => {
  it('renders "expanding soon" placeholders for the sections without a clean reusable source', () => {
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(screen.getByText(/Matchup, projected difficulty, and schedule — expanding soon\./i)).toBeTruthy()
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
