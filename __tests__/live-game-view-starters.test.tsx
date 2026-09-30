/**
 * The clicked-game view: your starters in the game, and the football box score.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))
vi.mock('@/components/core-app/player-card/PlayerName', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}))

import { LiveGameView } from '@/components/core-app/screens/LiveGameView'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'
import type { GameStarters } from '@/lib/live/liveScoresPage'

const team = (over: Partial<LiveGameDetail['home']>): LiveGameDetail['home'] => ({
  id: '4', abbrev: 'CIN', name: 'Cincinnati Bengals', logo: null, color: 'fb4f14', altColor: null,
  score: 30, record: '1-0', rank: null, linescores: [14, 10, 3, 3], possession: true, ...over,
})

const PASS = ['C/ATT', 'YDS', 'AVG', 'TD', 'INT']
const RUSH = ['CAR', 'YDS', 'AVG', 'TD', 'LONG']
const REC = ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS']

function detail(over: Partial<LiveGameDetail> = {}): LiveGameDetail {
  return {
    gameId: '401872925',
    sport: 'NFL',
    status: { state: 'in', detail: '5:23 - 4th', period: 4, clock: '5:23' },
    home: team({}),
    away: team({ id: '27', abbrev: 'TB', name: 'Tampa Bay Buccaneers', score: 20, color: 'bd1c36', linescores: [3, 7, 10, 0], possession: false }),
    leaders: { away: [], home: [] },
    drive: null,
    situation: null,
    lastPlay: null,
    lastPlayAthleteIds: [],
    drives: [],
    scoringPlays: [],
    teamStats: [],
    players: {
      jb: [{ group: 'passing', teamId: '4', name: 'Joe Burrow', headshot: null, jersey: '9', labels: PASS, stats: ['22/32', '205', '6.4', '1', '1'] }],
      cb: [
        { group: 'rushing', teamId: '4', name: 'Chase Brown', headshot: null, jersey: '30', labels: RUSH, stats: ['13', '52', '4.0', '1', '12'] },
        { group: 'receiving', teamId: '4', name: 'Chase Brown', headshot: null, jersey: '30', labels: REC, stats: ['5', '23', '4.6', '0', '9', '6'] },
      ],
      ww: [{ group: 'defensive', teamId: '27', name: 'Antoine Winfield Jr.', headshot: null, jersey: '31', labels: ['TOT', 'SOLO', 'SACKS'], stats: ['7', '5', '0'] }],
    },
    winProbability: null,
    venue: null,
    weather: null,
    attendance: null,
    basketball: null,
    hockey: null,
    baseball: null,
    fetchedAt: '2026-09-13T20:00:00.000Z',
    ...over,
  }
}

const tie = (leagueId: string, points: number | null) => ({
  leagueId, leagueName: `League ${leagueId}`, playerId: '9509', playerName: 'Chase Brown', position: 'RB',
  imageUrl: null, team: 'CIN', isStarter: true, points,
})

const view = (d: LiveGameDetail, starters: GameStarters | null, selectedLeagueId: string | null = null) =>
  render(
    <LiveGameView
      initial={{ detail: d, stale: false, failed: false, starters }}
      sport="NFL"
      gameId="401872925"
      backHref="/core/live?sport=NFL"
      selectedLeagueId={selectedLeagueId}
    />,
  )

describe('your starters in the game view', () => {
  const starters: GameStarters = { tieIns: [tie('L1', 14.2), tie('L2', 11.8)], hasRosterData: true, rosterFailed: false }

  it('lists your starter with his points across leagues and his live box line', () => {
    view(detail(), starters)
    const panel = screen.getByRole('region', { name: 'Your starters in this game' })
    expect(within(panel).getByText(/Your starters · 1 player · 2 leagues/)).toBeInTheDocument()
    expect(within(panel).getByText('11.8–14.2 pts')).toBeInTheDocument()
    // RB: rushing first, then receiving — straight from the box score.
    const statLine = panel.querySelector('.af-gv-mine-line')!
    expect(statLine.textContent).toMatch(/CAR 13.*YDS 52.*TD 1.*REC 5/)
  })

  it('with a league held, shows that league\'s number', () => {
    view(detail(), starters, 'L1')
    expect(screen.getByText('14.2 pts')).toBeInTheDocument()
  })

  it('shows no stat line before kickoff — there is no line yet', () => {
    view(detail({ status: { state: 'pre', detail: 'Sun 1:00 PM', period: 0, clock: null } }), starters)
    expect(document.querySelector('.af-gv-mine-line')).toBeNull()
  })

  it('has no panel at all when signed out', () => {
    view(detail(), null)
    expect(screen.queryByText(/Your starters/)).toBeNull()
  })

  it('says the roster read failed rather than "none of your starters"', () => {
    view(detail(), { tieIns: [], hasRosterData: false, rosterFailed: true })
    expect(screen.getByText(/could not read your rosters/)).toBeInTheDocument()
    expect(screen.queryByText(/None of your starters/)).toBeNull()
  })

  it('says plainly when none of your starters are in this game', () => {
    view(detail(), { tieIns: [], hasRosterData: true, rosterFailed: false })
    expect(screen.getByText('None of your starters are playing in this game.')).toBeInTheDocument()
  })
})

describe('football box score', () => {
  it('renders both teams\' groups with ESPN\'s columns and marks your starter', () => {
    view(detail(), { tieIns: [tie('L1', 14.2)], hasRosterData: true, rosterFailed: false })
    const box = screen.getByRole('region', { name: 'Box score' })
    expect(within(box).getByRole('columnheader', { name: 'Rushing' })).toBeInTheDocument()
    // ESPN's own columns, including ones a hardcoded shortlist would drop. LONG
    // is in both the rushing and receiving tables.
    expect(within(box).getAllByRole('columnheader', { name: 'LONG' })).toHaveLength(2)
    expect(within(box).getByRole('columnheader', { name: 'TGTS' })).toBeInTheDocument()
    const brown = within(box).getAllByRole('row').find((r) => r.textContent?.includes('Chase Brown'))!
    expect(brown).toHaveAttribute('data-mine', 'true')
    expect(brown.textContent).toContain('· yours')
    const burrow = within(box).getAllByRole('row').find((r) => r.textContent?.includes('Joe Burrow'))!
    expect(burrow).not.toHaveAttribute('data-mine')
  })

  it('keeps defense behind a disclosure', () => {
    view(detail(), null)
    const more = screen.getByText('Defense, returns & punting')
    const details = more.closest('details')!
    expect(details.open).toBe(false)
    fireEvent.click(more)
    expect(within(details).getByText('Antoine Winfield Jr.')).toBeInTheDocument()
  })

  it('is absent for a sport that has its own box score', () => {
    view(detail({ players: { x: [{ group: 'basketball', teamId: '4', name: 'A', headshot: null, jersey: null, labels: ['PTS'], stats: ['9'] }] } }), null)
    expect(screen.queryByRole('region', { name: 'Box score' })).toBeNull()
  })
})
