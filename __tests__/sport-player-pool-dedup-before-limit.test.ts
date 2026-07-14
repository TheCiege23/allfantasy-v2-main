import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const countMock = vi.fn()
const findManyMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      count: countMock,
      findMany: findManyMock,
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

// Phase 26: reproduces the real production pattern found in .env.test --
// SportsPlayer has heavy cross-source duplication (measured: 17,257 raw NFL
// rows for only 12,004 distinct names). An alphabetically-ordered query with
// take applied BEFORE dedup can be entirely consumed by duplicate rows for
// early-alphabet names, silently excluding the majority of the real roster
// (measured: an 800-row take never got past "Anthony Jones").
describe('getPlayerPoolForSport — dedup-before-limit defect (Phase 26)', () => {
  beforeEach(() => {
    vi.resetModules()
    countMock.mockReset()
    findManyMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not lose real late-alphabet players to early-alphabet duplicate rows', async () => {
    // Simulate: 8 duplicate rows each for 3 early-alphabet players (24 rows),
    // plus 1 row each for 2 real late-alphabet stars -- mirroring the real
    // shape (heavy per-player duplication from multiple import sources).
    const duplicateHeavyRows: Array<{ id: string; name: string; position: string; team: string; sport: string; sleeperId: string | null; imageUrl: string | null; status: string | null; age: number | null; externalId: string | null; teamId: string | null }> = []
    let idCounter = 0
    for (const name of ['Aaron Aardvark', 'Abel Anderson', 'Adam Abbott']) {
      for (let i = 0; i < 8; i++) {
        idCounter += 1
        duplicateHeavyRows.push({
          id: `dup-${idCounter}`,
          name,
          position: 'WR',
          team: 'AAA',
          sport: 'NFL',
          sleeperId: null,
          imageUrl: null,
          status: null,
          age: null,
          externalId: null,
          teamId: null,
        })
      }
    }
    const realStars = [
      { id: 'star-1', name: 'Saquon Barkley', position: 'RB', team: 'PHI', sport: 'NFL', sleeperId: 'sl1', imageUrl: 'https://x/img.png', status: null, age: 28, externalId: null, teamId: null },
      { id: 'star-2', name: 'Zack Ziegler', position: 'WR', team: 'ZZZ', sport: 'NFL', sleeperId: 'sl2', imageUrl: 'https://x/img2.png', status: null, age: 25, externalId: null, teamId: null },
    ]
    // Rows returned in alphabetical order by name, exactly as the real ORDER BY name asc produces.
    const allRowsAlphabetical = [...duplicateHeavyRows, ...realStars].sort((a, b) => a.name.localeCompare(b.name))

    countMock.mockResolvedValue(allRowsAlphabetical.length)
    findManyMock.mockImplementation(async (args: { take?: number }) => {
      // Mirrors the real Prisma behavior: `take` slices the alphabetically-ordered result.
      if (typeof args?.take === 'number') {
        return allRowsAlphabetical.slice(0, args.take)
      }
      return allRowsAlphabetical
    })

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')

    // A small requested limit (analogous to the real limit:800 case, scaled down)
    // that is smaller than the raw duplicate-heavy row count but larger than the
    // real distinct player count -- this is exactly the shape that triggers the
    // defect in production.
    const pool = await getPlayerPoolForSport('NFL', { limit: 5 })

    const names = pool.map((p) => p.full_name)
    expect(names).toContain('Saquon Barkley')
    expect(names).toContain('Zack Ziegler')
  })

  it('still deduplicates, preferring the highest-quality duplicate row', async () => {
    countMock.mockResolvedValue(2)
    findManyMock.mockResolvedValue([
      { id: 'low', name: 'Duplicate Player', position: 'RB', team: 'AAA', sport: 'NFL', sleeperId: null, imageUrl: null, status: null, age: null, externalId: null, teamId: null },
      { id: 'high', name: 'Duplicate Player', position: 'RB', team: 'AAA', sport: 'NFL', sleeperId: 'sl9', imageUrl: 'https://x/img.png', status: null, age: null, externalId: null, teamId: null },
    ])

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NFL', { limit: 10 })

    const matches = pool.filter((p) => p.full_name === 'Duplicate Player')
    expect(matches).toHaveLength(1)
    expect(matches[0].player_id).toBe('high')
  })

  it('respects the requested limit on the final distinct-player count', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${String(i).padStart(2, '0')}`,
      position: 'RB',
      team: 'AAA',
      sport: 'NFL',
      sleeperId: null,
      imageUrl: null,
      status: null,
      age: null,
      externalId: null,
      teamId: null,
    }))
    countMock.mockResolvedValue(rows.length)
    findManyMock.mockResolvedValue(rows)

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NFL', { limit: 5 })

    // Real (non-synthetic) rows should be capped at the requested limit.
    const realRows = pool.filter((p) => p.metadata?.source !== 'synthetic_team_defense')
    expect(realRows.length).toBeLessThanOrEqual(5)
  })
})
