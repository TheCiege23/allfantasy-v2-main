import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  seasonFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: mocks.seasonFindFirst },
    redraftRoster: { findMany: mocks.rosterFindMany },
  },
}))

import { buildLeagueStandingsContext } from '@/lib/chimmy/leagueStandingsGrounding'

function roster(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: 'user-1',
    ownerName: 'Me',
    teamName: 'My Team',
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    streak: null,
    playoffSeed: 1,
    faabBalance: 100,
    isEliminated: false,
    ...overrides,
  }
}

describe('buildLeagueStandingsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.seasonFindFirst.mockResolvedValue({ id: 'season-1', season: 2026 })
    mocks.rosterFindMany.mockResolvedValue([roster()])
  })

  /*
   * The current state of almost every league on the platform: 984 of 986 rosters
   * carry no result at all because Week 1 has not happened.
   */
  it('refuses to present standings before any game has been played', async () => {
    const out = await buildLeagueStandingsContext('lg1', 'user-1')

    expect(out).toContain('NO GAMES HAVE BEEN PLAYED YET')
    expect(out).toMatch(/do NOT describe standings/i)
    expect(out).not.toContain('Standings (use ONLY these numbers')
  })

  it('still surfaces the pre-season facts that are known', async () => {
    const out = await buildLeagueStandingsContext('lg1', 'user-1')

    expect(out).toContain('FAAB budgets')
    expect(out).toContain('This user manages My Team')
  })

  it('renders the table once results exist', async () => {
    mocks.rosterFindMany.mockResolvedValue([
      roster({ wins: 2, losses: 1, pointsFor: 310.5, pointsAgainst: 288.25, streak: 'W2', playoffSeed: 2 }),
      roster({
        ownerId: 'user-2',
        ownerName: 'Rival',
        teamName: 'Rival FC',
        wins: 3,
        losses: 0,
        pointsFor: 350.75,
        playoffSeed: 1,
      }),
    ])

    const out = await buildLeagueStandingsContext('lg1', 'user-1')

    expect(out).toContain('Standings (use ONLY these numbers')
    expect(out).toContain('Rival FC')
    expect(out).toContain('2-1')
    expect(out).toContain('streak W2')
  })

  it('marks which team belongs to the asking user', async () => {
    mocks.rosterFindMany.mockResolvedValue([
      roster({ wins: 2, losses: 1, pointsFor: 310.5 }),
      roster({ ownerId: 'user-2', ownerName: 'Rival', teamName: 'Rival FC', wins: 3, pointsFor: 350 }),
    ])

    const out = await buildLeagueStandingsContext('lg1', 'user-1')

    expect(out).toContain('← THIS USER')
    expect(out).toContain('THIS USER manages My Team')
  })

  /* Otherwise a model picks a roster and narrates it as the user's own. */
  it('says outright when the asker holds no team here', async () => {
    mocks.rosterFindMany.mockResolvedValue([
      roster({ ownerId: 'someone-else', ownerName: 'Rival', wins: 1, pointsFor: 100 }),
    ])

    const out = await buildLeagueStandingsContext('lg1', 'nobody')

    expect(out).toMatch(/does not hold a team in this league/i)
  })

  it('orders by playoff seed when one is set', async () => {
    mocks.rosterFindMany.mockResolvedValue([
      roster({ ownerId: 'a', teamName: 'Third', wins: 1, pointsFor: 100, playoffSeed: 3 }),
      roster({ ownerId: 'b', teamName: 'First', wins: 3, pointsFor: 300, playoffSeed: 1 }),
    ])

    const out = await buildLeagueStandingsContext('lg1', 'a')
    expect(out.indexOf('First')).toBeLessThan(out.indexOf('Third'))
  })

  it('returns null when the league has no redraft season on file', async () => {
    mocks.seasonFindFirst.mockResolvedValue(null)
    expect(await buildLeagueStandingsContext('lg1', 'user-1')).toBeNull()
    expect(mocks.rosterFindMany).not.toHaveBeenCalled()
  })
})
