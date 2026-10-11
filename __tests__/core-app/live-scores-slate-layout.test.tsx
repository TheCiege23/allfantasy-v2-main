vi.mock('next/navigation', () => ({ usePathname: () => '/core/live', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }) }))
/**
 * /core/live layout, 2026-10-11 audit: "am I winning" first, live games before finals, finals one line
 * each, and starter lists capped so the games are not buried under them.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveScores } from '@/components/core-app/screens/LiveScores'
import type { LiveGameCard, LivePageData, LiveRosterTieIn } from '@/lib/live/liveScoresPage'
import type { RailMatchup } from '@/lib/core-app/railMatchups'

const tie = (over: Partial<LiveRosterTieIn>): LiveRosterTieIn => ({
  leagueId: 'L1',
  leagueName: 'Alpha League',
  playerId: 'p1',
  playerName: 'Player One',
  position: 'RB',
  imageUrl: null,
  isStarter: true,
  points: 8.4,
  ...over,
})

function game(id: string, over: Partial<LiveGameCard> = {}): LiveGameCard {
  return {
    gameId: id,
    sport: 'NFL',
    week: 5,
    status: 'STATUS_IN_PROGRESS',
    statusDetail: 'Q2',
    clockLabel: 'Q2 · 4:50',
    isLive: true,
    completed: false,
    startTime: '2026-10-11T17:00:00Z',
    away: { abbrev: `A${id}`, name: `Away ${id}`, logo: '', score: 7, record: null, linescores: [7] },
    home: { abbrev: `H${id}`, name: `Home ${id}`, logo: '', score: 21, record: null, linescores: [21] },
    winProbability: null,
    topPerformer: null,
    leaders: [],
    situation: null,
    venue: null,
    broadcast: null,
    tieIns: [tie({ playerId: `${id}-p1`, playerName: `Starter ${id}` })],
    leaguesAffected: 1,
    ...over,
  }
}

const final = (id: string, over: Partial<LiveGameCard> = {}) =>
  game(id, { isLive: false, completed: true, status: 'STATUS_FINAL', statusDetail: 'Final', clockLabel: null, ...over })

function page(games: LiveGameCard[]): LivePageData {
  return {
    sport: 'NFL',
    scope: 'my',
    counts: [{ sport: 'NFL', label: 'NFL', slateCount: games.length }],
    games,
    impact: { totalPoints: 0, livePlayers: 0, liveGames: 0, biggestMover: null, plays: [], upNext: [] },
    fetchedAt: new Date().toISOString(),
    hasRosterData: true,
    loadFailed: false,
    rosterFailed: false,
  }
}

function rail(over: Partial<RailMatchup>): RailMatchup {
  return {
    leagueId: 'L1',
    yourTeam: 'Me',
    yourAvatarUrl: null,
    yourScore: 80,
    yourProjection: null,
    opponentTeam: 'Them',
    opponentAvatarUrl: null,
    opponentScore: 90,
    opponentProjection: null,
    unpaired: false,
    standing: null,
    scored: true,
    freshAt: null,
    source: 'live_cache',
    season: 2026,
    week: 5,
    ...over,
  }
}

describe('finals sit under live games, one line each', () => {
  it('live first even when the server sent the final first, and the final is a one-line row', () => {
    const { container } = render(<LiveScores data={page([final('1'), game('2')])} />)
    const cards = container.querySelectorAll('.af-live-slate > .af-live-game')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.textContent).toContain('A2')
    const row = container.querySelector('.af-live-final') as HTMLElement
    expect(row.textContent).toContain('A1')
    expect(row.textContent).toContain('1 starter · top Starter 1 8.4')
    expect(row.querySelector('.af-live-game')).toBeNull()
  })

  it('opens the full card on tap', () => {
    const { container } = render(<LiveScores data={page([final('1')])} />)
    const toggle = container.querySelector('.af-live-final-toggle') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.af-live-final .af-live-game')).not.toBeNull()
  })

  it('control: a slate with no finals draws no Final section', () => {
    const { container } = render(<LiveScores data={page([game('1')])} />)
    expect(container.querySelector('.af-live-finals')).toBeNull()
  })
})

describe('starter lists are capped on the slate', () => {
  const many = game('9', {
    tieIns: Array.from({ length: 5 }, (_, i) => tie({ playerId: `p${i}`, playerName: `Starter ${i}` })),
  })

  it('shows three, then all on request', () => {
    const { container } = render(<LiveScores data={page([many])} />)
    expect(container.querySelectorAll('.af-live-mine-row')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5 starters' }))
    expect(container.querySelectorAll('.af-live-mine-row')).toHaveLength(5)
  })

  it('control: three or fewer starters draw no "Show all"', () => {
    render(<LiveScores data={page([game('1')])} />)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })
})

describe('your matchups strip', () => {
  const leagues = [
    { id: 'L1', name: 'Alpha League', sport: 'NFL' },
    { id: 'L2', name: 'Bravo League', sport: 'NFL' },
  ]
  const byLeague = {
    L1: rail({ leagueId: 'L1', yourScore: 80, opponentScore: 90 }),
    L2: rail({ leagueId: 'L2', yourScore: 130, opponentScore: 60 }),
  }

  it('leads the cross-league view with ahead / behind and the league to look at', () => {
    const { container } = render(<LiveScores data={page([game('1')])} leagueWeek={{ byLeague, leagues }} />)
    const strip = container.querySelector('.af-live-glance') as HTMLElement
    expect(strip.textContent).toContain('1 ahead')
    expect(strip.textContent).toContain('1 behind')
    const rows = strip.querySelectorAll('.af-live-glance-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('Alpha League')
    expect(rows[0]!.querySelector('a')!.getAttribute('href')).toBe('/core/live?league=L1')
  })

  it('control: no strip when the rail read failed', () => {
    const { container } = render(<LiveScores data={page([game('1')])} leagueWeek={{ byLeague: null, leagues }} />)
    expect(container.querySelector('.af-live-glance')).toBeNull()
  })

  it('a held elimination league shows your place against the cut, not "no single opponent"', () => {
    const elim = rail({
      leagueId: 'L1',
      unpaired: true,
      standing: { rank: 8, outOf: 14, overCut: 43.2, basis: 'points', placesAboveCut: 6, cutLine: 83.5, elimination: true },
    })
    const { container } = render(
      <LiveScores
        data={page([game('1')])}
        selectedLeagueId="L1"
        matchupStrip={{ kind: 'unavailable', reason: 'a guillotine league is scored against the whole field each week, so there is no single opponent' }}
        leagueWeek={{ byLeague: { L1: elim }, leagues }}
      />,
    )
    expect(container.querySelector('.af-live-glance')).toBeNull()
    const strip = container.querySelector('.af-live-matchup') as HTMLElement
    expect(strip.getAttribute('data-state')).toBe('standing')
    expect(strip.textContent).toContain('8th')
    expect(strip.textContent).toContain('+43.2 over the cut')
    expect(strip.textContent).toContain('6 places clear of the cut')
    expect(strip.textContent).not.toContain('no single opponent')
  })
})

describe('your live impact — starters in action, not points summed across leagues', () => {
  it('leads with starters playing now, then what is still to play and what is done', () => {
    const shared = tie({ playerId: 'same', playerName: 'Same Guy', leagueId: 'L2', leagueName: 'Bravo League', points: 30 })
    const live = game('1', { tieIns: [tie({ playerId: 'same', playerName: 'Same Guy', points: 20 }), shared, tie({ playerId: 'x', playerName: 'Other' })] })
    const later = game('2', { isLive: false, completed: false, clockLabel: null, tieIns: [tie({ playerId: 'y', playerName: 'Later' })] })
    const { container } = render(<LiveScores data={page([live, later, final('3')])} />)
    const panel = container.querySelector('.af-live-impact') as HTMLElement
    // 'same' starts in two leagues and counts once; 'x' is the other live starter.
    expect(panel.querySelector('.af-live-impact-total')!.textContent).toBe('2starters playing now')
    expect(panel.querySelector('.af-live-impact-sub')!.textContent).toBe('across 1 game · 1 still to play · 1 done')
    // The old headline summed 20 + 30 + 8.4 across leagues; that number must not lead the panel.
    expect(panel.textContent).not.toContain('58.4')
    expect(panel.textContent).not.toMatch(/fantasy pts scored/)
  })

  it('names the play card for what it is', () => {
    const data = page([game('1', { tieIns: [tie({ playerId: 'p1', playerName: 'Player One' })] })])
    data.impact.plays = [
      {
        id: 'pbp:1',
        gameId: 'rig-1',
        canonicalGameId: '1',
        type: 'TOUCHDOWN',
        playerName: 'Player One',
        sleeperId: 'p1',
        team: null,
        teamLogoUrl: null,
        imageUrl: null,
        position: 'RB',
        headline: 'Player One 3-yard rushing TD',
        action: '3-yard rushing TD',
        yards: 3,
        detectedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      },
    ]
    render(<LiveScores data={data} />)
    expect(screen.getByRole('heading', { name: /^Latest for you/ })).toBeInTheDocument()
    expect(screen.queryByText(/Biggest mover/)).toBeNull()
    expect(screen.getByText('4 min ago')).toBeInTheDocument()
  })
})

describe('before kickoff a starter shows his projection, not 0.0', () => {
  const upcoming = (tieIns: LiveRosterTieIn[]) =>
    game('7', { isLive: false, completed: false, clockLabel: null, statusDetail: '10/11 - 8:20 PM EDT', tieIns })

  it('a range across leagues, muted and labelled proj', () => {
    const { container } = render(
      <LiveScores
        data={page([
          upcoming([
            tie({ playerId: 'b', playerName: 'Bijan', points: 0, projected: 18.4 }),
            tie({ playerId: 'b', playerName: 'Bijan', leagueId: 'L2', leagueName: 'Bravo League', points: 0, projected: 15.2 }),
          ]),
        ])}
      />,
    )
    const pts = container.querySelector('.af-live-mine-pts') as HTMLElement
    expect(pts.textContent).toBe('proj 15.2–18.4')
    expect(pts.getAttribute('data-kind')).toBe('projection')
    expect(container.textContent).not.toContain('0.0 pts')
  })

  it('a ruled-out starter says out, and an unpriced one a dash', () => {
    const { container } = render(
      <LiveScores
        data={page([
          upcoming([
            tie({ playerId: 'o', playerName: 'Out Guy', points: 0, projected: 0, projectedOut: true }),
            tie({ playerId: 'u', playerName: 'Unpriced', points: 0, projected: null }),
          ]),
        ])}
      />,
    )
    const values = [...container.querySelectorAll('.af-live-mine-pts')].map((el) => el.textContent)
    expect(values.sort()).toEqual(['out', '—'])
  })

  it('control: a live game still shows points, never a projection', () => {
    const { container } = render(<LiveScores data={page([game('1', { tieIns: [tie({ points: 8.4, projected: 20 })] })])} />)
    const pts = container.querySelector('.af-live-mine-pts') as HTMLElement
    expect(pts.textContent).toBe('8.4 pts')
    expect(pts.getAttribute('data-kind')).toBeNull()
  })
})
