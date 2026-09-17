import { describe, expect, it } from 'vitest'
import { readPlayoffFormat } from '@/lib/core-app/outlookFormat'

/*
 * 🛑 THE OLD READER LOOKED FOR `settings.playoff.playoffTeams`, WHICH NO IMPORT WRITES. Every shape
 * below is copied from a real league on the production copy (2026-09-17), and each one used to fall
 * through to the six-team default.
 */
describe('readPlayoffFormat', () => {
  it('reads the Sleeper flat key — an eight-team field in a sixteen-team league', () => {
    const f = readPlayoffFormat({ playoff_teams: 8, playoffSettings: { playoffTeams: 8, playoffStartWeek: 15 } }, 16)
    expect(f).toMatchObject({ playoffTeams: 8, playoffTeamsSource: 'league', byeTeams: 0, byeSource: 'standard', regularSeasonEndWeek: 14 })
  })

  it('reads a native league: explicit byes and the regular-season end', () => {
    const f = readPlayoffFormat(
      {
        playoffSettings: { playoffTeams: 6, first_round_byes: 2, regularSeasonEndWeek: 14, playoffStartWeek: 15 },
        playoff_team_count: 6,
      },
      12,
    )
    expect(f).toMatchObject({ playoffTeams: 6, byeTeams: 2, byeSource: 'league', regularSeasonEndWeek: 14 })
  })

  it('gives a six-team Sleeper field its two standard byes', () => {
    expect(readPlayoffFormat({ playoff_teams: 6 }, 12)).toMatchObject({ byeTeams: 2, byeSource: 'standard' })
  })

  it('honours a league that says it has no byes', () => {
    expect(readPlayoffFormat({ playoffSettings: { playoffTeams: 6, topSeedByes: false } }, 12)).toMatchObject({
      byeTeams: 0,
      byeSource: 'league',
    })
  })

  it('prefers the provider key over the normalizer block, which can hold a format default', () => {
    expect(readPlayoffFormat({ playoff_teams: 4, playoffSettings: { playoffTeams: 6 } }, 10).playoffTeams).toBe(4)
  })

  it('falls back to six, and says so, when nothing is stated — never to a field larger than the league', () => {
    expect(readPlayoffFormat({}, 12)).toMatchObject({ playoffTeams: 6, playoffTeamsSource: 'default' })
    expect(readPlayoffFormat(null, 4)).toMatchObject({ playoffTeams: 4, playoffTeamsSource: 'default' })
    expect(readPlayoffFormat({ playoff_teams: 20 }, 12)).toMatchObject({ playoffTeams: 6, playoffTeamsSource: 'default' })
  })

  it('derives the last regular week from the playoff start when only that is stated', () => {
    expect(readPlayoffFormat({ playoff_week_start: 15 }, 12).regularSeasonEndWeek).toBe(14)
    expect(readPlayoffFormat({}, 12).regularSeasonEndWeek).toBeNull()
  })
})
