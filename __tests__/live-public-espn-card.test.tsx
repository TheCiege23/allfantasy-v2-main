/**
 * Public `/live` renders the same ESPN-style game card as `/core/live`.
 *
 * Same two requirements as `live-scores-espn-card.test.tsx`, on the other surface:
 * "All games" is the game alone; "My games" adds your starters, once per player.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveScoresClient } from '@/components/live/LiveScoresClient'
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

const game: LiveGameCard = {
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
  tieIns: [tie({}), tie({ leagueId: 'L2', leagueName: 'Bravo League', points: 11.1 })],
  leaguesAffected: 2,
}

const page = (scope: 'my' | 'all'): LivePageData => ({
  sport: 'NFL',
  scope,
  counts: [{ sport: 'NFL', label: 'NFL', slateCount: 1 }],
  games: [game],
  impact: { totalPoints: 0, livePlayers: 0, liveGames: 1, biggestMover: null, plays: [], upNext: [] },
  fetchedAt: new Date().toISOString(),
  hasRosterData: true,
  loadFailed: false,
  rosterFailed: false,
})

describe('/live — the ESPN-style card', () => {
  it('All games: leaders, field, last play, venue — and no player list', () => {
    const { container } = render(<LiveScoresClient initial={page('all')} />)

    // The core card, inside the token scope it needs.
    expect(container.querySelector('.af-core.live-card-scope article.af-live-game')).not.toBeNull()
    expect(screen.getByText('9/12, 73 YDS')).toBeInTheDocument()
    expect(screen.getByText('1st & 5 at CIN 12')).toBeInTheDocument()
    expect(screen.getByText(/left tackle to CIN 12/)).toBeInTheDocument()
    expect(screen.getByText('Paycor Stadium')).toBeInTheDocument()
    expect((container.querySelector('.af-live-ball') as HTMLElement).style.left).toBe('88%')

    expect(container.querySelector('.af-live-tieins')).toBeNull()
    expect(screen.queryByText(/Rostered in/)).toBeNull()
  })

  it('My games: one starter row per player, leagues behind the disclosure', () => {
    const { container } = render(<LiveScoresClient initial={page('my')} />)
    const rows = container.querySelectorAll('.af-live-mine-row')
    expect(rows).toHaveLength(1)
    expect(screen.queryByText('Alpha League')).toBeNull()

    fireEvent.click(container.querySelector('.af-live-mine-toggle') as HTMLButtonElement)

    expect(screen.getByText('Alpha League')).toBeInTheDocument()
    expect(screen.getByText('Bravo League')).toBeInTheDocument()
  })
})
