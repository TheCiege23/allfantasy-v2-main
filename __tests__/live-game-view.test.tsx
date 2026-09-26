/**
 * The clicked-game view renders what the trimmed summary carries, and the score
 * card links to it only when it can load.
 */
import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveGameView, lineForPlay, statCells } from '@/components/core-app/screens/LiveGameView'
import type { GameDetailPlayerLine, LiveGameDetail } from '@/lib/live/espnGameSummary'

const team = (over: Partial<LiveGameDetail['home']>): LiveGameDetail['home'] => ({
  id: '4',
  abbrev: 'CIN',
  name: 'Cincinnati Bengals',
  logo: null,
  color: 'fb4f14',
  altColor: null,
  score: 30,
  record: '1-0',
  rank: null,
  linescores: [14, 10, 3, 3],
  possession: true,
  ...over,
})

const play = (over: Partial<LiveGameDetail['drives'][number]['plays'][number]>) => ({
  id: 'p',
  text: '',
  type: null,
  typeAbbrev: null,
  period: 4,
  clock: '5:23',
  downDistance: null,
  startBallOn: null,
  endBallOn: null,
  statYardage: null,
  yardsAfterCatch: null,
  scoring: false,
  awayScore: null,
  homeScore: null,
  ...over,
})

function detail(over: Partial<LiveGameDetail> = {}): LiveGameDetail {
  const lastPlay = play({
    id: 'p9',
    text: '(Shotgun) J.Burrow pass short left to C.Brown to TB 8 for 4 yards (K.Scott).',
    type: 'Pass Reception',
    statYardage: 4,
    downDistance: '3rd & 5 at TB 12',
  })
  const drive = {
    id: 'd9',
    teamId: '4',
    teamAbbrev: 'CIN',
    teamLogo: null,
    description: '7 plays, 36 yards, 4:22',
    result: null,
    isScore: false,
    isCurrent: true,
    startBallOn: 56,
    startText: 'TB 44',
    endBallOn: 8,
    endText: 'TB 8',
    plays: [play({ id: 'p8', text: 'C.Brown up the middle for 5 yards', type: 'Rush' }), lastPlay],
  }
  return {
    gameId: '401872925',
    sport: 'NFL',
    status: { state: 'in', detail: '5:23 - 4th', period: 4, clock: '5:23' },
    home: team({}),
    away: team({ id: '27', abbrev: 'TB', name: 'Tampa Bay Buccaneers', score: 20, color: 'bd1c36', linescores: [3, 7, 10, 0], possession: false }),
    leaders: {
      away: [{ category: 'passingYards', label: 'Passing Yards', athleteId: 'bm', name: 'Baker Mayfield', shortName: 'B. Mayfield', position: 'QB', headshot: null, mainValue: '177', mainLabel: 'YDS', summary: '19/23' }],
      home: [{ category: 'passingYards', label: 'Passing Yards', athleteId: 'jb', name: 'Joe Burrow', shortName: 'J. Burrow', position: 'QB', headshot: null, mainValue: '205', mainLabel: 'YDS', summary: '22/32, 1 TD, 1 INT' }],
    },
    drive,
    situation: { downDistance: '4th & 1 at TB 8', shortDownDistance: '4th & 1', possessionText: 'TB 8', ballOn: 8, distance: 1, offense: 'home' },
    lastPlay,
    lastPlayAthleteIds: ['jb', 'cb'],
    drives: [
      { ...drive, id: 'd1', isCurrent: false, result: 'Field Goal', description: '11 plays, 56 yards, 5:51', teamId: '27', plays: [play({ id: 'k1', text: 'C.McLaughlin 34 yard field goal is GOOD', scoring: true })] },
      drive,
    ],
    scoringPlays: [
      { id: 's1', period: 1, clock: '9:09', text: 'Chase McLaughlin 34 Yd Field Goal', type: 'Field Goal', teamAbbrev: 'TB', teamLogo: null, awayScore: 3, homeScore: 0 },
      { id: 's2', period: 2, clock: '5:32', text: 'Chase Brown 5 Yd Rush', type: 'Touchdown', teamAbbrev: 'CIN', teamLogo: null, awayScore: 3, homeScore: 21 },
    ],
    teamStats: [{ key: 'totalYards', label: 'Total Yards', away: '226', home: '298', awayShare: 226 / 524, homeShare: 298 / 524 }],
    players: {
      jb: [{ group: 'passing', teamId: '4', name: 'Joe Burrow', headshot: null, jersey: '9', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'], stats: ['22/32', '205', '6.4', '1', '1'] }],
      cb: [
        { group: 'rushing', teamId: '4', name: 'Chase Brown', headshot: null, jersey: '30', labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], stats: ['13', '52', '4.0', '1', '12'] },
        { group: 'receiving', teamId: '4', name: 'Chase Brown', headshot: null, jersey: '30', labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], stats: ['5', '23', '4.6', '0', '9', '6'] },
      ],
    },
    winProbability: { home: 97.1, away: 2.9 },
    venue: { name: 'Paycor Stadium', location: 'Cincinnati, OH' },
    weather: '92° · Mostly sunny',
    attendance: null,
    fetchedAt: '2026-09-13T20:00:00.000Z',
    ...over,
  }
}

