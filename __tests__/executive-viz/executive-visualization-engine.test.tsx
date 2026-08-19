/**
 * Fantasy OS Suite — Phase V2.0: Executive Visualization Engine + Commissioner OS League Health Map.
 *
 * Covers: provider-agnostic view-model mapping, the flagship's populated / loading / unavailable states,
 * status-color mapping, the accessible text summary, reduced-motion behavior, the data-integrity
 * boundary (no raw provider/API fields, no fabricated history), the 60/30/10 hierarchy, and that the
 * Visual OS V1.0–V1.3 primitives are still in use.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import {
  buildCommissionerLeagueHealthViewModel,
  selectFlagshipSnapshot,
  compareDimensionSeverity,
} from '@/lib/executive-viz/commissionerLeagueHealthViewModel'
import LeagueHealthMap from '@/components/executive-viz/LeagueHealthMap'
import {
  EXECUTIVE_STATUS_SURFACE,
  EXECUTIVE_STATUS_LABEL,
} from '@/components/executive-viz/executiveVizTokens'

// framer-motion's useReducedMotion reads window.matchMedia; jsdom doesn't provide it. Default: no
// reduced-motion. Individual tests can override.
function installMatchMedia(reduce = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('reduce') ? reduce : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

beforeAll(() => installMatchMedia(false))

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

function makeSnapshot(overrides: Partial<CommissionerLeagueHealthSnapshot> = {}): CommissionerLeagueHealthSnapshot {
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
    fairnessScore: 68,
    sustainabilityScore: 74,
    overallStatus: 'healthy',
    healthTrend: 'stable',
    summary: 'League health: 78/100 (healthy).',
    metrics: {
      inactiveTeams: 0,
      missedLineups: 0,
      tradeActivity: 4,
      waiverActivity: 12,
      leagueEngagement: 72,
      commissionerActions: 0,
      pendingWaiverClaims: 0,
      pendingTrades: 0,
      openAiAlerts: 0,
      chatMessagesLast7Days: 30,
      activeManagers: 12,
      injuredStarters: 1,
      lineupSubmissionRate: 0.95,
      projectionCoveragePct: 82,
      lowConfidenceProjectionStarters: 1,
    },
    alerts: [],
    recommendations: [],
    actions: [
      {
        key: 'process_waivers',
        label: 'Process waivers',
        description: 'Run waivers now',
        href: '/league/league-1/waivers',
        enabled: true,
        requiresConfirmation: false,
        tone: 'standard',
      },
      {
        key: 'settings',
        label: 'League settings',
        description: 'Open settings',
        href: '/league/league-1/settings',
        enabled: true,
        requiresConfirmation: false,
        tone: 'standard',
      },
    ],
    assistantQuestions: [],
    ...overrides,
  }
}

describe('CommissionerLeagueHealthViewModel — provider-agnostic mapping (Phase V2.0)', () => {
  it('maps a normalized snapshot into 8 real health dimensions', () => {
    const vm = buildCommissionerLeagueHealthViewModel(makeSnapshot())
    expect(vm).not.toBeNull()
    expect(vm!.dimensions).toHaveLength(8)
    const keys = vm!.dimensions.map((d) => d.key).sort()
    expect(keys).toEqual(
      [
        'competitive_balance',
        'data_readiness',
        'engagement',
        'lineup_readiness',
        'manager_activity',
        'overall_health',
        'sustainability',
        'unresolved_actions',
      ].sort(),
    )
  })

  it('returns null for a missing snapshot rather than inventing dimensions', () => {
    expect(buildCommissionerLeagueHealthViewModel(null)).toBeNull()
    expect(buildCommissionerLeagueHealthViewModel(undefined)).toBeNull()
  })

  it('ranks the areas that need attention first (worst status at the top)', () => {
    const vm = buildCommissionerLeagueHealthViewModel(
      makeSnapshot({
        overallStatus: 'at_risk',
        healthScore: 40,
        fairnessScore: 30, // -> critical
        metrics: {
          ...makeSnapshot().metrics,
          inactiveTeams: 3, // -> critical manager activity
          activeManagers: 9,
          pendingWaiverClaims: 4,
          pendingTrades: 3, // openCount 7 -> critical
        },
      }),
    )
    const statuses = vm!.dimensions.map((d) => d.status)
    // First dimension must be the most severe; healthy/excellent must not precede a critical one.
    const firstCriticalIdx = statuses.indexOf('critical')
    const lastHealthyIdx = statuses.lastIndexOf('healthy')
    expect(firstCriticalIdx).toBeGreaterThanOrEqual(0)
    if (lastHealthyIdx >= 0) expect(firstCriticalIdx).toBeLessThan(lastHealthyIdx)
  })

  it('marks a dimension unavailable — not "good" — when its data is genuinely missing', () => {
    const vm = buildCommissionerLeagueHealthViewModel(
      makeSnapshot({ teamCount: 0, metrics: { ...makeSnapshot().metrics, activeManagers: 0 } }),
    )
    const activity = vm!.dimensions.find((d) => d.key === 'manager_activity')
    expect(activity!.status).toBe('unavailable')
    expect(activity!.score).toBeNull()
  })

  it('shows the real underlying figure in every dimension value label', () => {
    const vm = buildCommissionerLeagueHealthViewModel(makeSnapshot())
    const unresolved = vm!.dimensions.find((d) => d.key === 'unresolved_actions')
    expect(unresolved!.valueLabel).toBe('All clear')
    const activity = vm!.dimensions.find((d) => d.key === 'manager_activity')
    expect(activity!.valueLabel).toContain('12 of 12 active')
  })

  it('computes an accessible attention headline from real counts', () => {
    const clean = buildCommissionerLeagueHealthViewModel(makeSnapshot())
    expect(clean!.attention.needsAttentionCount).toBe(0)
    expect(clean!.attention.headline).toContain('Sunday Money')
  })

  it('attaches only real enabled commissioner actions to dimensions', () => {
    const vm = buildCommissionerLeagueHealthViewModel(makeSnapshot())
    const unresolved = vm!.dimensions.find((d) => d.key === 'unresolved_actions')
    expect(unresolved!.actionHref).toBe('/league/league-1/waivers')
    // A dimension with no matching enabled action must not fabricate one.
    const balance = vm!.dimensions.find((d) => d.key === 'competitive_balance')
    expect(balance!.actionHref).toBeUndefined()
  })

  it('produces a provider-agnostic context label with no provider or DB identifiers', () => {
    const vm = buildCommissionerLeagueHealthViewModel(makeSnapshot())
    expect(vm!.contextLabel).toBe('NFL redraft · Week 5 · 12 teams')
  })
})

describe('selectFlagshipSnapshot — surfaces the most at-risk league (Phase V2.0)', () => {
  it('picks the worst overall status, then the lowest score', () => {
    const healthy = makeSnapshot({ leagueId: 'a', overallStatus: 'healthy', healthScore: 80 })
    const critical = makeSnapshot({ leagueId: 'b', overallStatus: 'critical', healthScore: 30 })
    const watch = makeSnapshot({ leagueId: 'c', overallStatus: 'watch', healthScore: 55 })
    expect(selectFlagshipSnapshot([healthy, critical, watch])!.leagueId).toBe('b')
    expect(selectFlagshipSnapshot([])).toBeNull()
  })
})

describe('LeagueHealthMap — flagship render states (Phase V2.0)', () => {
  it('renders every dimension as a labeled status meter with an accessible summary', () => {
    const vm = buildCommissionerLeagueHealthViewModel(makeSnapshot())
    render(<LeagueHealthMap viewModel={vm} />)
    expect(screen.getByText('League Health Map')).toBeTruthy()
    expect(screen.getByTestId('executive-viz-summary').textContent).toContain('Sunday Money')
    // meters expose aria-valuenow for assistive tech
    const meters = screen.getAllByRole('meter')
    expect(meters.length).toBe(8)
    for (const meter of meters) {
      expect(meter.getAttribute('aria-valuenow')).not.toBeNull()
    }
  })

  it('shows an honest loading state, not a zero-value chart', () => {
    render(<LeagueHealthMap viewModel={null} loading />)
    expect(screen.getByLabelText('Loading league health map')).toBeTruthy()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('shows an unavailable state and NO fabricated dimensions when there is no data', () => {
    render(<LeagueHealthMap viewModel={null} />)
    expect(screen.getByTestId('executive-viz-unavailable')).toBeTruthy()
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByTestId('executive-viz-unavailable').textContent).toContain('no sample data')
  })

  it('renders under reduced-motion without error and still exposes the data', () => {
    installMatchMedia(true)
    const vm = buildCommissionerLeagueHealthViewModel(makeSnapshot())
    render(<LeagueHealthMap viewModel={vm} />)
    expect(screen.getAllByRole('meter').length).toBe(8)
    installMatchMedia(false)
  })

  it('does not render provider/API names or raw player-level records', () => {
    const vm = buildCommissionerLeagueHealthViewModel(makeSnapshot())
    const { container } = render(<LeagueHealthMap viewModel={vm} />)
    const text = container.textContent?.toLowerCase() ?? ''
    for (const banned of ['sleeper', 'espn', 'yahoo', 'fantrax', 'payload', 'resolver', 'decision os']) {
      expect(text).not.toContain(banned)
    }
  })
})

describe('Executive Viz status semantics reuse Visual OS tokens (Phase V2.0)', () => {
  it('every status surface routes through the semantic status-* tokens, never a raw hue or hex', () => {
    for (const cls of Object.values(EXECUTIVE_STATUS_SURFACE)) {
      // must use status-*/surface-*/subtle semantic tokens, not e.g. bg-emerald-500 or #hex
      expect(cls).not.toMatch(/#[0-9a-fA-F]{3,6}/)
      expect(cls).not.toMatch(/(emerald|amber|rose|orange|cyan|violet|lime|sky)-\d{3}/)
    }
    expect(EXECUTIVE_STATUS_LABEL.at_risk).toBe('Needs attention')
    expect(EXECUTIVE_STATUS_LABEL.unavailable).toBe('Not available')
  })
})

