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

// Phase 27: even after Phase 26's dedup-before-limit fix, an alphabetical-only
// selection strategy still starves the pool of real, fantasy-relevant players
// once the distinct-name universe exceeds the requested limit (measured in
// production: a 12,004-distinct-name universe with an 800-item limit only
// reached "Arjen Colquhoun" -- real stars like Saquon Barkley never appeared).
// This test reproduces that shape at small scale: many early-alphabet
// low-relevance players plus a couple of real, ADP-tracked, late-alphabet stars.
describe('getPlayerPoolForSport — ADP-priority selection (Phase 27)', () => {
  beforeEach(() => {
    vi.resetModules()
    sportsPlayerFindManyMock.mockReset()
    adpSnapshotFindManyMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('surfaces real ADP-tracked players even when they fall late in the alphabet and the limit is small', async () => {
    const fillerPlayers = Array.from({ length: 10 }, (_, i) => ({
      id: `filler-${i}`,
      name: `Aaron Filler${String(i).padStart(2, '0')}`,
      position: 'WR',
      team: 'AAA',
      sport: 'NFL',
      sleeperId: null,
      imageUrl: null,
      status: null,
      age: null,
      externalId: null,
      teamId: null,
    }))
    const realStars = [
      { id: 'star-1', name: 'Saquon Barkley', position: 'RB', team: 'PHI', sport: 'NFL', sleeperId: 'sl1', imageUrl: null, status: null, age: 28, externalId: null, teamId: null },
      { id: 'star-2', name: 'Zack Ziegler', position: 'WR', team: 'ZZZ', sport: 'NFL', sleeperId: 'sl2', imageUrl: null, status: null, age: 25, externalId: null, teamId: null },
    ]
    const allRowsAlphabetical = [...fillerPlayers, ...realStars].sort((a, b) => a.name.localeCompare(b.name))
    sportsPlayerFindManyMock.mockResolvedValue(allRowsAlphabetical)

    // Real AllFantasyAdpSnapshot data: only the two real stars have ADP entries.
    adpSnapshotFindManyMock.mockResolvedValue([
      { playerKey: 'saquon barkley|rb', averageOverallPick: 2 },
      { playerKey: 'zack ziegler|wr', averageOverallPick: 40 },
    ])

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NFL', { limit: 5 })

    const names = pool.map((p) => p.full_name)
    expect(names).toContain('Saquon Barkley')
    expect(names).toContain('Zack Ziegler')
  })

  it('falls back to alphabetical order when no ADP data exists for the sport', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${String(i).padStart(2, '0')}`,
      position: 'RB',
      team: 'AAA',
      sport: 'SOCCER',
      sleeperId: null,
      imageUrl: null,
      status: null,
      age: null,
      externalId: null,
      teamId: null,
    }))
    sportsPlayerFindManyMock.mockResolvedValue(rows)
    adpSnapshotFindManyMock.mockResolvedValue([])

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('SOCCER', { limit: 3 })

    const names = pool.filter((p) => p.metadata?.source !== 'synthetic_team_defense').map((p) => p.full_name)
    expect(names).toEqual(['Player 00', 'Player 01', 'Player 02'])
  })

  it('preserves alphabetical order as a deterministic tiebreak within the ADP-priority tier', async () => {
    const rows = [
      { id: 'b', name: 'Bravo Star', position: 'RB', team: 'AAA', sport: 'NFL', sleeperId: null, imageUrl: null, status: null, age: null, externalId: null, teamId: null },
      { id: 'a', name: 'Alpha Star', position: 'RB', team: 'AAA', sport: 'NFL', sleeperId: null, imageUrl: null, status: null, age: null, externalId: null, teamId: null },
    ]
    sportsPlayerFindManyMock.mockResolvedValue(rows)
    adpSnapshotFindManyMock.mockResolvedValue([
      { playerKey: 'bravo star|rb' },
      { playerKey: 'alpha star|rb' },
    ])

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool1 = await getPlayerPoolForSport('NFL', { limit: 2 })
    const pool2 = await getPlayerPoolForSport('NFL', { limit: 2 })

    const names1 = pool1.filter((p) => p.metadata?.source !== 'synthetic_team_defense').map((p) => p.full_name)
    const names2 = pool2.filter((p) => p.metadata?.source !== 'synthetic_team_defense').map((p) => p.full_name)
    expect(names1).toEqual(names2)
  })

  it('does not throw and degrades gracefully when the ADP query itself fails', async () => {
    const rows = [
      { id: 'a', name: 'Someone Player', position: 'RB', team: 'AAA', sport: 'NFL', sleeperId: null, imageUrl: null, status: null, age: null, externalId: null, teamId: null },
    ]
    sportsPlayerFindManyMock.mockResolvedValue(rows)
    adpSnapshotFindManyMock.mockRejectedValue(new Error('db unavailable'))

    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    await expect(getPlayerPoolForSport('NFL', { limit: 5 })).resolves.not.toThrow()
  })
})
