/**
 * Seasons are keyed by the calendar year they BEGIN (a 2026-27 season is `2026`). Only MLB was
 * adjusted at league creation, so an NBA/NHL league created January–March 2027 was stamped 2027 —
 * next October's season — instead of the 2026 season being played. And MLB had no end date past
 * 2027, so a league created after the 2028 season ended was stamped with that finished season.
 */
import { describe, expect, it } from 'vitest'
import { resolveLeagueCreationSeason } from '@/lib/season-week/leagueCreationSeason'

describe('split-year sports join the season in progress', () => {
  it.each([
    ['NBA', '2027-01-15T17:00:00Z', 2026],
    ['NBA', '2027-03-31T17:00:00Z', 2026],
    ['NBA', '2027-04-20T17:00:00Z', 2027], // regular season over → next season
    ['NBA', '2026-11-10T17:00:00Z', 2026],
    ['NHL', '2027-02-01T17:00:00Z', 2026],
    ['NHL', '2027-07-01T17:00:00Z', 2027],
    ['NCAAB', '2027-02-10T17:00:00Z', 2026],
    ['SOCCER', '2027-04-10T17:00:00Z', 2026],
    ['SOCCER', '2027-06-10T17:00:00Z', 2027],
  ])('%s created at %s is season %i', (sport, instant, season) => {
    expect(resolveLeagueCreationSeason(sport, new Date(instant))).toBe(season)
  })

  it('uses the US Eastern date at the year boundary', () => {
    // 03:00Z on 1 Jan is still 31 December in New York.
    expect(resolveLeagueCreationSeason('NBA', new Date('2027-01-01T03:00:00Z'))).toBe(2026)
    expect(resolveLeagueCreationSeason('NBA', new Date('2027-04-01T04:30:00Z'))).toBe(2027)
  })
})

describe('MLB past the published end dates', () => {
  it.each([
    ['2028-09-25T03:59:59Z', 2028], // 23:59 Eastern on Sun 24 Sep, the last Sunday of September 2028
    ['2028-09-25T04:00:00Z', 2029],
    ['2028-11-15T12:00:00Z', 2029],
  ])('MLB at %s is season %i', (instant, season) => {
    expect(resolveLeagueCreationSeason('MLB', new Date(instant))).toBe(season)
  })
})
