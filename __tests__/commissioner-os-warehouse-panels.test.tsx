import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LeagueAnalyticsView } from '@/components/commissioner-os/analytics/LeagueAnalyticsView'
import { buildAnalyticsCsv } from '@/lib/commissioner-ui/analytics/exportCsv'
import type {
  LeagueAnalyticsSnapshot,
  ManagerActivityEntry,
} from '@/lib/commissioner-ui/analytics/decision-os-client/types'

/**
 * The panels that were hard-coded `[]` until the warehouse was wired.
 *
 * Fixtures here mirror the SHAPE of real production rows (measured on a 12-team Sleeper league:
 * 2025 the newest scored season, 98 games, 12 teams, sub-1.0 offseason action rates) rather than
 * tidy round numbers — several of the bugs these assertions pin only appear at real cardinalities
 * and real magnitudes.
 */

const BASE: LeagueAnalyticsSnapshot = {
  kpis: [],
  trends: [],
  competitiveBalance: [],
  scoringDistribution: [],
  transactionsByWeek: [],
  rosterUtilization: [],
  seasonComparison: [],
  healthByWeek: [],
  healthTarget: null,
  managerActivity: [],
  pointsForAgainst: [],
  dataWindow: null,
  seasonLabel: null,
  generatedAt: '2026-09-07T20:00:00.000Z',
}

const POINTS = [
  { teamName: 'Nicolodeon', pointsFor: 2488.9, pointsAgainst: 1949.4 },
  { teamName: 'Dega Mong', pointsFor: 2367.2, pointsAgainst: 2106.6 },
  { teamName: '10$SF', pointsFor: 2343.3, pointsAgainst: 1789.1 },
]

function mgr(name: string, now: number, prior: number): ManagerActivityEntry {
  return { managerName: name, actionsPerWeek: now, priorActionsPerWeek: prior }
}

