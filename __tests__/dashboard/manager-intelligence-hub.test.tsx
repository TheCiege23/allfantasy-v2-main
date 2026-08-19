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
  weeklyOutlook?: unknown
  transactionReadiness?: unknown
  replayInsights?: unknown
}
function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}
// Route each request by URL so each module can be controlled independently.
// Handlers are RAW response bodies — routeFetch wraps them in the Response-like
// shape useResource expects. Defaults: standings empty, all modules flag-off.
function routeFetch(handlers: RouteHandlers = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/team-health')) {
      return ok(handlers.teamHealth ?? { enabled: false })
    }
    if (typeof url === 'string' && url.includes('/weekly-outlook')) {
      return ok(handlers.weeklyOutlook ?? { enabled: false })
    }
    if (typeof url === 'string' && url.includes('/transaction-readiness')) {
      return ok(handlers.transactionReadiness ?? { enabled: false })
    }
    if (typeof url === 'string' && url.includes('/replay-insights')) {
      return ok(handlers.replayInsights ?? { enabled: false })
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

describe('ManagerIntelligenceHub — Weekly Outlook module states (Phase 3)', () => {
  it('renders a quiet "expanding soon" note when the Weekly Outlook server flag is off', async () => {
    routeFetch({ weeklyOutlook: { enabled: false } })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('weekly-outlook-disabled')).toBeTruthy()
  })

  it('renders an honest empty state when enabled but there is no roster/matchup data', async () => {
    routeFetch({ weeklyOutlook: { enabled: true } })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('weekly-outlook-empty')).toBeTruthy()
  })

  it('renders the deterministic outlook (margin, readiness, projection, summary) when data is present', async () => {
    routeFetch({
      weeklyOutlook: {
        enabled: true,
        data: {
          version: 'manager-weekly-outlook.v1',
          derivedAt: '2026-10-01T00:00:00.000Z',
          week: 5,
          matchupState: 'scheduled',
          opponentName: 'The Rivals',
          projectedPointsFor: 110.5,
          projectedPointsAgainst: 100,
          projectedMargin: 'favored',
          lineupReadiness: 'ready',
          schedulePressure: 'normal',
          summary: 'Your Week 5 matchup against The Rivals projects as favored. Your lineup appears ready.',
          caveats: [],
        },
      },
    })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('weekly-outlook-content')).toBeTruthy()
    expect(screen.getByText(/projects as favored/i)).toBeTruthy()
    expect(screen.getByText('Favored')).toBeTruthy()
    // "The Rivals" appears in both the projected line and the summary sentence.
    expect(screen.getAllByText(/The Rivals/).length).toBeGreaterThan(0)
  })

  it('shows honest caveats when the outlook has them', async () => {
    routeFetch({
      weeklyOutlook: {
        enabled: true,
        data: {
          version: 'manager-weekly-outlook.v1',
          derivedAt: '2026-10-01T00:00:00.000Z',
          week: 5,
          matchupState: 'unavailable',
          opponentName: null,
          projectedPointsFor: null,
          projectedPointsAgainst: null,
          projectedMargin: 'unknown',
          lineupReadiness: 'ready',
          schedulePressure: 'normal',
          summary: 'No matchup is scheduled for your team yet. Your lineup appears ready.',
          caveats: ['No matchup data is available for this week yet.'],
        },
      },
    })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('weekly-outlook-caveats')).toBeTruthy()
    expect(screen.getByText(/No matchup data is available/i)).toBeTruthy()
  })
})

describe('ManagerIntelligenceHub — Transaction Readiness module states (Phase 4)', () => {
  it('renders a quiet "expanding soon" note when the Transaction Readiness server flag is off', async () => {
    routeFetch({ transactionReadiness: { enabled: false } })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('transaction-readiness-disabled')).toBeTruthy()
  })

  it('renders an honest empty state when enabled but the user has no roster data', async () => {
    routeFetch({ transactionReadiness: { enabled: true } })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('transaction-readiness-empty')).toBeTruthy()
  })

  it('renders the deterministic readiness (pressure, flexibility, counts, summary) when data is present', async () => {
    routeFetch({
      transactionReadiness: {
        enabled: true,
        data: {
          version: 'manager-transaction-readiness.v1',
          derivedAt: '2026-10-08T00:00:00.000Z',
          rosterPressure: 'high',
          benchFlexibility: 'tight',
          injuryPressure: 'high',
          byePressure: 'low',
          rosterOpenings: 0,
          reserveCount: 2,
          injuredReserveCount: 1,
          benchCount: 1,
          summary: 'Your roster has high transaction pressure this week. Bench flexibility is tight.',
          caveats: ['Open-slot counts use the format default roster size (no league-configured limit found).'],
        },
      },
    })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('transaction-readiness-content')).toBeTruthy()
    expect(screen.getByText(/high transaction pressure/i)).toBeTruthy()
    expect(screen.getByText('Pressure: high')).toBeTruthy()
    expect(screen.getByText('Bench: tight')).toBeTruthy()
    expect(screen.getByTestId('transaction-readiness-caveats')).toBeTruthy()
  })
})

