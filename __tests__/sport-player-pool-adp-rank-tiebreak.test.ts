import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sportsPlayerFindManyMock = vi.fn()
const adpSnapshotFindManyMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: sportsPlayerFindManyMock,
    },
    allFantasyAdpSnapshot: {
      findMany: adpSnapshotFindManyMock,
    },
    playerIdentityMap: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('@/lib/sport-teams/SportTeamMetadataRegistry', () => ({
  getTeamIdByAbbreviationMap: () => new Map(),
}))

vi.mock('@/lib/redraft/teamDefenseIdentity', () => ({
  formatNflTeamDefenseName: (abbr: string) => `${abbr} Defense`,
}))

vi.mock('@/lib/multi-sport/SportConfigResolver', () => ({
  leagueSportToSportType: (s: string) => s,
}))

function nflRow(overrides: Partial<{ id: string; name: string; position: string; team: string }>) {
  return {
    id: overrides.id ?? 'x',
    name: overrides.name ?? 'X',
    position: overrides.position ?? 'RB',
    team: overrides.team ?? 'AAA',
    sport: 'NFL',
    sleeperId: null,
    imageUrl: null,
    status: null,
    age: null,
    externalId: null,
    teamId: null,
  }
}

// Phase 28: reproduces the exact Phase 27 finding. Alphabetical tiebreak WITHIN
// the ADP-relevant tier can still exclude a late-alphabet real star at a
// constrained limit, even though it's more fantasy-relevant (lower ADP) than
// early-alphabet ADP-tier players ahead of it. Measured in production: at
// limit:250 (Waiver's typical shape), Saquon Barkley (real ADP ~2) was
// excluded while alphabetically-earlier, lower-relevance ADP players filled
// the budget first.
describe('getPlayerPoolForSport — ADP-rank tiebreak (Phase 28)', () => {
  beforeEach(() => {
    vi.resetModules()
    sportsPlayerFindManyMock.mockReset()
    adpSnapshotFindManyMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not exclude a real top-ADP late-alphabet star at a constrained limit', async () => {
    // 4 early-alphabet ADP-tier players with WORSE (higher/later) ADP than the star.
    const earlyAlphabetLowerRelevance = Array.from({ length: 4 }, (_, i) =>
      nflRow({ id: `early-${i}`, name: `Aaron Early${i}`, position: 'RB' })
    )
    const star = nflRow({ id: 'star', name: 'Saquon Barkley', position: 'RB' })
    const allRows = [...earlyAlphabetLowerRelevance, star].sort((a, b) => a.name.localeCompare(b.name))
    sportsPlayerFindManyMock.mockResolvedValue(allRows)

    adpSnapshotFindManyMock.mockResolvedValue([
      ...earlyAlphabetLowerRelevance.map((p, i) => ({ playerKey: `${p.name.toLowerCase()}|rb`, averageOverallPick: 100 + i })),
      { playerKey: 'saquon barkley|rb', averageOverallPick: 2 },
    ])

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    // Constrained limit: smaller than the ADP tier size (5), matching the real Waiver shape.
    const pool = await getPlayerPoolForSport('NFL', { limit: 3 })

    const names = pool.filter((p) => p.metadata?.source !== 'synthetic_team_defense').map((p) => p.full_name)
    expect(names).toContain('Saquon Barkley')
  })

  it('orders the ADP tier by real ADP rank, best (lowest) pick first', async () => {
    const players = [
      nflRow({ id: 'a', name: 'Zeta Player', position: 'RB' }),
      nflRow({ id: 'b', name: 'Alpha Player', position: 'RB' }),
    ]
    sportsPlayerFindManyMock.mockResolvedValue(players)
    adpSnapshotFindManyMock.mockResolvedValue([
      { playerKey: 'zeta player|rb', averageOverallPick: 5 },
      { playerKey: 'alpha player|rb', averageOverallPick: 50 },
    ])

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NFL', { limit: 2 })
    const names = pool.filter((p) => p.metadata?.source !== 'synthetic_team_defense').map((p) => p.full_name)

    expect(names[0]).toBe('Zeta Player')
    expect(names[1]).toBe('Alpha Player')
  })

  it('falls back to alphabetical order for players with no ADP entry (Tier 2)', async () => {
    const players = [
      nflRow({ id: 'a', name: 'Zeta NoAdp', position: 'RB' }),
      nflRow({ id: 'b', name: 'Alpha NoAdp', position: 'RB' }),
    ].sort((a, b) => a.name.localeCompare(b.name)) // mirrors the real DB's `ORDER BY name asc`
    sportsPlayerFindManyMock.mockResolvedValue(players)
    adpSnapshotFindManyMock.mockResolvedValue([])

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NFL', { limit: 2 })
    const names = pool.filter((p) => p.metadata?.source !== 'synthetic_team_defense').map((p) => p.full_name)

    expect(names).toEqual(['Alpha NoAdp', 'Zeta NoAdp'])
  })

  it('is deterministic across repeated calls with the same data', async () => {
    const players = [
      nflRow({ id: 'a', name: 'Beta Player', position: 'RB' }),
      nflRow({ id: 'b', name: 'Alpha Player', position: 'RB' }),
      nflRow({ id: 'c', name: 'Gamma Player', position: 'RB' }),
    ]
    sportsPlayerFindManyMock.mockResolvedValue(players)
    adpSnapshotFindManyMock.mockResolvedValue([
      { playerKey: 'beta player|rb', averageOverallPick: 10 },
      { playerKey: 'alpha player|rb', averageOverallPick: 10 },
    ])

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool1 = await getPlayerPoolForSport('NFL', { limit: 3 })
    const pool2 = await getPlayerPoolForSport('NFL', { limit: 3 })

    expect(pool1.map((p) => p.full_name)).toEqual(pool2.map((p) => p.full_name))
  })

  it('handles a player with multiple ADP snapshot rows (different contexts) by using the best (lowest) pick', async () => {
    const players = [nflRow({ id: 'a', name: 'Multi Context', position: 'RB' })]
    sportsPlayerFindManyMock.mockResolvedValue(players)
    adpSnapshotFindManyMock.mockResolvedValue([
      { playerKey: 'multi context|rb', averageOverallPick: 40 },
      { playerKey: 'multi context|rb', averageOverallPick: 12 },
      { playerKey: 'multi context|rb', averageOverallPick: 75 },
    ])

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NFL', { limit: 1 })
    expect(pool.some((p) => p.full_name === 'Multi Context')).toBe(true)
  })

  it('degrades gracefully (no throw) when the ADP query fails', async () => {
    sportsPlayerFindManyMock.mockResolvedValue([nflRow({ id: 'a', name: 'Someone', position: 'RB' })])
    adpSnapshotFindManyMock.mockRejectedValue(new Error('db unavailable'))

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    await expect(getPlayerPoolForSport('NFL', { limit: 5 })).resolves.not.toThrow()
  })
})
