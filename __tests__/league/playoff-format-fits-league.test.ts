/**
 * The Standings screen draws the playoff format the bracket will actually run. A league's stored
 * playoff size can be larger than the league (a 4-team league created with the sport's default of 6):
 * the playoff runtime plays every team that exists, and the screen said "Teams 6 · 2 byes".
 */
import { describe, expect, it } from 'vitest'
import { fitPlayoffFormatToLeague, readPlayoffFormat } from '@/lib/league/native/nativeScreenModels'

const stored = (teams: number, byes: number) => readPlayoffFormat({ playoff_team_count: teams, first_round_byes: byes }, 23, null)

describe('fitPlayoffFormatToLeague', () => {
  it('a 4-team league with a stored size of 6: all four play, nobody has a bye, two rounds', () => {
    const f = fitPlayoffFormatToLeague(stored(6, 2), 4)
    expect([f.teams, f.byes, f.weeks, f.startWeek]).toEqual([4, 0, 2, 23])
  })
  it('a 5-team league with a stored size of 6: five play, three byes fill the bracket of eight', () => {
    const f = fitPlayoffFormatToLeague(stored(6, 2), 5)
    expect([f.teams, f.byes, f.weeks]).toEqual([5, 3, 3])
  })
  it('🛑 a format that fits the league is returned untouched', () => {
    const six = stored(6, 2)
    expect(fitPlayoffFormatToLeague(six, 12)).toBe(six)
    expect(fitPlayoffFormatToLeague(six, 6)).toBe(six)
    expect(fitPlayoffFormatToLeague(stored(12, 4), 160)).toMatchObject({ teams: 12, byes: 4 })
  })
  it('an unknown league size, or a league with no stored size, is left alone', () => {
    const six = stored(6, 2)
    expect(fitPlayoffFormatToLeague(six, null)).toBe(six)
    expect(fitPlayoffFormatToLeague(six, 0)).toBe(six)
    const none = readPlayoffFormat({}, null, null)
    expect(fitPlayoffFormatToLeague(none, 4)).toBe(none)
  })
})
