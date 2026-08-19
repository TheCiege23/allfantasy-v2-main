/**
 * Test-render verification of the executive workspace UI (jsdom). Renders the real ExecutiveWorkspace with
 * data produced by the deterministic derivation layer, verifying KPIs, truth labels, charts, tab switching,
 * insufficient-evidence states, and copy neutrality — the render evidence the browser onboarding gate blocks.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ExecutiveWorkspace } from '@/components/fantasy-os/executive/ExecutiveWorkspace'
import { deriveAll } from '@/lib/fantasy-os/exec-intelligence/derive'
import { buildFreshness } from '@/lib/fantasy-os/sync/freshness'
import type { ExecSnapshot, ExecLeagueRow, ExecManagerRow } from '@/lib/fantasy-os/exec-data/types'

const L = (o: Partial<ExecLeagueRow>): ExecLeagueRow => ({
  leagueId: 'x', season: '2025', name: 'n', status: 'complete', totalRosters: 12, previousLeagueId: null,
  isMembership: true, formatType: 'dynasty', seedRole: 'member', scoringKeys: 40, rosterPositions: [],
  users: 12, rosters: 12, commissioners: 1, drafts: 1, draftPicks: 100, tradedFuturePicks: 0,
  matchupRecords: 200, weeksWithMatchups: 18, transactions: 0, trades: 0, waivers: 0, freeAgents: 0, faab: 0,
  hasWinnersBracket: true, hasLosersBracket: true, ...o,
})
const M = (o: Partial<ExecManagerRow>): ExecManagerRow => ({ userId: 'u', displayName: 'd', isCommissioner: false, leagueCount: 1, seasonCount: 1, teamNames: [], ...o })

const snapshot: ExecSnapshot = {
  run: {
    runId: 'r', manifestHash: 'h', seedUserId: 's', seedUsername: 'theciege24', generatedAt: '2026-07-11T00:00:00Z',
    schemaVersion: 'fos_phase4.v1', calcVersion: 'discovery.v1', importedAt: '2026-07-11T20:00:00Z', seasons: ['2024', '2025'],
    totals: {}, api: {}, warnings: [],
  },
  leagues: [
    L({ leagueId: 'L1', season: '2025', seedRole: 'commissioner', trades: 10, waivers: 20, freeAgents: 5, faab: 20, transactions: 35 }),
    L({ leagueId: 'L2', season: '2025', formatType: 'redraft', transactions: 0 }),
    L({ leagueId: 'L3', season: '2024', trades: 40, waivers: 30, freeAgents: 10, faab: 30, transactions: 80 }),
  ],
  managers: [M({ userId: 'M1', isCommissioner: true, leagueCount: 3, seasonCount: 2 }), M({ userId: 'M2' }), M({ userId: 'M3', leagueCount: 2, seasonCount: 2 })],
  continuityChainCount: 1,
}

const data = deriveAll(snapshot, 'fixed')

describe('ExecutiveWorkspace render (test-render verified)', () => {
  it('renders the header, source window, and offseason disclosure', () => {
    render(<ExecutiveWorkspace data={data} productName="AllFantasy" />)
    expect(screen.getByText('Portfolio Intelligence')).toBeInTheDocument()
    expect(screen.getAllByText(/Source window/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Offseason week-0 dynasty transactions are not included/i).length).toBeGreaterThan(0)
  })

  it('renders platform KPIs with Live League Data truth labels', () => {
    render(<ExecutiveWorkspace data={data} productName="AllFantasy" />)
    const cards = screen.getAllByTestId('exec-kpi-card')
    expect(cards.length).toBeGreaterThanOrEqual(6)
    expect(within(cards[0]).getByText('League seasons')).toBeInTheDocument()
    expect(screen.getAllByText('Live League Data').length).toBeGreaterThan(0)
  })

  it('switches tabs to reveal distinct surfaces', () => {
    render(<ExecutiveWorkspace data={data} productName="AllFantasy" />)
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }))
    expect(screen.getByText('Positional draft distribution')).toBeInTheDocument()
    expect(screen.getAllByText('Insufficient Evidence').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Manager' }))
    expect(screen.getByText(/Manager psychology, skill & retention/i)).toBeInTheDocument()
    expect(screen.getByText(/willingness to pay/i)).toBeInTheDocument()
  })

  it('renders an evidence-backed insight panel', () => {
    render(<ExecutiveWorkspace data={data} productName="AllFantasy" />)
    expect(screen.getAllByTestId('exec-insight-panel').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/confidence/i).length).toBeGreaterThan(0)
  })

  it('never renders internal engine terminology', () => {
    const { container } = render(<ExecutiveWorkspace data={data} productName="AllFantasy" />)
    expect(container.textContent ?? '').not.toMatch(/Decision OS|Decision Operating System|resolver|shadow-compare/i)
  })

  it('shows a truthful delayed freshness badge for stale real data (not relabeled)', () => {
    const freshness = buildFreshness({
      seasonState: 'regular_season',
      lastSuccessfulSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago → delayed in season
      lastAttemptedSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      now: new Date(),
      sourceProvider: 'p', sourceWindowStart: '2019', sourceWindowEnd: '2025',
    })
    render(<ExecutiveWorkspace data={data} productName="AllFantasy" freshness={freshness} />)
    const badge = screen.getByTestId('sync-freshness')
    expect(badge).toHaveTextContent(/Delayed/i)
    // Freshness is separate from truth: Live League Data still present on KPIs.
    expect(screen.getAllByText('Live League Data').length).toBeGreaterThan(0)
  })
})
