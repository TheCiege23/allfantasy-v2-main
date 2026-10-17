// @vitest-environment node
/**
 * College football follows read CFBD's stored directory, not `sports_core_teams` (2026-10-03). The
 * fixture rows are real directory entries as production holds them — including CFBD's habit of
 * mixing codes into `alternateNames` ("AAMU", "UL"), which must never become exact matches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  directory: null as unknown,
  coreQueried: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) =>
        where.cacheKey === 'college-team-directory:v1' && h.directory != null ? { data: h.directory } : null,
    },
    $queryRaw: async () => {
      h.coreQueried++
      return [{ abbr: 'SDSU', name: 'South Dakota State University' }]
    },
  },
}))

import { __resetTeamCacheForTests, getTeamIndex, listTeamsForSport } from '@/lib/follows/teamFollows'
import { buildTeamIndex, resolveTeam, type CanonicalTeam } from '@/lib/follows/teamResolver'
import { detectScoreEvents, type GameRow } from '@/lib/follows/teamScoreAlerts'

const D = (abbreviation: string | null, school: string, mascot: string, classification: string | null, alternateNames: string[]) => ({
  id: Math.floor(Math.random() * 1e6),
  school,
  mascot,
  abbreviation,
  alternateNames,
  classification,
})

const DIRECTORY = [
  D('ALA', 'Alabama', 'Crimson Tide', 'fbs', ['ALA', 'Alabama']),
  D('AAMU', 'Alabama A&M', 'Bulldogs', 'fcs', ['AAMU', 'Alabama A&M']),
  D('MIA', 'Miami', 'Hurricanes', 'fbs', ['Miami (FL)', 'MIA', 'Miami']),
  D('M-OH', 'Miami (OH)', 'RedHawks', 'fbs', ['M-OH', 'Miami OH']),
  D('SDSU', 'San Diego State', 'Aztecs', 'fbs', ['SDSU', 'San Diego St']),
  D('SDST', 'South Dakota State', 'Jackrabbits', 'fcs', ['SDST', 'S Dakota St']),
  D('SOU', 'Southern', 'Jaguars', 'fcs', ['SOU', 'Southern']),
  D('USM', 'Southern Miss', 'Golden Eagles', 'fbs', ['Southern Mississippi', 'USM', 'Southern Miss']),
  D('UL', 'Louisiana', "Ragin' Cajuns", 'fbs', ['UL Lafayette', 'UL', 'Louisiana']),
  D('GWEB', 'Gardner-Webb', "Runnin' Bulldogs", 'fcs', ['Gardner Webb', 'GWEB', 'Gardner-Webb']),
  D('UTU', 'Utah Tech', 'Trailblazers', 'fcs', ['Dixie State', 'UTU', 'Utah Tech']),
  D('RGV', 'UT Rio Grande Valley', 'Vaqueros', 'fcs', ['RGV']),
  D('MERC', 'Mercyhurst', 'Lakers', 'fcs', ['MERC', 'Mercyhurst']),
  D('TOL', 'Toledo', 'Rockets', 'fbs', ['TOL', 'Toledo']),
  // Outside FBS/FCS, or unusable: never followable.
  D('SAU', 'Southern Arkansas', 'Muleriders', 'ii', ['SAU']),
  D('GCC', 'Grove City', 'Wolverines', 'iii', []),
  D(null, 'Nameless FCS', 'Nobodies', 'fcs', []),
  D('XX', 'Unclassified', 'Ghosts', null, []),
]

beforeEach(() => {
  __resetTeamCacheForTests()
  h.directory = DIRECTORY
  h.coreQueried = 0
})

describe('the college football team list', () => {
  it('is FBS + FCS from CFBD’s directory, A–Z, and never reads sports_core_teams', async () => {
    const teams = await listTeamsForSport('NCAAF')
    expect(teams.map((t) => t.abbr)).toEqual(['ALA', 'AAMU', 'GWEB', 'UL', 'MERC', 'MIA', 'M-OH', 'SDSU', 'SDST', 'SOU', 'USM', 'TOL', 'RGV', 'UTU'])
    expect(teams.find((t) => t.abbr === 'SDSU')?.name).toBe('San Diego State')
    expect(h.coreQueried).toBe(0)
  })

  it('a missing directory makes college follows unavailable — no fallback to a list with other codes', async () => {
    h.directory = null
    expect(await listTeamsForSport('NCAAF')).toEqual([])
    expect(h.coreQueried).toBe(0)
  })

  it('other sports still read sports_core_teams', async () => {
    await listTeamsForSport('NCAAB')
    expect(h.coreQueried).toBe(1)
  })
})

describe('resolving against CFBD names', () => {
  const S = { exactNames: true, noPrefix: true }
  const E = { exactNames: true }
  let index: Awaited<ReturnType<typeof getTeamIndex>>
  beforeEach(async () => {
    index = await getTeamIndex('NCAAF')
  })

  it('the schools the old list could not match now resolve by the names feeds write', () => {
    expect(resolveTeam(index!, 'Alabama A&M', S)).toBe('AAMU')
    expect(resolveTeam(index!, 'ALABAMA A&M', S)).toBe('AAMU')
    expect(resolveTeam(index!, 'Alabama A and M', S)).toBe('AAMU')
    expect(resolveTeam(index!, 'Gardner-Webb', S)).toBe('GWEB')
    expect(resolveTeam(index!, 'Mercyhurst', S)).toBe('MERC')
    expect(resolveTeam(index!, 'UTRGV', S)).toBe('RGV')
  })

  it('alternate names count: "Miami (FL)", "Miami OH", "UL Lafayette", "Dixie State", "Gardner Webb"', () => {
    expect(resolveTeam(index!, 'Miami (FL)', S)).toBe('MIA')
    expect(resolveTeam(index!, 'Miami OH', S)).toBe('M-OH')
    expect(resolveTeam(index!, 'UL Lafayette', S)).toBe('UL')
    expect(resolveTeam(index!, 'Dixie State', S)).toBe('UTU')
    expect(resolveTeam(index!, 'Gardner Webb', S)).toBe('GWEB')
  })

  it('codes inside alternateNames never match exactly — CFBD "SDSU" and a feed’s "SDSU" need not agree', () => {
    for (const code of ['SDSU', 'SDST', 'UL', 'AAMU', 'RGV']) expect(resolveTeam(index!, code, S), code).toBeNull()
  })

  it('San Diego State and South Dakota State land on CFBD’s codes', () => {
    expect(resolveTeam(index!, 'San Diego State', S)).toBe('SDSU')
    expect(resolveTeam(index!, 'San Diego State Aztecs', E)).toBe('SDSU')
    expect(resolveTeam(index!, 'South Dakota State', S)).toBe('SDST')
    expect(resolveTeam(index!, 'South Dakota State Jackrabbits', E)).toBe('SDST')
  })

  it('a schedule prefix must carry the school’s mascot — a D-II "Southern Arkansas" is not Southern', () => {
    expect(resolveTeam(index!, 'Southern Jaguars', E)).toBe('SOU')
    expect(resolveTeam(index!, 'Southern Miss Golden Eagles', E)).toBe('USM')
    expect(resolveTeam(index!, 'Southern Arkansas Muleriders', E)).toBeNull()
    expect(resolveTeam(index!, "Gardner-Webb Runnin' Bulldogs", E)).toBe('GWEB')
    expect(resolveTeam(index!, "Louisiana Ragin' Cajuns", E)).toBe('UL')
  })

  it('news keeps its rules: no bare one-word school, and a prefix needs no mascot match', () => {
    expect(resolveTeam(index!, 'Alabama')).toBeNull()
    // …but a full name with its wrapper is still a school name (1 production news row read this way).
    expect(resolveTeam(index!, 'UNIVERSITY OF ALABAMA')).toBe('ALA')
    expect(resolveTeam(index!, 'The University of Toledo')).toBe('TOL')
    // Only LEADING wrappers: "Miami University" is Miami (OH)'s official name, never the Hurricanes.
    expect(resolveTeam(index!, 'Miami University', { exactNames: true, noPrefix: true })).not.toBe('MIA')
    expect(resolveTeam(index!, 'ALABAMA CRIMSON TIDE')).toBe('ALA')
    expect(resolveTeam(index!, 'Alabama Football')).toBe('ALA')
  })

  it('an alternate name two schools claim is dropped, never guessed', () => {
    const teams: CanonicalTeam[] = [
      { abbr: 'AAA', name: 'Alpha State', aliases: ['Twin Name'] },
      { abbr: 'BBB', name: 'Beta State', aliases: ['Twin Name', 'Beta St'] },
    ]
    const i = buildTeamIndex('NCAAF', teams)
    expect(resolveTeam(i, 'Twin Name', S)).toBeNull()
    expect(resolveTeam(i, 'Beta St', S)).toBe('BBB')
  })

  it('end to end: Toledo vs San Diego State across feeds is ONE game with the right opponent', () => {
    const KICK = new Date('2026-09-26T19:00:00Z')
    const row = (o: Partial<GameRow>): GameRow => ({
      sport: 'NCAAF', source: 'cfbd', homeTeam: 'Toledo', awayTeam: 'San Diego State', homeScore: 41, awayScore: 16,
      status: 'completed', startTime: KICK, raw: null, ...o,
    })
    const ev = detectScoreEvents(
      [
        row({}),
        row({ source: 'espn_live', homeTeam: 'Toledo Rockets', awayTeam: 'SDSU', status: 'final' }),
        row({ source: 'thesportsdb', homeTeam: 'Toledo', awayTeam: 'San Diego St', status: 'Match Finished' }),
      ],
      new Map([['NCAAF', index!]]),
      new Date('2026-09-26T23:30:00Z'),
    )
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ home: 'TOL', away: 'SDSU', homeScore: 41, awayScore: 16 })
  })
})