describe('ManagerIntelligenceHub — no remaining placeholders (Phase 4 complete)', () => {
  it('renders all five real modules and no "expanding soon" static placeholder card', async () => {
    // Every module has data → none is in its flag-off "expanding soon" state.
    routeFetch({
      standings: { standings: [{ rank: 1, teamName: 'Alpha', wins: 1, losses: 0, pointsFor: 100 }], season: 2025 },
      teamHealth: { enabled: true, data: { version: 'manager-team-health.v1', derivedAt: 'x', starterCount: 9, availableStarterCount: 9, injuredStarterCount: 0, questionableStarterCount: 0, byeWeekStarterCount: 0, benchAvailability: 'healthy', rosterCompleteness: 'excellent', summary: 'All good.' } },
      weeklyOutlook: { enabled: true, data: { version: 'manager-weekly-outlook.v1', derivedAt: 'x', week: 5, matchupState: 'scheduled', opponentName: 'Rivals', projectedPointsFor: 110, projectedPointsAgainst: 100, projectedMargin: 'favored', lineupReadiness: 'ready', schedulePressure: 'normal', summary: 'Favored.', caveats: [] } },
      transactionReadiness: { enabled: true, data: { version: 'manager-transaction-readiness.v1', derivedAt: 'x', rosterPressure: 'low', benchFlexibility: 'flexible', injuryPressure: 'low', byePressure: 'low', rosterOpenings: 1, reserveCount: 6, injuredReserveCount: 0, benchCount: 6, summary: 'Low pressure.', caveats: [] } },
    })
    render(<ManagerIntelligenceHub leagueId="L1" />)
    expect(await screen.findByTestId('league-context-content')).toBeTruthy()
    expect(await screen.findByTestId('team-health-content')).toBeTruthy()
    expect(await screen.findByTestId('weekly-outlook-content')).toBeTruthy()
    expect(await screen.findByTestId('transaction-readiness-content')).toBeTruthy()
    // No "expanding soon" copy anywhere once every module has data.
    expect(screen.queryByText(/expanding soon/i)).toBeNull()
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

describe('ManagerIntelligenceHub — live Sleeper proof pass (Phase 5)', () => {
  // Realistic, Sleeper-import-shaped payloads for ALL five modules with every
  // flag on — the demo surface as a real imported league would render it. (Team
  // names avoid the banned-token list on purpose; the scan polices the hub's own
  // copy, not user-chosen names.)
  const LIVE = {
    standings: {
      season: 2025,
      standings: [
        { rank: 1, teamName: 'KBI Smoke Black', wins: 10, losses: 3, pointsFor: 1642.8 },
        { rank: 2, teamName: 'Gridiron Goblins', wins: 9, losses: 4, pointsFor: 1601.4 },
        { rank: 3, teamName: 'Coastal Crushers', wins: 8, losses: 5, pointsFor: 1555.9 },
      ],
    },
    teamHealth: {
      enabled: true,
      data: {
        version: 'manager-team-health.v1', derivedAt: '2026-12-01T00:00:00.000Z',
        starterCount: 9, availableStarterCount: 7, injuredStarterCount: 1, questionableStarterCount: 1,
        byeWeekStarterCount: 0, benchAvailability: 'thin', rosterCompleteness: 'good',
        summary: '1 projected starter is currently unavailable, and 1 starter is questionable. Bench depth looks thin.',
      },
    },
    weeklyOutlook: {
      enabled: true,
      data: {
        version: 'manager-weekly-outlook.v1', derivedAt: '2026-12-01T00:00:00.000Z',
        week: 14, matchupState: 'scheduled', opponentName: 'Gridiron Goblins',
        projectedPointsFor: 121.6, projectedPointsAgainst: 118.9, projectedMargin: 'close',
        lineupReadiness: 'needs_attention', schedulePressure: 'normal',
        summary: 'Your Week 14 matchup against Gridiron Goblins projects as close. Your lineup needs attention.',
        caveats: [],
      },
    },
    transactionReadiness: {
      enabled: true,
      data: {
        version: 'manager-transaction-readiness.v1', derivedAt: '2026-12-01T00:00:00.000Z',
        rosterPressure: 'moderate', benchFlexibility: 'limited', injuryPressure: 'moderate', byePressure: 'low',
        rosterOpenings: 0, reserveCount: 4, injuredReserveCount: 1, benchCount: 4,
        summary: 'Your roster has moderate transaction pressure this week. Bench flexibility appears limited.',
        caveats: [],
      },
    },
    replayInsights: {
      enabled: true,
      data: {
        scope: 'league', version: 'manager-replay-insight.v1', derivedAt: '2026-12-01T00:00:00.000Z',
        tradesAnalyzed: 14, tradesWithLineupData: 9, validationSource: 'decision_replay_correlation',
        insights: [
          { insightId: 'starter_impact_trades', category: 'starter_impact_trades', headline: 'Starter-impact trades tended to land in your favor', detail: 'Historically your bigger trades converted into real lineup value.', displayValue: '+', sentiment: 'positive', confidence: 'moderate', sampleSize: 5, caveat: null },
          { insightId: 'bench_depth_trades', category: 'bench_depth_trades', headline: 'Bench-depth moves mostly stayed on your bench', detail: 'Depth acquisitions rarely reached your starting lineup.', displayValue: '~', sentiment: 'neutral', confidence: 'low', sampleSize: 3, caveat: 'Limited sample.' },
        ],
      },
    },
  }

  beforeEach(() => {
    // All server module flags are simulated via the mocked route payloads; the
    // replay card additionally needs its own CLIENT flag on to fetch/render.
    vi.stubEnv('NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED', 'true')
    routeFetch(LIVE)
  })

  async function renderLiveAndSettle() {
    render(<ManagerIntelligenceHub leagueId="L1" />)
    await screen.findByTestId('replay-insight-grid')
    await screen.findByTestId('league-context-content')
    await screen.findByTestId('team-health-content')
    await screen.findByTestId('weekly-outlook-content')
    await screen.findByTestId('transaction-readiness-content')
  }

  it('renders all FIVE real modules with live-like imported-league data', async () => {
    await renderLiveAndSettle()
    expect(screen.getByTestId('replay-insight-grid')).toBeTruthy()
    expect(screen.getByTestId('league-context-content')).toBeTruthy()
    expect(screen.getByTestId('team-health-content')).toBeTruthy()
    expect(screen.getByTestId('weekly-outlook-content')).toBeTruthy()
    expect(screen.getByTestId('transaction-readiness-content')).toBeTruthy()
    expect(screen.getByText(/KBI Smoke Black/)).toBeTruthy()
  })

  it('shows NO placeholder / "expanding soon" copy on the live demo surface', async () => {
    await renderLiveAndSettle()
    // None of the four grid modules is in its flag-off placeholder state, and the
    // hub is not in its disabled state.
    expect(screen.queryByText(/expanding soon/i)).toBeNull()
    expect(screen.queryByTestId('manager-hub-disabled')).toBeNull()
    expect(screen.queryByTestId('weekly-outlook-disabled')).toBeNull()
    expect(screen.queryByTestId('team-health-disabled')).toBeNull()
    expect(screen.queryByTestId('transaction-readiness-disabled')).toBeNull()
  })

  it('renders NO recommendation / advice language anywhere in the hub', async () => {
    await renderLiveAndSettle()
    const text = (document.body.textContent ?? '').toLowerCase()
    // Bare "recommend" is intentionally NOT scanned: the replay panel legitimately
    // says it is "not recommendations for future moves." Scan imperative phrasing.
    for (const banned of [/\badd\b/, /\bdrop\b/, /\bwaiver\b/, /\bpickup\b/, /\bclaim\b/, /\btarget\b/, /\bsit\b/, /\bstart\b/, /trade for/, /i recommend/, /we recommend/, /you should/]) {
      expect(banned.test(text)).toBe(false)
    }
  })

  it('renders NO raw provider/Sleeper IDs (no 10+ digit runs)', async () => {
    await renderLiveAndSettle()
    expect(/\d{10,}/.test(document.body.textContent ?? '')).toBe(false)
  })

  it('offers a clear "Back to league" CTA', async () => {
    await renderLiveAndSettle()
    const cta = screen.getByTestId('manager-hub-back-cta')
    expect(cta.getAttribute('href')).toBe('/league/L1')
  })

  it('keeps a responsive grid (1 column mobile → 2 columns at md)', async () => {
    await renderLiveAndSettle()
    const grid = screen.getByTestId('manager-hub-grid')
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('md:grid-cols-2')
  })
})