const view = (d: LiveGameDetail | null, extra: { stale?: boolean; failed?: boolean } = {}) =>
  render(
    <LiveGameView
      initial={{ detail: d, stale: extra.stale ?? false, failed: extra.failed ?? false }}
      sport="NFL"
      gameId="401872925"
      backHref="/core/live?sport=NFL"
    />,
  )

describe('LiveGameView', () => {
  it('marks an HTTP poll failure stale while preserving the last game scores', async () => {
    vi.useFakeTimers()
    try {
      view(detail())
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
      expect(screen.getByRole('status')).toHaveTextContent(/last update we have/)
      expect(screen.getByText('Tampa Bay Buccaneers')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
  it('header: both teams, scores, status and a back link', () => {
    const { container } = view(detail())
    const head = container.querySelector('.af-gv-head') as HTMLElement
    expect(within(head).getByText('Tampa Bay Buccaneers')).toBeInTheDocument()
    expect(within(head).getByText('5:23 - 4th')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Live Scores/ }).getAttribute('href')).toBe('/core/live?sport=NFL')
  })

  it('game leaders sit side by side per category', () => {
    const { container } = view(detail())
    const row = container.querySelector('.af-gv-leader-row') as HTMLElement
    expect(within(row).getByText('Passing Yards')).toBeInTheDocument()
    expect(within(row).getByText('177')).toBeInTheDocument()
    expect(within(row).getByText('205')).toBeInTheDocument()
  })

  it('current drive: down and ball on, the ball placed at TB 8, and the drive line from TB 44', () => {
    const { container } = view(detail())
    expect(screen.getByText('4th & 1')).toBeInTheDocument()
    expect(screen.getByText('TB 8')).toBeInTheDocument()
    expect((container.querySelector('.af-gv-field .af-live-ball') as HTMLElement).style.left).toBe('8%')
    const line = container.querySelector('.af-gv-driveline') as HTMLElement
    expect(line.style.left).toBe('8%')
    expect(line.style.width).toBe('48%')
  })

  it('last play: ESPN win % labelled as ESPN\'s, and a stat card for each named player using the pass line', () => {
    const { container } = view(detail())
    expect(screen.getByText(/ESPN win % · CIN 97.1/)).toBeInTheDocument()
    const cards = container.querySelectorAll('.af-gv-pcard')
    expect(cards).toHaveLength(2)
    // On a pass, Chase Brown shows his RECEIVING line, not rushing.
    expect(within(cards[1] as HTMLElement).getByText('REC')).toBeInTheDocument()
    expect(within(cards[1] as HTMLElement).queryByText('CAR')).toBeNull()
  })

  it('play-by-play: scoring plays grouped by quarter, and All plays expands a drive', () => {
    const { container } = view(detail())
    expect(screen.getByText('1st Quarter')).toBeInTheDocument()
    expect(screen.getByText('2nd Quarter')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All plays' }))
    const rows = container.querySelectorAll('.af-gv-drive-row')
    expect(rows).toHaveLength(2)
    // Newest drive first and open; the older drive is collapsed until clicked.
    expect(rows[0]?.getAttribute('data-open')).toBe('true')
    expect(screen.queryByText('C.McLaughlin 34 yard field goal is GOOD')).toBeNull()
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button'))
    expect(screen.getByText('C.McLaughlin 34 yard field goal is GOOD')).toBeInTheDocument()
  })

  it('a stale refresh keeps the game on screen and says so', () => {
    view(detail(), { stale: true })
    expect(screen.getByRole('status')).toHaveTextContent(/last update we have/)
    expect(screen.getByText('Cincinnati Bengals')).toBeInTheDocument()
  })

  it('a failed read with nothing cached says it is our problem, not the game', () => {
    view(null, { failed: true })
    expect(screen.getByText('We could not load this game right now.')).toBeInTheDocument()
  })

  it('a final shows the last drive, not a current one, and no down/ball panel', () => {
    const d = detail()
    view({ ...d, status: { ...d.status, state: 'post', detail: 'Final' }, situation: null, drive: { ...d.drive!, isCurrent: false, result: 'Touchdown' } })
    expect(screen.getByText('Last drive')).toBeInTheDocument()
    expect(screen.queryByText('Down')).toBeNull()
  })
})

describe('player stat line helpers', () => {
  const lines: GameDetailPlayerLine[] = [
    { group: 'rushing', teamId: '4', name: 'X', headshot: null, jersey: null, labels: ['CAR', 'YDS', 'TD', 'LONG'], stats: ['13', '52', '1', '12'] },
    { group: 'receiving', teamId: '4', name: 'X', headshot: null, jersey: null, labels: ['REC', 'YDS', 'TD', 'TGTS'], stats: ['5', '23', '0', '6'] },
  ]
  it('picks the line that fits the play type', () => {
    expect(lineForPlay(lines, 'Pass Reception')?.group).toBe('receiving')
    expect(lineForPlay(lines, 'Rush')?.group).toBe('rushing')
  })
  it('shows the preferred four stats in order', () => {
    expect(statCells(lines[1]!).map((c) => `${c.label}=${c.value}`)).toEqual(['REC=5', 'YDS=23', 'TD=0', 'TGTS=6'])
  })
})
