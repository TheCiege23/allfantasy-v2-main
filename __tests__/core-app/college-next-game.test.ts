// @vitest-environment node
/**
 * College fixtures are joined through the CFBD directory on BOTH sides.
 *
 * Measured on production 2026-09-30: the week's NCAAF game rows spell teams four ways at
 * once (`MISSISSIPPI STATE` api_sports, `Rutgers` cfbd, `UNLV` thesportsdb, `LSU Tigers`
 * espn), while a Fantrax player carries a CFBD school or a Fantrax code (`wisc`). The NFL
 * fold (`normalizeTeamAbbrev`) turns "Miami" into the Dolphins, so it cannot be used.
 */
import { describe, expect, it } from 'vitest'
import { buildCollegeTeamIndex, type CollegeTeamRecord } from '@/lib/sport-teams/collegeTeamIdentity'
import { collegeFixturesByPlayerTeam } from '@/lib/core-app/collegeNextGame'
import { buildNextGameMap, type FixtureRow } from '@/lib/core-app/nextGameMap'

const TEAMS: CollegeTeamRecord[] = [
  { id: 275, school: 'Wisconsin', mascot: 'Badgers', abbreviation: 'WIS' },
  { id: 164, school: 'Rutgers', mascot: 'Scarlet Knights', abbreviation: 'RUTG' },
  { id: 344, school: 'Mississippi State', mascot: 'Bulldogs', abbreviation: 'MSST' },
  { id: 99, school: 'LSU', mascot: 'Tigers', abbreviation: 'LSU' },
  { id: 2390, school: 'Miami', mascot: 'Hurricanes', abbreviation: 'MIA' },
  { id: 193, school: 'Miami (OH)', mascot: 'RedHawks', abbreviation: 'M-OH' },
  { id: 2439, school: 'UNLV', mascot: 'Rebels', abbreviation: 'UNLV' },
  // Two schools claiming one alternate name: the directory drops it as ambiguous.
  { id: 1, school: 'Alpha Tech', alternateNames: ['Tech Wildcats'] },
  { id: 2, school: 'Beta Tech', alternateNames: ['Tech Wildcats'] },
]
const index = buildCollegeTeamIndex(TEAMS)

const SAT = new Date('2026-10-03T19:30:00Z')

function row(home: string, away: string, at = SAT, venue: string | null = null): FixtureRow {
  return { homeTeam: home, awayTeam: away, startTime: at, seasonType: 'regular', venue }
}

describe('collegeFixturesByPlayerTeam', () => {
  it('joins a Fantrax code to a CFBD-spelled fixture', () => {
    const out = collegeFixturesByPlayerTeam([row('Wisconsin', 'Rutgers', SAT, 'Camp Randall Stadium')], ['wisc'], index)
    expect(out.get('wisc')).toMatchObject({ team: 'Wisconsin', opponent: 'Rutgers', home: true, venue: 'Camp Randall Stadium' })
    expect(out.get('wisc')!.at).toEqual(SAT)
  })

  it('joins across the four feed spellings measured in production', () => {
    const games = [
      row('MISSISSIPPI STATE', 'UNLV'), // api_sports, uppercase school
      row('LSU Tigers', 'Rutgers Scarlet Knights'), // espn, school + mascot
    ]
    const out = collegeFixturesByPlayerTeam(games, ['Mississippi State', 'UNLV', 'LSU', 'Rutgers'], index)
    expect(out.get('Mississippi State')).toMatchObject({ opponent: 'UNLV', home: true })
    expect(out.get('UNLV')).toMatchObject({ opponent: 'Mississippi State', home: false })
    expect(out.get('LSU')).toMatchObject({ opponent: 'Rutgers', home: true })
    expect(out.get('Rutgers')).toMatchObject({ opponent: 'LSU', home: false })
  })

  it('⚠ keeps Miami (OH) and Miami apart', () => {
    const games = [row('Miami', 'Rutgers'), row('Miami (OH)', 'UNLV')]
    const out = collegeFixturesByPlayerTeam(games, ['miaoh', 'Miami'], index)
    expect(out.get('miaoh')).toMatchObject({ team: 'Miami (OH)', opponent: 'UNLV' })
    expect(out.get('Miami')).toMatchObject({ team: 'Miami', opponent: 'Rutgers' })
  })

  it('🛑 an ambiguous or unknown team joins nothing rather than borrowing a game', () => {
    const games = [row('Alpha Tech', 'Rutgers'), row('Wisconsin', 'LSU')]
    const out = collegeFixturesByPlayerTeam(games, ['Tech Wildcats', 'Nowhere State'], index)
    expect(out.size).toBe(0)
  })

  it('takes the earliest kickoff when several sources store the fixture', () => {
    const later = new Date(SAT.getTime() + 60 * 60 * 1000)
    const games = [row('Wisconsin Badgers', 'Rutgers', later), row('Wisconsin', 'Rutgers', SAT)]
    const out = collegeFixturesByPlayerTeam(games, ['Wisconsin'], index)
    expect(out.get('Wisconsin')!.at).toEqual(SAT)
  })
})

describe('buildNextGameMap default fold is unchanged for the NFL', () => {
  it('still folds NFL spellings onto the canonical abbreviation', () => {
    const out = buildNextGameMap([row('San Francisco 49ers', 'KC')], new Set(['SF', 'KC']))
    expect(out.get('SF')).toMatchObject({ opponent: 'KC', home: true })
    expect(out.get('KC')).toMatchObject({ opponent: 'SF', home: false })
  })
})
