import { describe, expect, it } from 'vitest'
import type { ClassLogRow } from '@/lib/class-rating/classView'
import { groupClassWeeks, weekRecord } from '@/lib/class-rating/weekLog'

/*
 * The Class log groups league-week rows into rated WEEKS. Before this, a manager in many leagues
 * saw one card per league, every one carrying the same week total — measured on production data,
 * 25 cards all reading "2026 wk 3 · +20".
 */

function row(over: Partial<ClassLogRow>): ClassLogRow {
  return {
    leagueId: 'l1',
    leagueName: 'League',
    season: 2026,
    week: 3,
    pointsFor: 100,
    allPlayWins: 5,
    allPlayGames: 11,
    opponentLabel: null,
    opponentClassNow: null,
    result: 'W',
    pointsAgainst: 90,
    weekChange: 20,
    leagueShare: 2,
    ratingAfter: 1455,
    ...over,
  }
}

describe('groupClassWeeks', () => {
  it('states a week once, sums what moved it, and keeps every league as a share', () => {
    const weeks = groupClassWeeks([
      row({ leagueId: 'a', leagueName: 'A', allPlayWins: 8, allPlayGames: 11, result: 'W', leagueShare: 12 }),
      row({ leagueId: 'b', leagueName: 'B', allPlayWins: 2.5, allPlayGames: 13, result: 'L', leagueShare: 5 }),
      row({ leagueId: 'c', leagueName: 'C', allPlayWins: 6, allPlayGames: 11, result: 'T', leagueShare: 3 }),
    ])
    expect(weeks).toHaveLength(1)
    const [w] = weeks
    expect(w.change).toBe(20)
    expect(w.ratingAfter).toBe(1455)
    expect(w.allPlayWins).toBe(16.5)
    expect(w.allPlayGames).toBe(35)
    expect(weekRecord(w)).toBe('1-1-1')
    expect(w.leagues.map((l) => l.leagueId)).toEqual(['a', 'b', 'c'])
    expect(w.leagues.reduce((s, l) => s + l.leagueShare, 0)).toBe(w.change)
  })

  it('orders weeks newest first across a season boundary', () => {
    const weeks = groupClassWeeks([
      row({ season: 2025, week: 18, leagueId: 'x' }),
      row({ season: 2026, week: 1, leagueId: 'y' }),
      row({ season: 2025, week: 17, leagueId: 'z' }),
    ])
    expect(weeks.map((w) => w.key)).toEqual(['2026-1', '2025-18', '2025-17'])
  })

  it('puts the biggest move first in EITHER direction — a phone shows only the start of the list', () => {
    const [w] = groupClassWeeks([
      row({ leagueId: 'p1', leagueName: 'Plus one', leagueShare: 2 }),
      row({ leagueId: 'p2', leagueName: 'Plus two', leagueShare: 2 }),
      row({ leagueId: 'big', leagueName: 'The big loss', leagueShare: -6 }),
    ])
    expect(w.leagues[0].leagueId).toBe('big')
  })

  it('has no record when no league that week had a head-to-head result', () => {
    const [w] = groupClassWeeks([row({ result: null }), row({ leagueId: 'b', result: null })])
    expect(weekRecord(w)).toBeNull()
  })
})
