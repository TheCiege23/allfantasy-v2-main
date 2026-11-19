import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  seasonFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  rosterCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: mocks.seasonFindFirst },
    redraftRoster: { findMany: mocks.rosterFindMany, count: mocks.rosterCount },
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
    // Unreadable count: the reader falls back to the rows it has, as before.
    mocks.rosterCount.mockRejectedValue(new Error('count unavailable'))
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
    expect(out).toContain('First')
    expect(out).toContain('Third')
    expect(out!.indexOf('First')).toBeLessThan(out!.indexOf('Third'))
  })

  /*
   * 2026-11-15: "who is the best team and why?" got a bare name, and the real story — the leader
   * was not the top scorer — only came on a follow-up. The tool now says it outright.
   */
  it('ranks PF/PA and says when the standings leader is not the top scorer', async () => {
    mocks.rosterFindMany.mockResolvedValue([
      roster({ ownerId: 'a', teamName: 'Leader', wins: 5, losses: 1, pointsFor: 679, pointsAgainst: 647, playoffSeed: 1 }),
      roster({ ownerId: 'b', teamName: 'Scorer', wins: 3, losses: 3, pointsFor: 791, pointsAgainst: 765, playoffSeed: 2 }),
      roster({ ownerId: 'c', teamName: 'Middle', wins: 3, losses: 3, pointsFor: 741, pointsAgainst: 716, playoffSeed: 3 }),
    ])
    const out = await buildLeagueStandingsContext('lg1', 'a')
    expect(out).toContain('PF 679.0 (#3)')
    expect(out).toContain('PA 765.0 (#1)')
    expect(out).toContain('Most points scored: Scorer (791.0 PF).')
    expect(out).toContain('The standings leader, Leader, is NOT the top scorer — #3 in points for.')
    expect(out).toContain('Toughest schedule so far: Scorer')
  })

  it('gives no ranks or key facts on a truncated list, where a rank would be a guess', async () => {
    mocks.rosterCount.mockResolvedValue(50)
    mocks.rosterFindMany.mockResolvedValue([
      roster({ ownerId: 'a', teamName: 'Leader', wins: 5, pointsFor: 679, playoffSeed: 1 }),
      roster({ ownerId: 'b', teamName: 'Scorer', wins: 3, pointsFor: 791, playoffSeed: 2 }),
    ])
    const out = await buildLeagueStandingsContext('lg1', 'a')
    expect(out).toContain('ONLY 2 of those 50 teams')
    expect(out).not.toContain('KEY FACTS')
    expect(out).not.toMatch(/PF 679\.0 \(#/)
  })

  it('includes both of a manager’s teams at opposite ends of a 250-team league', async () => {
    mocks.rosterCount.mockResolvedValue(250)
    mocks.rosterFindMany.mockResolvedValue(Array.from({ length: 250 }, (_, index) => roster({
      ownerId: index === 0 ? 'viewer' : 'seat-' + index,
      managerUserId: index === 249 ? 'viewer' : null,
      teamName: 'Franchise ' + (index + 1), wins: 1, pointsFor: 250 - index,
    })))
    const out = await buildLeagueStandingsContext('lg1', 'viewer')
    expect(mocks.rosterFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 250 }))
    expect(out).toContain('THIS USER manages Franchise 1:')
    expect(out).toContain('THIS USER manages Franchise 250:')
    expect(out).not.toContain('truncated view')
  })

  it('returns null when the league has no redraft season on file', async () => {
    mocks.seasonFindFirst.mockResolvedValue(null)
    expect(await buildLeagueStandingsContext('lg1', 'user-1')).toBeNull()
    expect(mocks.rosterFindMany).not.toHaveBeenCalled()
  })
})
