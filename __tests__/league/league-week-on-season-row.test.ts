/**
 * Which leagues keep their current week on a `RedraftSeason` row, so the league shell loads it.
 *
 * It was loaded for football redraft only. An NBA redraft league and every dynasty league that plays on
 * AllFantasy never learned their week: League Home read "Week —" and "What's next?" read "Is underway".
 */
import { describe, expect, it } from 'vitest'
import { isNflRedraftCoreDashboardLeague, leagueWeekIsOnSeasonRow } from '@/lib/league/is-nfl-redraft-core-dashboard'

const league = (over: Record<string, unknown> = {}) => ({
  sport: 'NBA', leagueType: 'redraft', isDynasty: false, leagueVariant: null, bestBallMode: false, guillotineMode: false, keeperPhaseActive: false, platform: 'manual', ...over,
})

describe('leagueWeekIsOnSeasonRow', () => {
  it('🛑 an NBA redraft league that plays on AllFantasy, which is not the football redraft shell', () => {
    expect(isNflRedraftCoreDashboardLeague(league())).toBe(false)
    expect(leagueWeekIsOnSeasonRow(league())).toBe(true)
  })
  it('a dynasty, keeper or guillotine league that plays on AllFantasy, in any sport', () => {
    expect(leagueWeekIsOnSeasonRow(league({ sport: 'NFL', leagueType: 'dynasty', isDynasty: true }))).toBe(true)
    expect(leagueWeekIsOnSeasonRow(league({ sport: 'NHL', leagueType: 'keeper', keeperPhaseActive: true }))).toBe(true)
    expect(leagueWeekIsOnSeasonRow(league({ sport: 'NFL', guillotineMode: true }))).toBe(true)
    expect(leagueWeekIsOnSeasonRow(league({ platform: null }))).toBe(true)
  })
  it('a football redraft league, as before, wherever it plays', () => {
    expect(leagueWeekIsOnSeasonRow(league({ sport: 'NFL' }))).toBe(true)
    expect(leagueWeekIsOnSeasonRow(league({ sport: 'NFL', platform: 'sleeper' }))).toBe(true)
  })
  it('an imported league outside that shell keeps its week in its provider settings', () => {
    expect(leagueWeekIsOnSeasonRow(league({ platform: 'fantrax' }))).toBe(false)
    expect(leagueWeekIsOnSeasonRow(league({ sport: 'NFL', leagueType: 'dynasty', isDynasty: true, platform: 'sleeper' }))).toBe(false)
  })
})
