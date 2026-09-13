/**
 * MLB game card: diamond with runners, balls/strikes/outs, pitcher and batter,
 * and an R-H-E box score. Fixture values from the live MLB scoreboard,
 * 2026-09-13, COL @ DET "Bot 7th".
 */
import React from 'react'
import { render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveScores } from '@/components/core-app/screens/LiveScores'
import type { LiveGameCard, LivePageData } from '@/lib/live/liveScoresPage'

function mlbGame(over: Partial<LiveGameCard> = {}): LiveGameCard {
  return {
    gameId: '501',
    sport: 'MLB',
    week: null,
    status: 'STATUS_IN_PROGRESS',
    statusDetail: 'Bot 7th',
    clockLabel: 'Bot 7th',
    isLive: true,
    completed: false,
    startTime: '2026-09-13T17:10:00Z',
    away: { abbrev: 'COL', name: 'Colorado Rockies', logo: '', score: 1, record: null, linescores: [1, 0, 0, 0, 0, 0, 0], hits: 4, errors: 0 },
    home: { abbrev: 'DET', name: 'Detroit Tigers', logo: '', score: 8, record: null, linescores: [2, 3, 0, 2, 1, 0, 0], hits: 8, errors: 0 },
    winProbability: null,
    topPerformer: null,
    leaders: [],
    situation: {
      downDistance: null,
      shortDownDistance: null,
      distance: null,
      ballOn: null,
      possession: null,
      isRedZone: false,
      homeTimeouts: null,
      awayTimeouts: null,
      lastPlay: 'Jimmy Herget pitches to Zach McKinstry',
      lastPlayType: 'Start Batter/Pitcher',
      baseball: {
        onFirst: true,
        onSecond: true,
        onThird: false,
        balls: 0,
        strikes: 0,
        outs: 2,
        batter: { name: 'Zach McKinstry', headshot: null, position: 'RF', summary: '0-1, 2 R, 2 BB, K', teamId: '6' },
        pitcher: { name: 'Jimmy Herget', headshot: null, position: null, summary: '1.2 IP, 0 ER, H, K, BB', teamId: '27' },
      },
    },
    venue: { name: 'Comerica Park', location: 'Detroit, Michigan' },
    broadcast: null,
    tieIns: [],
    leaguesAffected: 0,
    ...over,
  } as LiveGameCard
}

const page = (g: LiveGameCard): LivePageData => ({
  sport: g.sport,
  scope: 'all',
  counts: [{ sport: g.sport, label: g.sport, slateCount: 1 }],
  games: [g],
  impact: { totalPoints: 0, livePlayers: 0, liveGames: 1, biggestMover: null, plays: [], upNext: [] },
  fetchedAt: new Date().toISOString(),
  hasRosterData: false,
  loadFailed: false,
  rosterFailed: false,
})

