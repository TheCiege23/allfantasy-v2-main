/** Native league screens (handoff 2026-10-11 §3, part B): render against mocked DB-route responses. */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))
vi.mock('@/hooks/useVisibleRefresh', () => ({ useVisibleRefresh: () => undefined }))
vi.mock('@/app/league/[leagueId]/tabs/ProposeTradeModal', () => ({ ProposeTradeModal: ({ open, counterTradeId }: { open: boolean; counterTradeId?: string | null }) => (open ? <div data-testid="builder">{counterTradeId ?? "new"}</div> : null) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }))

import { NativeStandingsScreen } from '@/components/league/native/screens/NativeStandingsScreen'
import { NativeMatchupScreen } from '@/components/league/native/screens/NativeMatchupScreen'
import { NativeTradesScreen } from '@/components/league/native/screens/NativeTradesScreen'

const league = {
  id: 'lg1',
  name: 'Blah',
  sport: 'NFL',
  season: 2026,
  currentWeek: 5,
  teamCount: 4,
  platform: 'allfantasy',
  format: 'redraft',
  settings: { playoff_team_count: 2, first_round_byes: 1, toilet_bowl_enabled: true },
  playoffStartWeek: 15,
} as unknown as UserLeague

type Routes = Record<string, unknown>
function stubFetch(routes: Routes) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const key = Object.keys(routes).find((k) => url.includes(k))
      if (!key) return new Response(JSON.stringify({ error: 'nope' }), { status: 404 })
      return new Response(JSON.stringify(routes[key]), { status: 200 })
    }),
  )
  return calls
}

beforeEach(() => vi.useRealTimers())
afterEach(() => vi.unstubAllGlobals())

const standings = {
  season: 2026,
  scoredWeeks: 4,
  viewerRosterId: 'r2',
  standings: [
    { rosterId: 'r1', teamName: 'Open Team 9', wins: 4, losses: 0, ties: 0, pointsFor: 512.3, pointsAgainst: 401.7, rank: 1, streak: 'W4', allPlay: '14-2' },
    { rosterId: 'r2', teamName: "TheCiege26's Team", wins: 3, losses: 1, ties: 0, pointsFor: 478.6, pointsAgainst: 420.2, rank: 2, streak: 'W2', allPlay: '10-6' },
    { rosterId: 'r3', teamName: 'Open Team 5', wins: 1, losses: 3, ties: 0, pointsFor: 600, pointsAgainst: 433.9, rank: 3, streak: 'L1', allPlay: '15-1' },
    { rosterId: 'r4', teamName: 'Open Team 4', wins: 0, losses: 4, ties: 0, pointsFor: 377, pointsAgainst: 497.3, rank: 4, streak: 'L4', allPlay: '1-15' },
  ],
}

describe('NativeStandingsScreen', () => {
  it('server order, playoff cut, viewer row, bye chip and stored odds', async () => {
    const calls = stubFetch({
      '/scoring/standings': standings,
      '/season-forecast': { teamForecasts: [{ teamId: 'r2', playoffProbability: 81, byeProbability: 44 }] },
      '/scoring/playoff-seeds': { seeds: [] },
    })
    render(<NativeStandingsScreen league={league} isCommissioner onSelectTab={() => {}} />)
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Open Team 9', "TheCiege26's Team", 'Open Team 5', 'Open Team 4'])
    expect(rows[1].getAttribute('data-viewer')).toBe('true')
    expect(rows[2].getAttribute('data-cut')).toBe('true')
    expect(within(rows[0]).getByText('BYE')).toBeTruthy()
    expect(within(rows[1]).getByText('81%')).toBeTruthy()
    expect(screen.getByText(/44% for a bye/)).toBeTruthy()
    expect(screen.getByText('2 · 1 byes')).toBeTruthy()
    expect(screen.getByText('15 – 15')).toBeTruthy()
    expect(screen.getByText('Toilet bowl')).toBeTruthy()
    // GET only: the screen never triggers a forecast run.
    expect(calls.every((c) => !c.init?.method || c.init.method === 'GET')).toBe(true)
  })

  it('Power ranks by all-play, not by record', async () => {
    stubFetch({ '/scoring/standings': standings, '/season-forecast': { teamForecasts: null }, '/scoring/playoff-seeds': { seeds: [] } })
    render(<NativeStandingsScreen league={league} isCommissioner={false} onSelectTab={() => {}} />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Power rankings' }))
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows[0].querySelector('strong')?.textContent).toBe('Open Team 5')
    expect(screen.queryByText('Edit in Commissioner')).toBeNull()
  })
})

const slot = (name: string, position: string, pts: number, status: 'final' | 'live' | 'upcoming', label: string) => ({
  playerId: name, name, position, team: 'PHI', opponent: null, headshotUrl: null, currentPoints: pts, projectedPoints: pts, hasRealProjection: true,
  injuryStatus: null, newsBlurb: null, weatherSummary: null, gameStatus: status, gameLabel: label, aiInsight: null,
})
const side = (rosterId: string, teamName: string, total: number, starters: unknown[]) => ({
  projectedTotalIncludesFallback: false, rosterId, teamName, avatarUrl: null, record: { wins: 3, losses: 1, ties: 0 }, winPct: 0.75,
  totalPoints: total, projectedTotal: total + 10, starters, remainingStarters: 3,
})

