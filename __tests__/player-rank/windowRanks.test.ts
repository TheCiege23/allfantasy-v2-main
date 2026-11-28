import { describe, expect, it } from 'vitest'

import { addDays, computeWindowRanks, playerWindowRanks, rankPosition, type DayPoints } from '@/lib/player-rank/windowRanks'

const today = '2026-11-28'
const d = (playerId: string, daysAgo: number, points: number, games = 1): DayPoints => ({ playerId, day: addDays(today, -daysAgo), points, games })

const positions = new Map<string, string | null>([
  ['hot', 'C'],
  ['steady', 'C'],
  ['dman', 'D'],
  ['goalie', 'G'],
])

/*
 * hot:    20 points 2 days ago — the best week, nothing before
 * steady: 6 points a game every other day for 60 days — the best season, middling week
 * dman:   4 points 3 and 5 days ago, 30 points 20 days ago
 * goalie: a 50-point game TODAY (live — must not count) and 9 points 40 days ago
 */
const days: DayPoints[] = [
  d('hot', 2, 20),
  ...Array.from({ length: 30 }, (_, i) => d('steady', 1 + i * 2, 6)),
  d('dman', 3, 4),
  d('dman', 5, 4),
  d('dman', 20, 30),
  d('goalie', 0, 50),
  d('goalie', 40, 9),
]

describe('computeWindowRanks', () => {
  const t = computeWindowRanks({ sport: 'NHL', today, days, positions })

  it('last 7: total points in the seven days before today', () => {
    // The window is the 7 days before today, 2026-11-21 through 2026-11-27: steady's games 1, 3, 5 and 7 days ago.
    const s = playerWindowRanks(t, 'steady').windows[0]
    expect(s.games).toBe(4) // 1, 3, 5, 7 days ago
    expect(s.points).toBe(24)
    expect(s.rank).toBe(1)
    expect(playerWindowRanks(t, 'hot').windows[0]).toMatchObject({ rank: 2, points: 20, games: 1, perGame: 20 })
    expect(playerWindowRanks(t, 'dman').windows[0]).toMatchObject({ rank: 3, positionRank: 1, points: 8 })
    expect(t.windows.d7.population).toBe(3)
  })

  it("today's games are not in any window (they may be live)", () => {
    const g = playerWindowRanks(t, 'goalie').windows
    expect(g[0].rank).toBeNull() // only today's game in the last 7
    expect(g[3]).toMatchObject({ points: 9, games: 1 }) // the season has the 40-days-ago game only
  })

  it('last 30 and season differ when the history is older than 30 days', () => {
    const steady = playerWindowRanks(t, 'steady').windows
    expect(steady[2]).toMatchObject({ points: 90, games: 15 }) // 1..29 days ago, every other day
    expect(steady[3]).toMatchObject({ points: 180, games: 30, rank: 1 })
    expect(playerWindowRanks(t, 'dman').windows[2]).toMatchObject({ points: 38, rank: 2 })
  })

  it('position rank is within his position; ties share a rank', () => {
    const tie = computeWindowRanks({ sport: 'NHL', today, days: [d('a', 1, 5), d('b', 1, 5), d('c', 1, 3)], positions: new Map([['a', 'C'], ['b', 'LW'], ['c', 'C']]) })
    expect(playerWindowRanks(tie, 'a').windows[0]).toMatchObject({ rank: 1, positionRank: 1 })
    expect(playerWindowRanks(tie, 'b').windows[0]).toMatchObject({ rank: 1, positionRank: 1 })
    expect(playerWindowRanks(tie, 'c').windows[0]).toMatchObject({ rank: 3, positionRank: 2 })
  })

  it('a player with no game in a window is unranked there, never ranked last', () => {
    expect(playerWindowRanks(t, 'nobody').windows.every((w) => w.rank == null && w.games === 0)).toBe(true)
  })
})

describe('rankPosition', () => {
  it('folds feed spellings and multi-position strings to one NHL position', () => {
    expect(rankPosition('NHL', 'L')).toBe('LW')
    expect(rankPosition('NHL', 'RW/C')).toBe('RW')
    expect(rankPosition('NHL', 'Defense')).toBe('D')
    expect(rankPosition('NHL', 'Goalie')).toBe('G')
    expect(rankPosition('NBA', 'PG,SG')).toBe('PG')
    expect(rankPosition('NHL', null)).toBe('—')
  })
})