describe('MLB diamond', () => {
  it('lights exactly the occupied bases', () => {
    const { container } = render(<LiveScores data={page(mlbGame())} />)
    const base = (k: string) => container.querySelector(`.af-live-base[data-base="${k}"]`) as Element
    expect(base('first').getAttribute('data-on')).toBe('true')
    expect(base('second').getAttribute('data-on')).toBe('true')
    expect(base('third').getAttribute('data-on')).toBe('false')
    expect(container.querySelector('.af-live-diamond')?.getAttribute('aria-label')).toBe(
      'Runners on first and second, 0-0 count, 2 outs',
    )
  })

  it('shows the count as lit dots: 0 balls, 0 strikes, 2 outs', () => {
    const { container } = render(<LiveScores data={page(mlbGame())} />)
    const lit = (label: string) =>
      container.querySelectorAll(`.af-live-count-row[data-count="${label}"] .af-live-count-dot[data-on="true"]`).length
    expect(lit('B')).toBe(0)
    expect(lit('S')).toBe(0)
    expect(lit('O')).toBe(2)
  })

  it('names the pitcher and the batter with their lines', () => {
    const { container } = render(<LiveScores data={page(mlbGame())} />)
    // Scoped to the at-bat list: the mocked headshot also prints the name.
    const atBat = within(container.querySelector('.af-live-atbat') as HTMLElement)
    const rows = container.querySelectorAll('.af-live-atbat-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0] as HTMLElement).getByText('Pitching')).toBeInTheDocument()
    expect(atBat.getByText('1.2 IP, 0 ER, H, K, BB')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('At bat')).toBeInTheDocument()
    expect(atBat.getByText('0-1, 2 R, 2 BB, K')).toBeInTheDocument()
    expect((container.querySelector('.af-live-atbat-row:first-child .af-live-atbat-name') as HTMLElement).textContent).toBe(
      'Jimmy Herget',
    )
    expect((container.querySelector('.af-live-atbat-row:last-child .af-live-atbat-name') as HTMLElement).textContent).toBe(
      'Zach McKinstry RF',
    )
  })

  it('draws an R-H-E box over nine innings, and no football field', () => {
    const { container } = render(<LiveScores data={page(mlbGame())} />)
    const heads = [...container.querySelectorAll('.af-live-linescore thead th')].map((th) => th.textContent)
    expect(heads.slice(-3)).toEqual(['R', 'H', 'E'])
    expect(heads).toContain('9')
    const detRow = [...container.querySelectorAll('.af-live-linescore tbody tr')][1] as HTMLElement
    const cells = [...detRow.querySelectorAll('td')].map((td) => td.textContent)
    expect(cells.slice(-3)).toEqual(['8', '8', '0'])
    expect(container.querySelector('.af-live-field')).toBeNull()
  })

  it('control: an MLB game with no baseball situation draws no diamond', () => {
    const g = mlbGame()
    const { container } = render(<LiveScores data={page({ ...g, situation: null })} />)
    expect(container.querySelector('.af-live-diamond')).toBeNull()
  })
})

/*
 * The diamond is keyed on the DATA, not on `sport === 'MLB'` (2026-09-13), so a
 * baseball feed the app has not added as a sport yet — college baseball is the
 * one waiting — gets it with no card change. `NCAABASE` is a stand-in sport
 * string: no such LeagueSport exists today, which is exactly the case covered.
 */
describe('baseball presentation for a non-MLB sport', () => {
  it('draws the diamond and the R-H-E box when the feed sends baseball data', () => {
    const g = mlbGame({ sport: 'NCAABASE', statusDetail: 'Top 3rd', clockLabel: 'Top 3rd' })
    const { container } = render(<LiveScores data={page(g)} />)
    expect(container.querySelector('.af-live-diamond')).not.toBeNull()
    expect(container.querySelector('.af-live-base[data-base="first"]')?.getAttribute('data-on')).toBe('true')
    const heads = [...container.querySelectorAll('.af-live-linescore thead th')].map((th) => th.textContent)
    expect(heads.slice(-3)).toEqual(['R', 'H', 'E'])
  })

  it('a final with hits and errors but no live situation still gets R-H-E, and no diamond', () => {
    const g = mlbGame({ sport: 'NCAABASE', isLive: false, completed: true, situation: null })
    const { container } = render(<LiveScores data={page(g)} />)
    expect(container.querySelector('.af-live-diamond')).toBeNull()
    const heads = [...container.querySelectorAll('.af-live-linescore thead th')].map((th) => th.textContent)
    expect(heads.slice(-3)).toEqual(['R', 'H', 'E'])
  })

  it('control: a football card with no baseball data gets a T column and no diamond', () => {
    const g = mlbGame({
      sport: 'NFL',
      situation: null,
      away: { abbrev: 'TB', name: 'Tampa Bay Buccaneers', logo: '', score: 3, record: null, linescores: [3, 0], hits: null, errors: null },
      home: { abbrev: 'CIN', name: 'Cincinnati Bengals', logo: '', score: 14, record: null, linescores: [14, 0], hits: null, errors: null },
    })
    const { container } = render(<LiveScores data={page(g)} />)
    expect(container.querySelector('.af-live-diamond')).toBeNull()
    const heads = [...container.querySelectorAll('.af-live-linescore thead th')].map((th) => th.textContent)
    expect(heads[heads.length - 1]).toBe('T')
    expect(heads).not.toContain('H')
  })
})