describe('commissioner-os analytics — warehouse-backed panels', () => {
  it('names the season on the points panel, because in preseason it is LAST season', () => {
    render(
      <LeagueAnalyticsView
        snapshot={{ ...BASE, pointsForAgainst: POINTS, seasonLabel: '2025' }}
        dataMode="live"
      />,
    )
    expect(screen.getByText(/Season totals per team — 2025\./)).toBeInTheDocument()
    expect(screen.getByText('Nicolodeon')).toBeInTheDocument()
  })

  it('falls back to an unlabelled note when no season has been scored', () => {
    // The control for the assertion above: if the label were unconditional it would render "— null".
    render(<LeagueAnalyticsView snapshot={{ ...BASE, pointsForAgainst: POINTS }} dataMode="live" />)
    expect(screen.getByText('Season totals per team.')).toBeInTheDocument()
    expect(screen.queryByText(/— null/)).not.toBeInTheDocument()
  })

  it('does not say "Both were" when more than two managers lapsed', () => {
    /*
     * The regression that motivated the fix. The demo fixture contains exactly two lapsed
     * managers, so "Both were" and a naive " and " join both read correctly and shipped unnoticed;
     * a real league produced "Both were above 0 — A and B and C and D".
     */
    const rows = [mgr('Ada', 1, 4), mgr('Bo', 1, 5), mgr('Cy', 1, 6), mgr('Di', 9, 9)]
    render(<LeagueAnalyticsView snapshot={{ ...BASE, managerActivity: rows }} dataMode="live" />)
    // The call-out specifically, not the panel note above it — both contain "actions a week".
    const callout = screen.getByRole('note')
    expect(callout.textContent).not.toContain('Both were')
    expect(callout.textContent).toContain('Ada, Bo and Cy')
    expect(callout.textContent).not.toContain('and Bo and')
  })

  it('joins exactly two names with "and", not a comma', () => {
    const rows = [mgr('Ada', 1, 4), mgr('Bo', 1, 5), mgr('Di', 9, 9)]
    render(<LeagueAnalyticsView snapshot={{ ...BASE, managerActivity: rows }} dataMode="live" />)
    expect(screen.getByText(/Ada and Bo/)).toBeInTheDocument()
  })

  it('rounds the delta instead of printing a float artifact', () => {
    /*
     * `0.31 - 1.4` is `1.0899999999999999`. The leaderboard printed exactly that on a real league,
     * two rows above a clean `1.09` computed from different operands — so the bug was intermittent
     * and invisible in any fixture using round numbers. These operands reproduce it.
     */
    const rows = [mgr('Ada', 0.31, 1.4), mgr('Bo', 0.5, 0.5)]
    const { container } = render(
      <LeagueAnalyticsView snapshot={{ ...BASE, managerActivity: rows }} dataMode="live" />,
    )
    const deltas = [...container.querySelectorAll('.cos-lb-delta')].map((e) => e.textContent ?? '')
    expect(deltas.join(' ')).not.toMatch(/\d\.\d{3,}/)
    expect(deltas.join(' ')).toContain('1.09')
  })

  it('does not attribute a decline to managers who did not decline', () => {
    /*
     * Three below the threshold, but only two actually fell — the third was always at zero.
     * The sentence used to read "3 managers are below 5. They were each above …" and then name
     * two, asserting something false about the third.
     */
    const rows = [mgr('Ada', 1, 4), mgr('Bo', 1, 5), mgr('Cy', 0, 0)]
    render(<LeagueAnalyticsView snapshot={{ ...BASE, managerActivity: rows }} dataMode="live" />)
    const callout = screen.getByRole('note')
    expect(callout.textContent).toContain('3 managers are below')
    expect(callout.textContent).toContain('2 of them were above')
    expect(callout.textContent).not.toContain('They were each')
  })

  it('reports a league-wide decline instead of flagging every manager individually', () => {
    /*
     * `LOW_ACTIVITY_THRESHOLD` is calibrated for in-season play. A dynasty league in August is
     * legitimately below it across the board, and "7 managers are below 5 actions a week" every
     * offseason day trains the reader to ignore the line.
     */
    const rows = [
      mgr('Ada', 0.31, 1.32),
      mgr('Bo', 0.23, 1.24),
      mgr('Cy', 0.15, 0.9),
      mgr('Di', 0.08, 1.01),
    ]
    render(<LeagueAnalyticsView snapshot={{ ...BASE, managerActivity: rows }} dataMode="live" />)
    const callout = screen.getByRole('note')
    expect(callout.textContent).toContain('4 of 4 managers are doing less than they were')
    // The leaderboard is directly below; the call-out must not restate it as a list of names.
    expect(callout.textContent).not.toContain('Ada')
  })

  it('gives the specific reason a still-blank panel is blank', () => {
    render(<LeagueAnalyticsView snapshot={BASE} dataMode="live" />)
    // "we could draw this and it would mislead you" is not "we have no data".
    expect(screen.getByText(/read as a collapsing league rather than a normal August/)).toBeInTheDocument()
  })

  it('renders competitive balance as counted games, never a synthesised index', () => {
    const snapshot = {
      ...BASE,
      competitiveBalance: [
        { label: 'Blowouts', value: '56 of 98', interpretation: '57% of games were decided by 30 points or more.' },
      ],
    }
    render(<LeagueAnalyticsView snapshot={snapshot} dataMode="live" />)
    expect(screen.getByText('56 of 98')).toBeInTheDocument()
  })

  it('does not call calendar weeks "this season"', () => {
    /*
     * The range label falls back to the transaction week count, and those are CALENDAR weeks —
     * a dynasty league's activity runs January to August. A real league rendered "Weeks 1–13,
     * this season" across thirteen weeks spanning two thirds of the year.
     */
    const weeks = Array.from({ length: 13 }, (_, i) => ({
      weekLabel: `Jan ${i + 1}`,
      tradeCount: 0,
      waiverClaimCount: 1,
    }))
    render(<LeagueAnalyticsView snapshot={{ ...BASE, transactionsByWeek: weeks }} dataMode="live" />)
    expect(screen.getByText('13 weeks with activity')).toBeInTheDocument()
    expect(screen.queryByText(/Weeks 1–13, this season/)).not.toBeInTheDocument()
  })

  it('still says "this season" when the weeks really are season weeks', () => {
    // The control: `healthByWeek` is genuinely season-indexed and keeps the season wording.
    const health = Array.from({ length: 5 }, (_, i) => ({
      weekLabel: `Wk ${i + 1}`,
      thisSeason: 70,
      lastSeason: null,
    }))
    render(<LeagueAnalyticsView snapshot={{ ...BASE, healthByWeek: health }} dataMode="live" />)
    expect(screen.getByText('Weeks 1–5, this season')).toBeInTheDocument()
  })

  it('carries the scoring season into the CSV, which has no panel note', () => {
    const csv = buildAnalyticsCsv({ ...BASE, pointsForAgainst: POINTS, seasonLabel: '2025' })
    expect(csv).toContain('Scoring season')
    expect(csv).toContain('2025')
    expect(csv).toContain('Nicolodeon — For')
    // Omitted entirely rather than emitting a blank row when unknown.
    expect(buildAnalyticsCsv({ ...BASE, pointsForAgainst: POINTS })).not.toContain('Scoring season')
  })
})
