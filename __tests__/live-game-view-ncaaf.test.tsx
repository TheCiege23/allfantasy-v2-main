/**
 * The college football game view, pinned against what real college games send.
 * Values from WAKE @ PUR (401858224, 2026-09-12, Final/2OT 38-36): ESPN gives both
 * schools the primary colour `ceb888`, and every overtime play carries "0:00".
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveGameView, distinctTeamColors } from '@/components/core-app/screens/LiveGameView'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'

describe('distinctTeamColors', () => {
  it('keeps two different colours as they are', () => {
    expect(distinctTeamColors({ color: 'ba0c2f', altColor: null }, { color: 'af5c37', altColor: null }, { away: 'A', home: 'H' })).toEqual({
      away: '#ba0c2f',
      home: '#af5c37',
    })
  })

  it('on a clash the home side takes its alternate colour (Wake Forest and Purdue are both ceb888)', () => {
    expect(distinctTeamColors({ color: 'ceb888', altColor: '2c2a29' }, { color: 'CEB888', altColor: '000000' }, { away: 'A', home: 'H' })).toEqual({
      away: '#ceb888',
      home: '#000000',
    })
  })

  it('falls back when the alternate is missing, invalid or the same colour again', () => {
    const f = { away: 'A', home: 'H' }
    expect(distinctTeamColors({ color: 'ceb888', altColor: null }, { color: 'ceb888', altColor: null }, f).home).toBe('H')
    expect(distinctTeamColors({ color: 'ceb888', altColor: null }, { color: 'ceb888', altColor: 'ceb888' }, f).home).toBe('H')
    expect(distinctTeamColors({ color: null, altColor: null }, { color: 'zzz', altColor: null }, f)).toEqual({ away: 'A', home: 'H' })
  })
})

const team = (over: Partial<LiveGameDetail['home']>): LiveGameDetail['home'] => ({
  id: '2509',
  abbrev: 'PUR',
  name: 'Purdue Boilermakers',
  logo: null,
  color: 'ceb888',
  altColor: '000000',
  score: 36,
  record: '1-1',
  rank: null,
  linescores: [7, 3, 3, 10, 7, 6],
  possession: false,
  ...over,
})

const play = (over: Partial<LiveGameDetail['drives'][number]['plays'][number]>) => ({
  id: 'p',
  text: '',
  type: null,
  typeAbbrev: null,
  period: 6,
  clock: '0:00',
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
  const last = play({ id: 'ot2', text: 'Gio Lopez 3 Yd Run (Gio Lopez Run for Two-Point Conversion)', type: 'Rushing Touchdown', scoring: true })
  const drive = {
    id: 'd20',
    teamId: '154',
    teamAbbrev: 'WAKE',
    teamLogo: null,
    description: '8 plays, 25 yards',
    result: 'Touchdown',
    isScore: true,
    isCurrent: false,
    startBallOn: 75,
    startText: 'PUR 25',
    endBallOn: 97,
    endText: 'PUR 3',
    plays: [last],
  }
  const score = (id: string, period: number, clock: string, text: string, awayScore: number, homeScore: number) => ({
    id, period, clock, text, type: 'Rushing Touchdown', teamAbbrev: 'WAKE', teamLogo: null, awayScore, homeScore,
  })
  return {
    gameId: '401858224',
    sport: 'NCAAF',
    status: { state: 'post', detail: 'Final/2OT', period: null, clock: null },
    home: team({}),
    away: team({ id: '154', abbrev: 'WAKE', name: 'Wake Forest Demon Deacons', altColor: '2c2a29', score: 38, record: '2-0', linescores: [7, 10, 3, 3, 7, 8] }),
    leaders: { away: [], home: [] },
    drive,
    situation: null,
    lastPlay: last,
    lastPlayAthleteIds: [],
    drives: [drive],
    scoringPlays: [
      score('s1', 1, '10:43', 'Fame Ijeboi 14 Yd Run (Jacobo Echeverria Lozano Kick)', 0, 7),
      score('s5', 5, '0:00', 'Bryce Kania 24 Yd pass from Gio Lopez (Connor Calvert Kick)', 30, 23),
      score('s8', 6, '0:00', 'Gio Lopez 3 Yd Run (Gio Lopez Run for Two-Point Conversion)', 38, 36),
    ],
    teamStats: [{ key: 'totalYards', label: 'Total Yards', away: '411', home: '455', awayShare: 411 / 866, homeShare: 455 / 866 }],
    players: {},
    winProbability: { home: 0, away: 100 },
    venue: { name: 'Ross-Ade Stadium', location: 'West Lafayette, IN' },
    weather: null,
    attendance: 50363,
    fetchedAt: '2026-09-13T20:00:00.000Z',
    ...over,
  }
}

const view = (d: LiveGameDetail) =>
  render(<LiveGameView initial={{ detail: d, stale: false, failed: false }} sport={d.sport} gameId={d.gameId} backHref="/live?sport=NCAAF" />)

describe('LiveGameView — college football', () => {
  it('two teams sharing a colour get two end zones and two stat bars that differ', () => {
    const { container } = view(detail())
    const zones = [...container.querySelectorAll('.af-gv-endzone')].map((z) => (z as HTMLElement).style.background)
    expect(zones).toHaveLength(2)
    expect(zones[0]).toBe('rgb(206, 184, 136)')
    expect(zones[1]).toBe('rgb(0, 0, 0)')
    const bars = [...container.querySelectorAll('.af-gv-bar')].map((b) => (b as HTMLElement).style.background)
    expect(bars[0]).not.toBe(bars[1])
  })

  it('overtime scores read "OT" and "2OT" with no clock, under "Overtime" and "2nd Overtime"', () => {
    const { container } = view(detail())
    expect([...container.querySelectorAll('.af-gv-period-head')].map((h) => h.textContent)).toEqual(['1st Quarter', 'Overtime', '2nd Overtime'])
    const meta = [...container.querySelectorAll('.af-gv-score-play .af-gv-muted')].map((m) => m.textContent)
    expect(meta).toEqual(['10:43 · 1st', 'OT', '2OT'])
  })

  it('all plays: an overtime play shows its period and no "0:00"', () => {
    const { container } = view(detail())
    fireEvent.click(screen.getByRole('button', { name: 'All plays' }))
    expect(container.querySelector('.af-gv-play-meta')!.textContent).toBe('Rushing Touchdown 2OT')
  })

  it('control: NFL overtime is timed, so its clock stays', () => {
    const d = detail({ sport: 'NFL' })
    const { container } = view({ ...d, scoringPlays: [{ ...d.scoringPlays[1]!, clock: '7:12' }] })
    expect(container.querySelector('.af-gv-score-play .af-gv-muted')!.textContent).toBe('7:12 · OT')
  })
})