describe('NativeMatchupScreen', () => {
  const payload = {
    leagueId: 'lg1', season: 2026, week: 5, sport: 'NFL', matchupStatus: 'live', conceptOverlay: null,
    left: side('r2', "TheCiege26's Team", 112.4, [slot('Jalen Hurts', 'QB', 24.6, 'final', 'Final'), slot('Kyren Williams', 'RB', 0, 'upcoming', 'Sun 8:20 PM')]),
    right: side('r9', 'Sunday Scaries', 98.7, [slot('Josh Allen', 'QB', 21.3, 'final', 'Final'), slot('Derrick Henry', 'RB', 11.6, 'live', 'Q3 9:14')]),
    winProbabilityLeft: 0.71,
    insights: { matchupEdge: 'edge', startSit: 'Start Rashid Shaheed if Nacua sits.', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' },
    partialData: false, refreshIntervalMs: 0,
  }
  it('score header, AF win prob and slot rows; no Chimmy card or league scoreboard (Sleeper pass 3)', async () => {
    const calls = stubFetch({
      '/matchup-center': { payload },
      '/scoring/matchups': { matchups: [
        { rosterId: 'r1', teamName: 'Open Team 2', totalPoints: 104.1, opponentRosterId: 'r3' },
        { rosterId: 'r3', teamName: 'Open Team 9', totalPoints: 97.6, opponentRosterId: 'r1' },
        { rosterId: 'r2', teamName: "TheCiege26's Team", totalPoints: 112.4, opponentRosterId: 'r9' },
        { rosterId: 'r9', teamName: 'Sunday Scaries', totalPoints: 98.7, opponentRosterId: 'r2' },
      ] },
    })
    const onSelectTab = vi.fn()
    render(<NativeMatchupScreen league={league} onSelectTab={onSelectTab} />)
    // The header only: the league scoreboard is the League tab's now.
    expect((await screen.findAllByText('112.4')).length).toBe(1)
    expect(screen.getByText('71%')).toBeTruthy()
    expect(screen.getByText(/proj 122.4 – 108.7/)).toBeTruthy()
    expect(screen.queryByText('Start Rashid Shaheed if Nacua sits.')).toBeNull()
    // Kyren 0.0 vs Henry 11.6 with Kyren yet to play: Henry leads (good), Kyren not yet "bad".
    expect(screen.getByText('11.6').getAttribute('data-pts')).toBe('good')
    expect(screen.getByText('0.0').getAttribute('data-pts')).toBe('neutral')
    expect(document.querySelector('.nls-board')).toBeNull()
    expect(screen.queryByRole('button', { name: 'League scoreboard' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit my lineup' }))
    expect(onSelectTab).toHaveBeenCalledWith('roster')
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('week=4'))).toBe(true))
  })
})

describe('NativeMatchupScreen before the draft', () => {
  it('offers Draft HQ instead of presenting an empty score', () => {
    const onSelectTab = vi.fn()
    render(<NativeMatchupScreen league={{ ...league, lifecycleState: 'setup' }} onSelectTab={onSelectTab} />)
    expect(screen.getByText('Your season starts with the draft')).toBeTruthy()
    expect(screen.queryByLabelText('Score')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Draft HQ' }))
    expect(onSelectTab).toHaveBeenCalledWith('draft')
  })
})

describe('NativeTradesScreen', () => {
  it('incoming offer shows THE grade and accepts through the existing route', async () => {
    const offer = {
      id: 't1', direction: 'incoming', partnerName: 'Open Team 5', timestamp: new Date().toISOString(), status: 'pending', viewerIsReceiver: true,
      sent: [{ id: 'a', label: 'Jahmyr Gibbs', sublabel: 'RB · DET', headshotUrl: null, accent: 'teal' }],
      received: [{ id: 'b', label: 'Drake London', sublabel: 'WR · ATL', headshotUrl: null, accent: 'teal' }],
      leagueGrade: { graded: true, letter: 'C+', partnerLetter: 'B-', percentDiff: -4, label: 'Even', sideAdvantage: 'even', action: 'counter', recommendation: 'Close; ask for a bench piece.', giveValue: 14, getValue: 13 },
    }
    const calls = stubFetch({ '/api/league/trades-panel': { activeTrades: [offer], historyTrades: [], tradeBlock: [{ id: 'x', playerId: 'p', name: 'Trey McBride', position: 'TE', team: 'ARI', ownerName: 'Open Team 9' }] }, '/trades/t1/accept': { ok: true } })
    render(<NativeTradesScreen league={league} teams={[]} />)
    expect(await screen.findByText('AF grade for you · C+')).toBeTruthy()
    expect(screen.getByText('Jahmyr Gibbs')).toBeTruthy()
    expect(screen.getByText('Drake London')).toBeTruthy()
    // The block is tiles: position and team, a short name, and whose block it is.
    const tile = screen.getByRole('button', { name: /Trey McBride, TE ARI, listed by Open Team 9/ })
    expect(tile.textContent).toContain('T. McBride')
    expect(tile.textContent).toContain('Open Team 9')
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }))
    expect(screen.getByTestId('builder').textContent).toBe('t1')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/trades/t1/accept') && c.init?.method === 'POST')).toBe(true))
  })

  it('opens the builder from one place: "Propose a trade", with no "Build a trade" card repeating it (2026-11-24)', async () => {
    stubFetch({ '/api/league/trades-panel': { activeTrades: [], historyTrades: [], tradeBlock: [] } })
    render(<NativeTradesScreen league={league} teams={[]} />)
    // No trades: the left column says so and offers the builder; the header button is the other way in.
    expect(await screen.findByText('No active trades yet.')).toBeTruthy()
    expect(screen.queryByText('Build a trade')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open trade builder' })).toBeNull()
    const proposes = screen.getAllByRole('button', { name: 'Propose a trade' })
    expect(proposes).toHaveLength(2)
    fireEvent.click(proposes[1]!)
    expect(screen.getByTestId('builder').textContent).toBe('new')
    expect(screen.getByText('Nobody has listed a player yet.')).toBeTruthy()
  })
})
