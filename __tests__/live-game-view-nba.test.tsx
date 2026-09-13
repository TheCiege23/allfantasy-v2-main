/**
 * The NBA game view: shot chart, last play with the play's own players, quarter
 * play-by-play and the box score. Football panels (drive, field) are absent.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveGameView } from '@/components/core-app/screens/LiveGameView'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'

const team = (over: Partial<LiveGameDetail['home']>): LiveGameDetail['home'] => ({
  id: '9',
  abbrev: 'GS',
  name: 'Golden State Warriors',
  logo: null,
  color: 'fdb927',
  altColor: null,
  score: 124,
  record: '32-33',
  rank: null,
  linescores: [30, 21, 32, 35, 6],
  possession: false,
  ...over,
})

const labels = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST']

function nbaDetail(over: Partial<LiveGameDetail> = {}): LiveGameDetail {
  return {
    gameId: '401810798',
    sport: 'NBA',
    status: { state: 'post', detail: 'Final/OT', period: 5, clock: '0.0' },
    home: team({}),
    away: team({ id: '4', abbrev: 'CHI', name: 'Chicago Bulls', color: 'ce1141', score: 130, linescores: [26, 31, 32, 29, 12] }),
    leaders: {
      away: [{ category: 'points', label: 'Points', athleteId: 'buz', name: 'Matas Buzelis', shortName: 'M. Buzelis', position: 'F', headshot: null, mainValue: '41', mainLabel: 'PTS', summary: '16/28 FG, 4/5 FT' }],
      home: [{ category: 'points', label: 'Points', athleteId: 'santos', name: 'Gui Santos', shortName: 'G. Santos', position: 'F', headshot: null, mainValue: '17', mainLabel: 'PTS', summary: '7/19 FG' }],
    },
    drive: null,
    situation: null,
    lastPlay: {
      id: 'win', text: 'Matas Buzelis makes driving layup', type: 'Driving Layup Shot', typeAbbrev: null, period: 5, clock: '0:21',
      downDistance: null, startBallOn: null, endBallOn: null, statYardage: null, yardsAfterCatch: null, scoring: true, awayScore: 130, homeScore: 124,
    },
    lastPlayAthleteIds: ['buz'],
    drives: [],
    scoringPlays: [],
    teamStats: [{ key: 'totalRebounds', label: 'Rebounds', away: '58', home: '64', awayShare: 58 / 122, homeShare: 64 / 122 }],
    players: { buz: [{ group: 'basketball', teamId: '4', name: 'Matas Buzelis', headshot: null, jersey: '14', labels, stats: ['42', '41', '16-28', '5-9', '4-5', '7', '2'] }] },
    winProbability: { home: 0, away: 100 },
    venue: { name: 'Chase Center', location: 'San Francisco, CA' },
    weather: null,
    attendance: 18064,
    basketball: {
      periods: 'quarters',
      court: 'pro',
      plays: [
        { id: 'm3', text: 'Draymond Green makes 26-foot three point jumper', type: 'Jump Shot', period: 1, clock: '10:58', teamId: '9', scoring: true, scoreValue: 3, awayScore: 0, homeScore: 4, athleteIds: ['green'] },
        { id: 'miss', text: 'Matas Buzelis misses 15-foot pullup jump shot', type: 'Pullup Jump Shot', period: 1, clock: '10:40', teamId: '4', scoring: false, scoreValue: null, awayScore: 0, homeScore: 4, athleteIds: ['buz'] },
        { id: 'sub', text: 'Kevon Looney enters the game for Draymond Green', type: 'Substitution', period: 5, clock: '0:40', teamId: '9', scoring: false, scoreValue: null, awayScore: 128, homeScore: 124, athleteIds: [] },
        { id: 'win', text: 'Matas Buzelis makes driving layup', type: 'Driving Layup Shot', period: 5, clock: '0:21', teamId: '4', scoring: true, scoreValue: 2, awayScore: 130, homeScore: 124, athleteIds: ['buz'] },
      ],
      shots: [
        { id: 'm3', teamId: '9', athleteId: 'green', x: 33, y: 25, made: true, value: 3, period: 1, clock: '10:58', text: 'Draymond Green makes 26-foot three point jumper' },
        { id: 'miss', teamId: '4', athleteId: 'buz', x: 12, y: 9, made: false, value: 2, period: 1, clock: '10:40', text: 'Matas Buzelis misses 15-foot pullup jump shot' },
        { id: 'win', teamId: '4', athleteId: 'buz', x: 24, y: 1, made: true, value: 2, period: 5, clock: '0:21', text: 'Matas Buzelis makes driving layup' },
        { id: 'heave', teamId: '9', athleteId: 'green', x: 25, y: 61, made: false, value: 3, period: 2, clock: '0:01', text: 'Draymond Green misses 66-foot three point shot' },
      ],
      box: {
        home: {
          teamId: '9', labels, totals: ['', '124', '50-112', '15-47', '15-18', '64', '34'],
          players: [
            { athleteId: 'green', name: 'Draymond Green', shortName: 'D. Green', headshot: null, jersey: '23', position: 'F', starter: true, didNotPlay: false, reason: null, stats: ['30', '12', '4-9', '2-5', '2-2', '6', '5'] },
            { athleteId: 'podz', name: 'Brandin Podziemski', shortName: 'B. Podziemski', headshot: null, jersey: '2', position: 'G', starter: false, didNotPlay: false, reason: null, stats: ['27', '9', '3-8', '1-4', '2-2', '4', '7'] },
            { athleteId: 'hurt', name: 'Hurt Player', shortName: 'H. Player', headshot: null, jersey: '9', position: 'G', starter: false, didNotPlay: true, reason: 'LEFT ANKLE SPRAIN', stats: [] },
          ],
        },
        away: {
          teamId: '4', labels, totals: ['', '130', '52-110', '', '', '58', ''],
          players: [{ athleteId: 'buz', name: 'Matas Buzelis', shortName: 'M. Buzelis', headshot: null, jersey: '14', position: 'F', starter: true, didNotPlay: false, reason: null, stats: ['42', '41', '16-28', '5-9', '4-5', '7', '2'] }],
        },
      },
    },
    fetchedAt: '2026-09-13T20:00:00.000Z',
    ...over,
  }
}

const view = () =>
  render(
    <LiveGameView initial={{ detail: nbaDetail(), stale: false, failed: false }} sport="NBA" gameId="401810798" backHref="/core/live?sport=NBA" />,
  )

describe('LiveGameView — NBA', () => {
  it('has no football drive panel or field', () => {
    const { container } = view()
    expect(container.querySelector('.af-gv-field')).toBeNull()
    expect(screen.queryByText('Current drive')).toBeNull()
  })

  it('shot chart: made and missed markers, the heave past half court left off, and a team filter', () => {
    const { container } = view()
    const court = container.querySelector('.af-gv-court') as SVGElement
    expect(court.querySelectorAll('.af-gv-shot[data-made="true"]')).toHaveLength(2)
    expect(court.querySelectorAll('.af-gv-shot[data-made="false"]')).toHaveLength(1)
    // 26-foot three at ESPN (33, 25) is drawn 5.25 ft further from the baseline.
    const three = [...court.querySelectorAll('circle.af-gv-shot')].find((c) => c.getAttribute('cx') === '33')!
    expect(three.getAttribute('cy')).toBe('30.25')
    // The NBA court: a 16 ft lane.
    expect(court.querySelector('.af-gv-court-lines[data-court="pro"] rect')!.getAttribute('width')).toBe('16')

    fireEvent.click(screen.getByRole('button', { name: 'CHI' }))
    expect(court.querySelectorAll('.af-gv-shot')).toHaveLength(2)
    expect(within(container.querySelector('.af-gv-shots-head') as HTMLElement).getByText('1/2 FG')).toBeInTheDocument()
  })

  it('last play card uses the basketball line: PTS, REB, AST, FG', () => {
    const { container } = view()
    const card = container.querySelector('.af-gv-pcard') as HTMLElement
    // The name element itself: the mocked headshot also prints the name.
    expect((card.querySelector('.af-gv-pcard-name') as HTMLElement).textContent).toBe('Matas Buzelis')
    expect(within(card).getAllByRole('term').map((t) => t.textContent)).toEqual(['PTS', 'REB', 'AST', 'FG'])
    expect(within(card).getByText('41')).toBeInTheDocument()
  })

  it('play-by-play: one quarter at a time, opening on the newest; All plays hides substitutions', () => {
    const { container } = view()
    // Opens on overtime (period 5): only its one scoring play.
    expect([...container.querySelectorAll('.af-gv-period-head')].map((h) => h.textContent)).toEqual(['Overtime'])
    expect(container.querySelectorAll('.af-gv-bplay')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'OT' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Q1' }))
    expect([...container.querySelectorAll('.af-gv-period-head')].map((h) => h.textContent)).toEqual(['1st Quarter'])
    expect(container.querySelectorAll('.af-gv-bplay')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'All plays' }))
    expect(container.querySelectorAll('.af-gv-bplay')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'OT' }))
    expect(container.querySelectorAll('.af-gv-bplay')).toHaveLength(1)
    expect(screen.queryByText(/enters the game/)).toBeNull()
  })

  it('box score: starters, bench and DNP with ESPN\'s reason, plus team totals', () => {
    const { container } = view()
    const gs = container.querySelector('.af-gv-box-team[data-team="9"]') as HTMLElement
    expect(within(gs).getByText('D. Green')).toBeInTheDocument()
    expect(within(gs).getByText('Bench')).toBeInTheDocument()
    expect(within(gs).getByText('DNP · LEFT ANKLE SPRAIN')).toBeInTheDocument()
    expect(within(gs).getByText('50-112')).toBeInTheDocument()
  })
})