describe('Phase V2.0 data-integrity boundary — source scans', () => {
  it('the view model imports no provider payload types and references no provider names', () => {
    const source = readSource('lib', 'executive-viz', 'commissionerLeagueHealthViewModel.ts')
    const lower = source.toLowerCase()
    for (const banned of ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']) {
      // allowed only inside the doc comment enumerating providers for the agnostic guarantee; assert no
      // import/usage lines reference them
      const codeLines = source
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*') && !l.trimStart().startsWith('//'))
        .join('\n')
        .toLowerCase()
      expect(codeLines).not.toContain(banned)
    }
    expect(lower).not.toContain('sparkline')
  })

  it('the flagship deliberately draws no time-series / sparkline (no legitimate history exists)', () => {
    const source = readSource('components', 'executive-viz', 'LeagueHealthMap.tsx')
    // Strip block + line comments so the assertion can't false-positive on the file's own docs, which
    // deliberately explain WHY no sparkline/time-series is drawn.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*/, ''))
      .join('\n')
    expect(codeOnly.toLowerCase()).not.toContain('sparkline')
    expect(codeOnly).not.toContain('LineChart')
    expect(codeOnly).not.toContain('AreaChart')
  })
})

describe('Commissioner OS still uses Visual OS V1.0–V1.3 primitives (Phase V2.0)', () => {
  it('CommissionerHubPageClient keeps the shared tone helpers and renders the flagship', () => {
    const source = readSource('app', 'commissioner-hub', 'CommissionerHubPageClient.tsx')
    expect(source).toContain('decisionOsHealthStatusToneClasses')
    expect(source).toContain('decisionOsToneClasses')
    expect(source).toContain('CommissionerOsFlagship')
    expect(source).toContain('LeagueHealthMap')
  })

  it('compareDimensionSeverity orders critical before healthy', () => {
    const a = { status: 'critical' } as Parameters<typeof compareDimensionSeverity>[0]
    const b = { status: 'healthy' } as Parameters<typeof compareDimensionSeverity>[1]
    expect(compareDimensionSeverity(a, b)).toBeLessThan(0)
  })
})
