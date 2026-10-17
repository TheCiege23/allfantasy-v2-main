import { describe, expect, it } from 'vitest'
import {
  boxAthleteForStarter,
  footballBoxTeams,
  hasFootballBox,
  starterStatLines,
} from '@/lib/live/gameBoxScore'
import { formatStarterPoints, groupStartersByPlayer } from '@/lib/live/liveTieInGroups'
import { mergeStarters } from '@/components/core-app/screens/LiveGameView'
import type { GameDetailPlayerLine, LiveGameDetail } from '@/lib/live/espnGameSummary'

const line = (group: string, teamId: string, name: string, labels: string[], stats: string[]): GameDetailPlayerLine => ({
  group, teamId, name, headshot: null, jersey: null, labels, stats,
})

const PASS = ['C/ATT', 'YDS', 'AVG', 'TD', 'INT']
const RUSH = ['CAR', 'YDS', 'AVG', 'TD', 'LONG']
const REC = ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS']

function detail(players: LiveGameDetail['players'], extra: Partial<LiveGameDetail> = {}) {
  return {
    sport: 'NFL',
    home: { id: '4', abbrev: 'CIN' },
    away: { id: '27', abbrev: 'TB' },
    players,
    basketball: null,
    hockey: null,
    baseball: null,
    ...extra,
  } as unknown as LiveGameDetail
}

const PLAYERS: LiveGameDetail['players'] = {
  jb: [line('passing', '4', 'Joe Burrow', PASS, ['22/32', '205', '6.4', '1', '1'])],
  cb: [
    line('rushing', '4', 'Chase Brown', RUSH, ['13', '52', '4.0', '1', '12']),
    line('receiving', '4', 'Chase Brown', REC, ['5', '23', '4.6', '0', '9', '6']),
  ],
  bm: [line('passing', '27', 'Baker Mayfield', PASS, ['19/23', '177', '7.7', '1', '0'])],
  ww: [line('defensive', '27', 'Antoine Winfield Jr.', ['TOT', 'SOLO', 'SACKS'], ['7', '5', '0'])],
}

describe('football box score', () => {
  it('is football only when no other sport owns the box', () => {
    expect(hasFootballBox(detail(PLAYERS))).toBe(true)
    expect(hasFootballBox(detail(PLAYERS, { basketball: {} as never }))).toBe(false)
    expect(hasFootballBox(detail({ x: [line('basketball', '1', 'A', ['PTS'], ['9'])] }))).toBe(false)
  })

  it('groups each team away first, main groups before defense, rows in ESPN order', () => {
    const [away, home] = footballBoxTeams(detail(PLAYERS))
    expect(away!.teamId).toBe('27')
    expect(away!.groups.map((g) => g.group)).toEqual(['passing', 'defensive'])
    expect(home!.groups.map((g) => g.group)).toEqual(['passing', 'rushing', 'receiving'])
    // Columns are ESPN's own for the group, not a hardcoded subset.
    expect(home!.groups[1]!.labels).toEqual(RUSH)
    expect(home!.groups[1]!.rows[0]).toMatchObject({ athleteId: 'cb', stats: ['13', '52', '4.0', '1', '12'] })
  })
})

describe('boxAthleteForStarter', () => {
  it('finds a starter by name on his own team, through suffix and case differences', () => {
    const d = detail(PLAYERS)
    expect(boxAthleteForStarter(d, { playerName: 'Chase Brown', team: 'CIN' })).toBe('cb')
    expect(boxAthleteForStarter(d, { playerName: 'antoine winfield', team: 'TB' })).toBe('ww')
  })

  it('never pins a line to a namesake on the other team', () => {
    const d = detail(PLAYERS)
    expect(boxAthleteForStarter(d, { playerName: 'Chase Brown', team: 'TB' })).toBeNull()
  })

  it('matches nobody when a name is ambiguous — no line beats the wrong line', () => {
    const d = detail({
      a: [line('defensive', '4', 'Josh Allen', ['TOT'], ['2'])],
      b: [line('defensive', '27', 'Josh Allen', ['TOT'], ['1'])],
    })
    expect(boxAthleteForStarter(d, { playerName: 'Josh Allen', team: null })).toBeNull()
    expect(boxAthleteForStarter(d, { playerName: 'Josh Allen', team: 'TB' })).toBe('b')
  })

  it('reads the team through the NFL aliases the slate uses (WSH is WAS)', () => {
    const d = detail({ tm: [line('receiving', '28', 'Terry McLaurin', REC, ['4', '60', '15', '1', '30', '6'])] }, {
      away: { id: '28', abbrev: 'WSH' } as never,
    })
    expect(boxAthleteForStarter(d, { playerName: 'Terry McLaurin', team: 'WAS' })).toBe('tm')
  })
})

describe('starterStatLines', () => {
  it('leads with the lines his position scores from', () => {
    expect(starterStatLines(PLAYERS.cb!, 'RB').map((l) => l.group)).toEqual(['rushing', 'receiving'])
    expect(starterStatLines(PLAYERS.cb!, 'WR').map((l) => l.group)).toEqual(['receiving', 'rushing'])
    expect(starterStatLines(PLAYERS.ww!, 'S').map((l) => l.group)).toEqual(['defensive'])
  })

  it('uses another sport\'s single box line, but never leads a football player with fumbles', () => {
    expect(starterStatLines([line('basketball', '1', 'A', ['PTS'], ['31'])], 'PG').map((l) => l.group)).toEqual(['basketball'])
    expect(starterStatLines([line('fumbles', '4', 'B', ['FUM'], ['1'])], 'RB')).toEqual([])
  })
})

describe('shared starter points label', () => {
  const groups = groupStartersByPlayer([
    { leagueId: 'L1', leagueName: 'One', playerId: 'p', playerName: 'P', position: 'RB', imageUrl: null, team: 'CIN', isStarter: true, points: 12.4 },
    { leagueId: 'L2', leagueName: 'Two', playerId: 'p', playerName: 'P', position: 'RB', imageUrl: null, team: 'CIN', isStarter: true, points: 10.1 },
  ])
  it('is the held league\'s number, else the range, and carries the team through', () => {
    expect(formatStarterPoints(groups[0]!, 'L1')).toBe('12.4 pts')
    expect(formatStarterPoints(groups[0]!, null)).toBe('10.1–12.4 pts')
    expect(groups[0]!.team).toBe('CIN')
  })
})

describe('mergeStarters', () => {
  const good = { tieIns: [{ leagueId: 'L1' }], hasRosterData: true, rosterFailed: false } as never
  const failed = { tieIns: [], hasRosterData: false, rosterFailed: true } as never
  it('keeps the last good panel through a failed poll, and takes any good poll', () => {
    expect(mergeStarters(good, failed)).toBe(good)
    const fresh = { ...(good as object) } as never
    expect(mergeStarters(good, fresh)).toBe(fresh)
    expect(mergeStarters(null, failed)).toBe(failed)
    expect(mergeStarters(null, null)).toBeNull()
  })
})
