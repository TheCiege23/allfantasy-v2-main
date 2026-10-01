import { describe, expect, it } from 'vitest'

import type { BoardTeam, StandingsBoard } from '@/lib/core-app/standingsModel'
import { currentStreak, leagueAwards, streakLabel, yourHeadToHead } from '@/lib/core-app/standingsHighlights'

function team(id: string, seed: number, over: Partial<BoardTeam> = {}): BoardTeam {
  return {
    rosterId: id,
    name: `Team ${id}`,
    avatarUrl: null,
    isYou: false,
    division: null,
    seed,
    seedMove: null,
    record: { wins: 2, losses: 2, ties: 0 },
    winPct: 0.5,
    gamesBack: 0,
    pointsFor: 400,
    pointsAgainst: 400,
    divisionRank: null,
    tiebreak: null,
    zone: 'playoff',
    clinched: null,
    gamesLeft: 10,
    powerRank: seed,
    powerScore: 50,
    powerMove: null,
    pfRank: seed,
    pfMove: null,
    allPlay: { wins: 6, losses: 6, ties: 0 },
    headToHeadWins: 2,
    expectedWins: 2,
    luck: 0,
    average: 100,
    weeksPlayed: 4,
    form: ['W', 'L', 'W', 'L'],
    projected: null,
    ...over,
  }
}

function board(teams: BoardTeam[], over: Partial<StandingsBoard> = {}): StandingsBoard {
  return {
    teams,
    h2h: {},
    hasHeadToHead: true,
    rules: { playoffTeams: 2, byes: 0 },
    ...over,
  } as unknown as StandingsBoard
}

describe('streaks', () => {
  it('reads the run from the newest end', () => {
    expect(currentStreak(['L', 'W', 'W', 'W'])).toEqual({ kind: 'W', n: 3 })
    expect(currentStreak(['W', 'L'])).toEqual({ kind: 'L', n: 1 })
    expect(currentStreak([])).toBeNull()
  })

  /* `form` keeps five results, so a run of five may be longer — never claim exactly five. */
  it('marks a full window of five as "or more"', () => {
    expect(streakLabel({ kind: 'W', n: 5 }, 5)).toBe('W5+')
    expect(streakLabel({ kind: 'W', n: 3 }, 5)).toBe('W3')
  })
})

describe('leagueAwards', () => {
  it('gives no luck award when nobody is a full win off their scoring', () => {
    const awards = leagueAwards(board([team('1', 1, { luck: 0.6 }), team('2', 2, { luck: -0.6 })]))
    expect(awards.map((a) => a.key)).not.toContain('lucky')
    expect(awards.map((a) => a.key)).not.toContain('robbed')
  })

  it('names the luckiest, the snakebitten and the hottest team past their floors', () => {
    const awards = leagueAwards(
      board([
        team('1', 1, { luck: 1.6, headToHeadWins: 4, expectedWins: 2.4, form: ['L', 'W', 'W', 'W'], pfRank: 3 }),
        team('2', 2, { luck: -2, isYou: true }),
        team('3', 3, { pfRank: 1 }),
      ]),
    )
    const by = Object.fromEntries(awards.map((a) => [a.key, a]))
    expect(by.lucky.team).toBe('Team 1')
    expect(by.lucky.detail).toBe('4 wins on scoring worth 2.4.')
    expect(by.robbed.isYou).toBe(true)
    expect(by.hot.stat).toBe('W3')
    expect(by.points.team).toBe('Team 3')
  })

  it('calls a team better than its record only two places clear', () => {
    const one = leagueAwards(board([team('1', 1, { powerRank: 2 }), team('2', 2, { powerRank: 1 })]))
    expect(one.map((a) => a.key)).not.toContain('underrated')
    const three = leagueAwards(board([team('1', 1, { powerRank: 2 }), team('2', 4, { powerRank: 1 })]))
    expect(three.find((a) => a.key === 'underrated')?.team).toBe('Team 2')
  })

  it('draws no head-to-head awards for a points-only league', () => {
    const awards = leagueAwards(
      board([team('1', 1, { luck: 3, form: ['W', 'W', 'W'] }), team('2', 2)], { hasHeadToHead: false }),
    )
    const keys = awards.map((a) => a.key)
    for (const k of ['hot', 'cold', 'lucky', 'robbed', 'schedule']) expect(keys).not.toContain(k)
    expect(keys).toContain('points')
  })
})

describe('yourHeadToHead', () => {
  it('lists only opponents you have played, and totals your record against the field', () => {
    const teams = [team('1', 1), team('2', 2, { isYou: true }), team('3', 3), team('4', 4)]
    const h2h = {
      '2': {
        '1': { wins: 0, losses: 1, ties: 0 },
        '3': { wins: 2, losses: 0, ties: 0 },
        '4': { wins: 0, losses: 0, ties: 0 },
      },
    }
    const out = yourHeadToHead(board(teams, { h2h } as Partial<StandingsBoard>))!
    expect(out.cells.map((c) => [c.name, c.text, c.verdict])).toEqual([
      ['Team 1', '0-1', 'L'],
      ['Team 3', '2-0', 'W'],
    ])
    // The top 2 are teams 1 and 2; you are team 2, so only team 1 counts.
    expect(out.vsField).toEqual({ wins: 0, losses: 1, ties: 0 })
  })

  it('draws nothing without a team of yours or a head-to-head game', () => {
    expect(yourHeadToHead(board([team('1', 1), team('2', 2)]))).toBeNull()
    expect(yourHeadToHead(board([team('1', 1, { isYou: true }), team('2', 2)]))).toBeNull()
  })
})
