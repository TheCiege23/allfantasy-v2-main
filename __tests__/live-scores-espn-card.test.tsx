/**
 * /core/live game card — the 2026-09-13 redesign, pinned as behaviour.
 *
 * Two user requirements, each with the control that makes it falsifiable:
 *
 *   1. "All games" is the game alone — ESPN-style leaders, field, last play,
 *      venue — with NO fantasy player list.
 *   2. "My games" lists your STARTERS, one row per player, with the leagues he
 *      starts in behind a disclosure. Bench is not listed.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveScores } from '@/components/core-app/screens/LiveScores'
import type { LiveGameCard, LivePageData, LiveRosterTieIn } from '@/lib/live/liveScoresPage'

const tie = (over: Partial<LiveRosterTieIn>): LiveRosterTieIn => ({
  leagueId: 'L1',
  leagueName: 'Alpha League',
  playerId: 'p1',
  playerName: 'Bucky Irving',
  position: 'RB',
  imageUrl: null,
  isStarter: true,
  points: 8.4,
  ...over,
})

function game(over: Partial<LiveGameCard> = {}): LiveGameCard {
  return {
    gameId: '401',
    sport: 'NFL',
    week: 1,
    status: 'STATUS_IN_PROGRESS',
    statusDetail: '12:46 - 2nd',
    clockLabel: 'Q2 · 12:46',
    isLive: true,
    completed: false,
    startTime: '2026-09-13T17:00:00Z',
    away: { abbrev: 'TB', name: 'Tampa Bay Buccaneers', logo: '', score: 3, record: '0-0', linescores: [3, 0] },
    home: { abbrev: 'CIN', name: 'Cincinnati Bengals', logo: '', score: 14, record: '0-0', linescores: [14, 0] },
    winProbability: null,
    topPerformer: null,
    leaders: [
      { label: 'PASS', name: 'Baker Mayfield', statLine: '9/12, 73 YDS', position: 'QB', headshot: null, teamAbbrev: 'TB' },
      { label: 'RUSH', name: 'Bucky Irving', statLine: '4 CAR, 21 YDS', position: 'RB', headshot: null, teamAbbrev: 'TB' },
    ],
    situation: {
      downDistance: '1st & 5 at CIN 12',
      shortDownDistance: '1st & 5',
      distance: 5,
      ballOn: 88,
      possession: 'away',
      isRedZone: true,
      homeTimeouts: 3,
      awayTimeouts: 2,
      lastPlay: 'B.Irving left tackle to CIN 12 for 5 yards',
      lastPlayType: 'Rush',
    },
    venue: { name: 'Paycor Stadium', location: 'Cincinnati, OH' },
    broadcast: 'FOX',
    tieIns: [
      tie({}),
      tie({ leagueId: 'L2', leagueName: 'Bravo League', points: 11.1 }),
      tie({ leagueId: 'L3', leagueName: 'Bench League', isStarter: false, points: 20 }),
    ],
    leaguesAffected: 2,
    ...over,
  }
}

function page(scope: 'my' | 'all', g = game()): LivePageData {
  return {
    sport: 'NFL',
    scope,
    counts: [{ sport: 'NFL', label: 'NFL', slateCount: 1 }],
    games: [g],
    impact: { totalPoints: 0, livePlayers: 0, liveGames: 1, biggestMover: null, plays: [], upNext: [] },
    fetchedAt: new Date().toISOString(),
    hasRosterData: true,
    loadFailed: false,
    rosterFailed: false,
  }
}

describe('All games — the game, not the fantasy list', () => {
  it('renders leaders, down and distance, last play and venue', () => {
    const { container } = render(<LiveScores data={page('all')} />)
    const card = container.querySelector('article.af-live-game') as HTMLElement

    expect(within(card).getByText('PASS')).toBeInTheDocument()
    expect(within(card).getByText('9/12, 73 YDS')).toBeInTheDocument()
    expect(within(card).getByText('1st & 5 at CIN 12')).toBeInTheDocument()
    expect(within(card).getByText(/left tackle to CIN 12/)).toBeInTheDocument()
    expect(within(card).getByText('Paycor Stadium')).toBeInTheDocument()
    expect(within(card).getByText('FOX')).toBeInTheDocument()
  })

  it('places the ball on the home half (CIN 12 = 88 from the TB goal line)', () => {
    const { container } = render(<LiveScores data={page('all')} />)
    const ball = container.querySelector('.af-live-ball') as HTMLElement
    expect(ball.style.left).toBe('88%')
    expect(ball.dataset.dir).toBe('right')
  })

  it('shows NO player list, even though the game has tie-ins', () => {
    const { container } = render(<LiveScores data={page('all')} />)
    expect(container.querySelector('.af-live-tieins')).toBeNull()
    expect(screen.queryByText(/Your starters/)).toBeNull()
  })
})

describe('My games — starters, one row per player, leagues behind a disclosure', () => {
  it('lists the player once, not once per league, and excludes the bench league', () => {
    const { container } = render(<LiveScores data={page('my')} />)
    const rows = container.querySelectorAll('.af-live-mine-row')
    expect(rows).toHaveLength(1)
    expect(within(rows[0] as HTMLElement).getByText('2 leagues')).toBeInTheDocument()
    // Range across the two STARTING leagues; the bench league's 20.0 is not in it.
    expect(within(rows[0] as HTMLElement).getByText('8.4–11.1 pts')).toBeInTheDocument()
    expect(screen.queryByText('Bench League')).toBeNull()
  })

  it('reveals the leagues only when the row is opened', () => {
    const { container } = render(<LiveScores data={page('my')} />)
    const toggle = container.querySelector('.af-live-mine-toggle') as HTMLButtonElement

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Alpha League')).toBeNull()

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Alpha League')).toBeInTheDocument()
    expect(screen.getByText('Bravo League')).toBeInTheDocument()
    expect(screen.queryByText('Bench League')).toBeNull()
  })

  it('the whole starter list collapses behind its heading, and starts open', () => {
    const { container } = render(<LiveScores data={page('my')} />)
    const head = container.querySelector('.af-live-tieins-toggle') as HTMLButtonElement
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('.af-live-mine-row')).toHaveLength(1)

    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('.af-live-mine-row')).toHaveLength(0)
    // The heading stays, so it can be opened again.
    expect(screen.getByText(/Your starters · 1 player · 2 leagues/)).toBeInTheDocument()

    fireEvent.click(head)
    expect(container.querySelectorAll('.af-live-mine-row')).toHaveLength(1)
  })

  it('the player name is its own player-card button, separate from the leagues toggle', () => {
    const { container } = render(<LiveScores data={page('my')} />)
    const row = container.querySelector('.af-live-mine-row') as HTMLElement
    const name = within(row).getByRole('button', { name: 'Bucky Irving' })
    expect(name.className).toContain('af-pc-trigger')
    // Not nested inside the toggle, and clicking it does not open the leagues.
    expect(name.closest('.af-live-mine-toggle')).toBeNull()
    fireEvent.click(name)
    expect((row.querySelector('.af-live-mine-toggle') as HTMLElement).getAttribute('aria-expanded')).toBe('false')
  })

  it('with a league in hand, the row shows THAT league\'s points, not the range', () => {
    const { container } = render(<LiveScores data={page('my')} selectedLeagueId="L2" />)
    const row = container.querySelector('.af-live-mine-row') as HTMLElement
    expect(row.getAttribute('data-selected')).toBe('true')
    const pts = row.querySelector('.af-live-mine-pts') as HTMLElement
    expect(pts.textContent).toBe('11.1 pts')
    expect(pts.getAttribute('title')).toBe('Points in Bravo League')
  })

  it('control: a league you do not start him in keeps the cross-league range', () => {
    const { container } = render(<LiveScores data={page('my')} selectedLeagueId="L3" />)
    const row = container.querySelector('.af-live-mine-row') as HTMLElement
    expect((row.querySelector('.af-live-mine-pts') as HTMLElement).textContent).toBe('8.4–11.1 pts')
  })

  it('control: a game whose only tie-in is a bench player shows no starter list', () => {
    const g = game({ tieIns: [tie({ isStarter: false })] })
    const { container } = render(<LiveScores data={page('my', g)} />)
    expect(container.querySelector('.af-live-tieins')).toBeNull()
  })
})

describe('Live plays — who, what kind of play, how far', () => {
  it('renders the name as a player-card button, then the play with its yardage and passer', () => {
    const data = page('all')
    data.impact.plays = [
      {
        id: 'pbp:1:77:BIG_PLAY',
        gameId: '1',
        type: 'BIG_PLAY',
        playerName: 'Marvin Harrison Jr.',
        sleeperId: '11632',
        team: 'ARI',
        teamLogoUrl: null,
        imageUrl: null,
        position: 'WR',
        headline: 'Marvin Harrison Jr. (WR) 33-yard catch from Kyler Murray',
        action: '33-yard catch from Kyler Murray',
        yards: 33,
        detectedAt: '2026-09-13T18:00:00Z',
      },
    ]
    const { container } = render(<LiveScores data={data} />)
    const row = container.querySelector('.af-live-play') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Marvin Harrison Jr.' })).toBeInTheDocument()
    expect(row.querySelector('.af-live-play-line')!.textContent).toBe('Marvin Harrison Jr. (WR) 33-yard catch from Kyler Murray')
  })
})

describe('pre-game card omits live-only blocks rather than drawing placeholders', () => {
  it('no field, no leaders, no line score before kickoff', () => {
    const g = game({
      isLive: false,
      statusDetail: '9/13 - 4:25 PM EDT',
      clockLabel: null,
      situation: null,
      leaders: [],
      away: { abbrev: 'WAS', name: 'Washington Commanders', logo: '', score: null, record: '0-0', linescores: [] },
      home: { abbrev: 'PHI', name: 'Philadelphia Eagles', logo: '', score: null, record: '0-0', linescores: [] },
    })
    const { container } = render(<LiveScores data={page('all', g)} />)
    expect(container.querySelector('.af-live-field')).toBeNull()
    expect(container.querySelector('.af-live-leaders')).toBeNull()
    expect(container.querySelector('.af-live-linescore')).toBeNull()
    expect(screen.queryByText(/not estimated before kickoff/)).toBeNull()
  })
})
