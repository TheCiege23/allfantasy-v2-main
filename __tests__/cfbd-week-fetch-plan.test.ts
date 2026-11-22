/**
 * 🛑 THE COLLEGE FOOTBALL STAT SYNC SPENT THE PROVIDER'S MONTHLY QUOTA ON CALLS THAT COULD NOT CHANGE.
 *
 * It asked CollegeFootballData for all 15 weeks every 6 hours: 16 calls a run, about 1,900 a month.
 * On 2026-11-10 the monthly quota ran out and college football stats, devy pools and college rosters
 * stopped. A week that has not kicked off has nothing to fetch, and a settled, written week never
 * changes again.
 */
import { describe, expect, it } from 'vitest'
import { appearancesOfWeek, decideWeekFetch, gamesPlayedFrom, verifiedSeasonAppearances, readWeekAppearances, weekAppearancesKey } from '@/lib/stats/cfbdWeekFetchPlan'

const game = (id: number, athleteIds: Array<number | string>) => ({
  id,
  teams: [{ categories: [{ types: [{ athletes: athleteIds.map((a) => ({ id: a })) }] }] }],
})

describe('decideWeekFetch', () => {
  it('🛑 a settled week already kept is never asked for again', () => {
    expect(decideWeekFetch({ isComplete: true, hasStarted: true, cached: true })).toBe('cached')
  })
  it('a week that has not kicked off is not asked for', () => {
    expect(decideWeekFetch({ isComplete: false, hasStarted: false, cached: false })).toBe('not_started')
  })
  it('a week in play is asked for every run, kept or not, so late games and corrections land', () => {
    expect(decideWeekFetch({ isComplete: false, hasStarted: true, cached: false })).toBe('fetch')
    expect(decideWeekFetch({ isComplete: false, hasStarted: true, cached: true })).toBe('fetch')
  })
  it('a settled week with nothing kept yet is asked for once more, which fills the store', () => {
    expect(decideWeekFetch({ isComplete: true, hasStarted: true, cached: false })).toBe('fetch')
  })
  it('the season this was found in: 10 weeks settled and kept, week 11 in play, 12-15 to come', () => {
    const decisions = Array.from({ length: 15 }, (_, i) => i + 1).map((week) =>
      decideWeekFetch({ isComplete: week <= 10, hasStarted: week <= 11, cached: week <= 10 }),
    )
    expect(decisions.filter((d) => d === 'fetch').length).toBe(1)
    expect(decisions.filter((d) => d === 'cached').length).toBe(10)
    expect(decisions.filter((d) => d === 'not_started').length).toBe(4)
  })
})

describe('games played from kept and fetched weeks', () => {
  it('a week’s payload becomes player -> games', () => {
    expect(appearancesOfWeek([game(1, [10, 11]), game(2, [10])])).toEqual({ '10': ['1', '2'], '11': ['1'] })
  })
  it('counts distinct games across weeks, the same answer whether a week was fetched or kept', () => {
    const week1 = appearancesOfWeek([game(1, [10, 11])])
    const week2 = appearancesOfWeek([game(2, [10])])
    const kept = readWeekAppearances(JSON.parse(JSON.stringify(week1)))!
    const counts = gamesPlayedFrom([kept, week2])
    expect([counts.get('10'), counts.get('11')]).toEqual([2, 1])
    // A game seen twice is one game.
    expect(gamesPlayedFrom([week1, week1]).get('10')).toBe(1)
  })
  it('a malformed payload or a kept value in another shape is no appearances, never a throw', () => {
    expect(appearancesOfWeek(null)).toEqual({})
    expect(appearancesOfWeek([{ id: 1 }, { teams: [{}] }, null])).toEqual({})
    expect(readWeekAppearances(['x'])).toBeNull()
    expect(readWeekAppearances({ '10': 'not-a-list' })).toBeNull()
  })
  it('one key per season and week', () => {
    expect(weekAppearancesKey(2026, 10)).toBe('cfbd:games-players:appearances:2026:10')
  })
})

describe('verified school participation', () => {
  const weeks = new Map([[10, { '21': ['first'] }], [12, { '21': ['first', 'later'] }]])
  const receipt = { playerId: '21', gamesPlayed: 5, throughWeek: 11, sourceUrl: 'https://example.edu/football/stats/2026' }

  it('adds newly observed games beyond the school reporting period once', () => {
    expect(verifiedSeasonAppearances(weeks, [receipt], 12).get('21')).toBe(6)
  })

  it('keeps the observed count for an unverified or future receipt', () => {
    expect(verifiedSeasonAppearances(weeks, [{ ...receipt, sourceUrl: '' }], 12).get('21')).toBe(2)
    expect(verifiedSeasonAppearances(weeks, [receipt], 10).get('21')).toBe(2)
  })
})
