/**
 * The NHL game view: rink shot map, goals / all plays by period, skater and
 * goalie box score, and a three-period line score.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveGameView, markerColor } from '@/components/core-app/screens/LiveGameView'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'

const team = (over: Partial<LiveGameDetail['home']>): LiveGameDetail['home'] => ({
  id: '1', abbrev: 'BOS', name: 'Boston Bruins', logo: null, color: '231f20', altColor: null, score: 2, record: '36-22-6', rank: null, linescores: [0, 0, 1, 1], possession: false, ...over,
})
// Real order is BS HT TK +/- … G YTDG A S SM SOG …; `SOG` stays in so the view
// has to choose `S` over it.
const skaterLabels = ['G', 'A', '+/-', 'S', 'HT', 'BS', 'PIM', 'FO%', 'TOI', 'SOG']
const goalieLabels = ['GA', 'SA', 'SV', 'SV%', 'TOI']

function nhlDetail(): LiveGameDetail {
  return {
    gameId: '401803363', sport: 'NHL',
    status: { state: 'post', detail: 'Final/OT', period: 4, clock: '0:00' },
    home: team({}),
    away: team({ id: '8', abbrev: 'LA', name: 'Los Angeles Kings', color: '121212', score: 1, linescores: [0, 0, 1, 0] }),
    leaders: { home: [], away: [] },
    drive: null, situation: null,
    lastPlay: { id: 'ot', text: 'Charlie McAvoy Goal (7) Backhand', type: 'Goal', typeAbbrev: null, period: 4, clock: '1:12', downDistance: null, startBallOn: null, endBallOn: null, statYardage: null, yardsAfterCatch: null, scoring: true, awayScore: 1, homeScore: 2 },
    lastPlayAthleteIds: ['mcavoy'],
    drives: [], scoringPlays: [], teamStats: [],
    players: { mcavoy: [{ group: 'defenses', teamId: '1', name: 'Charlie McAvoy', headshot: null, jersey: '73', labels: ['G', 'A', 'S', 'SOG', '+/-'], stats: ['1', '0', '3', '0', '+1'] }] },
    winProbability: null,
    venue: { name: 'TD Garden', location: 'Boston, MA' }, weather: null, attendance: 17850,
    basketball: null,
    hockey: {
      plays: [
        { id: 'b1', text: 'David Pastrnak Wrist Shot saved by Darcy Kuemper', type: 'Shot', period: 1, clock: '15:00', teamId: '1', scoring: false, strength: 'Even Strength', awayScore: 0, homeScore: 0, athleteIds: ['pasta'] },
        { id: 'l3', text: 'Drew Doughty Goal (4) Slap Shot', type: 'Goal', period: 3, clock: '5:00', teamId: '8', scoring: true, strength: 'Power Play', awayScore: 1, homeScore: 1, athleteIds: ['doughty'] },
        { id: 'pen', text: 'Drew Doughty Tripping against David Pastrnak', type: 'Tripping', period: 3, clock: '3:00', teamId: '8', scoring: false, strength: 'Even Strength', awayScore: 1, homeScore: 1, athleteIds: [] },
        { id: 'ot', text: 'Charlie McAvoy Goal (7) Backhand', type: 'Goal', period: 4, clock: '1:12', teamId: '1', scoring: true, strength: 'Even Strength', awayScore: 1, homeScore: 2, athleteIds: ['mcavoy'] },
      ],
      shots: [
        { id: 'b1', teamId: '1', athleteId: 'pasta', x: 70, y: 10, kind: 'shot', period: 1, clock: '15:00', strength: 'Even Strength', text: 'Pastrnak shot' },
        { id: 'l1', teamId: '8', athleteId: 'doughty', x: 60, y: 5, kind: 'missed', period: 1, clock: '12:00', strength: 'Even Strength', text: 'Doughty wide' },
        { id: 'l3', teamId: '8', athleteId: 'doughty', x: 30, y: -33, kind: 'goal', period: 3, clock: '5:00', strength: 'Power Play', text: 'Doughty goal' },
        { id: 'ot', teamId: '1', athleteId: 'mcavoy', x: 83, y: 2, kind: 'goal', period: 4, clock: '1:12', strength: 'Even Strength', text: 'McAvoy goal' },
      ],
      box: {
        home: {
          teamId: '1', skaterLabels, goalieLabels,
          skaters: [
            { athleteId: 'pasta', name: 'David Pastrnak', shortName: 'D. Pastrnak', headshot: null, jersey: '88', position: 'RW', unit: 'F', stats: ['0', '1', '+1', '4', '1', '0', '0', '0.0', '21:10', '0'] },
            { athleteId: 'mcavoy', name: 'Charlie McAvoy', shortName: 'C. McAvoy', headshot: null, jersey: '73', position: 'D', unit: 'D', stats: ['1', '0', '+1', '3', '1', '2', '0', '0.0', '24:00', '0'] },
          ],
          goalies: [{ athleteId: 'swayman', name: 'Jeremy Swayman', shortName: 'J. Swayman', headshot: null, jersey: '1', position: 'G', stats: ['1', '16', '15', '.938', '61:34'] }],
        },
        away: { teamId: '8', skaterLabels, goalieLabels, skaters: [], goalies: [] },
      },
    },
    fetchedAt: '2026-09-13T20:00:00.000Z',
  }
}

const view = () =>
  render(<LiveGameView initial={{ detail: nhlDetail(), stale: false, failed: false }} sport="NHL" gameId="401803363" backHref="/core/live?sport=NHL" />)

describe('LiveGameView — NHL', () => {
  it('header line score has three periods then OT', () => {
    const { container } = view()
    const heads = [...container.querySelectorAll('.af-gv-lines thead th')].map((th) => th.textContent)
    expect(heads).toEqual(['', '1', '2', '3', 'OT', 'T'])
  })

  it('rink shot map: goal, on-goal and missed markers, and a team filter', () => {
    const { container } = view()
    const rink = container.querySelector('.af-gv-rink') as SVGElement
    expect(rink.querySelectorAll('.af-gv-hshot[data-kind="goal"]')).toHaveLength(2)
    expect(rink.querySelectorAll('.af-gv-hshot[data-kind="shot"]')).toHaveLength(1)
    expect(rink.querySelectorAll('.af-gv-hshot[data-kind="missed"]')).toHaveLength(1)
    expect(rink.querySelector('.af-gv-hshot[data-kind="missed"]')?.getAttribute('fill')).toBe('none')
    fireEvent.click(screen.getByRole('button', { name: 'LA' }))
    expect(rink.querySelectorAll('.af-gv-hshot')).toHaveLength(2)
    expect(screen.getByText('1 G · 1 SOG')).toBeInTheDocument()
  })

  it('goals tab lists the whole game\'s goals with a power-play tag; All plays pages by period', () => {
    const { container } = view()
    const goals = container.querySelectorAll('.af-gv-bplay')
    expect(goals).toHaveLength(2)
    expect(within(goals[1] as HTMLElement).getByText('PP')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All plays' }))
    // Opens on the newest period (OT) with its one play; 3rd has two.
    expect(screen.getByText('Overtime')).toBeInTheDocument()
    expect(container.querySelectorAll('.af-gv-bplay')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '3rd' }))
    expect(screen.getByText('3rd Period')).toBeInTheDocument()
    expect(container.querySelectorAll('.af-gv-bplay')).toHaveLength(2)
  })

  it('box score: forwards and defense rows with the chosen columns, and a goalie table', () => {
    const { container } = view()
    const bos = container.querySelector('.af-gv-box-team[data-team="1"]') as HTMLElement
    const skaterHead = [...bos.querySelectorAll('table:not([data-kind]) thead th')].map((th) => th.textContent)
    expect(skaterHead).toEqual(['Forwards', 'G', 'A', '+/-', 'S', 'HT', 'BS', 'PIM', 'FO%', 'TOI'])
    // Pastrnak's shots are 4 (`S`), not ESPN's all-zero `SOG`.
    const pasta = within(bos).getByText('D. Pastrnak').closest('tr') as HTMLElement
    expect([...pasta.querySelectorAll('td')].map((td) => td.textContent)[3]).toBe('4')
    expect(within(bos).getByText('Defense')).toBeInTheDocument()
    const goalieTable = bos.querySelector('table[data-kind="goalies"]') as HTMLElement
    expect(within(goalieTable).getByText('J. Swayman')).toBeInTheDocument()
    expect(within(goalieTable).getByText('.938')).toBeInTheDocument()
  })

  it('last play card uses the skater line and there is no ESPN win % (NHL sends none)', () => {
    const { container } = view()
    const card = container.querySelector('.af-gv-pcard') as HTMLElement
    expect(within(card).getAllByRole('term').map((t) => t.textContent)).toEqual(['G', 'A', 'S', '+/-'])
    expect(screen.queryByText(/ESPN win %/)).toBeNull()
  })

  it('near-black team colours fall back so rink markers stay visible', () => {
    // BOS 231f20 and LA 121212 are the measured colours, with no alternate.
    expect(markerColor({ color: '231f20', altColor: null }, 'var(--warn)')).toBe('var(--warn)')
    expect(markerColor({ color: '121212', altColor: 'a2aaad' }, 'var(--accent)')).toBe('#a2aaad')
    expect(markerColor({ color: 'ce1141', altColor: '000000' }, 'var(--accent)')).toBe('#ce1141')
    const { container } = view()
    const fills = new Set(
      [...container.querySelectorAll('.af-gv-hshot:not([data-kind="missed"])')].map((c) => c.getAttribute('fill')),
    )
    expect(fills).toEqual(new Set(['var(--accent)', 'var(--warn)']))
  })
})
