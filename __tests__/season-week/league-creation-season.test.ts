import { describe, expect, it } from 'vitest'
import { resolveLeagueCreationSeason } from '@/lib/season-week/leagueCreationSeason'

describe('new league season assignment', () => {
  it.each([
    ['2026-03-25T12:00:00Z', 2026],
    ['2026-09-28T03:59:59Z', 2026],
    ['2026-09-28T04:00:00Z', 2027],
    ['2026-10-03T12:00:00Z', 2027],
    ['2027-09-27T03:59:59Z', 2027],
    ['2027-09-27T04:00:00Z', 2028],
  ])('assigns MLB at %s to season %s', (instant, season) => {
    expect(resolveLeagueCreationSeason('MLB', new Date(instant))).toBe(season)
  })
  it('preserves the existing calendar season for other sports', () => {
    expect(resolveLeagueCreationSeason('NFL', new Date('2026-10-03T12:00:00Z'))).toBe(2026)
  })
})
