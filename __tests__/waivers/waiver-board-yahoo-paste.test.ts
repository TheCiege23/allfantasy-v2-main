import { describe, expect, it, vi } from 'vitest'

import { loadWaiverBoard } from '@/lib/waivers/waiverBoard'

/*
 * 🛑 A PASTED YAHOO LEAGUE: "NOT ON ANY ROSTER" IS NOT "AVAILABLE" UNTIL ITS COVERAGE SAYS SO.
 * Matched players are stored `sleeper:<id>`; an unmatched one keeps `yahoo-paste:<name>|<pos>|<team>`
 * and is dropped by every Sleeper-id read — so subtracting rosters from the wire offered him as a free
 * agent. Below the 80% bar the board says it cannot verify; above it the list stands, minus him.
 */
vi.mock('@/lib/core-app/myRoster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/myRoster')>()),
  findMyRoster: vi.fn(async () => ({ found: true, playerData: { players: ['sleeper:6038'] } })),
}))
const FEED: Record<string, { name: string; line: number; team: string }> = {
  '6038': { name: 'My Tight End', line: 5, team: 'BUF' },
  fa1: { name: 'Pasted Guy', line: 14, team: 'KC' },
  fa2: { name: 'Real Free Agent', line: 12, team: 'NYJ' },
}
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  afEngineForLeague: (await importOriginal<typeof import('@/lib/core-app/playerProjections')>()).afEngineForLeague,
  lookupAfEngineProjections: vi.fn(async () => new Map()),
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 4 })),
  lookupProjections: vi.fn(async (ids: readonly string[]) =>
    new Map(
      ids
        .filter((id) => FEED[id])
        .map((id) => [id, { projectedPoints: FEED[id].line, name: FEED[id].name, position: 'TE', team: FEED[id].team, componentStats: { rec: FEED[id].line } }]),
    ),
  ),
}))
vi.mock('@/lib/af-projections/nflLeagueWeek', () => ({
  loadAfNflWeek: async () => (await import('@/lib/core-app/playerProjections')).lookupProjections(Object.keys(FEED)),
}))
vi.mock('@/lib/projections/leagueScoring', () => ({
  computeLeagueProjectedPoints: (line: Record<string, number>) => ({ points: Number(line.rec) }),
}))
vi.mock('@/lib/waivers/recentFormProjection', () => ({ projectFromRecentForm: vi.fn(async () => new Map()) }))
vi.mock('@/lib/core-app/unavailableStarters', () => ({ loadUnavailableBySport: vi.fn(async () => new Map()) }))
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: vi.fn(async () => null), isPreseason: () => false }))

const declared = (n: number) => Array.from({ length: n }, (_, i) => `sleeper:${7000 + i}`)

const prismaWith = (rosters: Array<{ players: string[] }>) =>
  ({
    league: {
      findUnique: async () => ({ id: 'Y1', settings: { scoring_settings: { rec: 1 }, roster_positions: ['TE'] }, platform: 'yahoo', sport: 'NFL' }),
      findFirst: async () => null,
    },
    roster: { findMany: async () => rosters.map((pd) => ({ playerData: pd })) },
    playerGameStat: {
      aggregate: async (args: any) => (args?.where?.season ? { _max: { weekOrRound: 3 } } : { _max: { season: 2026 } }),
      findMany: async () => [{ playerId: 'fa1' }, { playerId: 'fa2' }],
    },
    sportsPlayer: {
      findMany: async () => [
        { sleeperId: 'fa1', name: 'Pasted Guy', team: 'KC', position: 'TE', updatedAt: new Date() },
        { sleeperId: 'fa2', name: 'Real Free Agent', team: 'NYJ', position: 'TE', updatedAt: new Date() },
      ],
    },
  }) as never

describe('loadWaiverBoard — a pasted Yahoo league', () => {
  it('above the bar: lists the wire, and counts the unmatched rostered player', async () => {
    // 9 of 10 distinct ids declared: 90% clears the 80% bar.
    const board = await loadWaiverBoard({
      prisma: prismaWith([{ players: ['sleeper:6038', ...declared(8)] }, { players: ['yahoo-paste:pasted guy|TE|KC'] }]),
      leagueId: 'Y1',
      userId: 'u-1',
    })
    expect(board.state).toBe('ok')
    expect(board.unmatchedRostered).toBe(1)
    expect(board.candidates.map((c) => c.name)).toEqual(['Real Free Agent'])
  })

  it('🛑 the unmatched pasted player is never listed as available, even as the best add on the wire', async () => {
    const board = await loadWaiverBoard({
      prisma: prismaWith([{ players: ['sleeper:6038', ...declared(8)] }, { players: ['yahoo-paste:pasted guy|TE|KC'] }]),
      leagueId: 'Y1',
      userId: 'u-1',
    })
    expect(JSON.stringify(board.candidates)).not.toContain('Pasted Guy')
    // And he is not passed off as a player no slot can hold.
    expect(board.notes.join(' ')).not.toMatch(/skipped because no slot/)
  })

  it('below the bar: no list, an explicit "can\'t verify" state with the unmatched count', async () => {
    // 2 of 6 declared: 33%.
    const board = await loadWaiverBoard({
      prisma: prismaWith([
        { players: ['sleeper:6038', 'sleeper:7001'] },
        { players: ['yahoo-paste:pasted guy|TE|KC', 'yahoo-paste:a|WR|KC', 'yahoo-paste:b|RB|KC', 'yahoo-paste:c|QB|KC'] },
      ]),
      leagueId: 'Y1',
      userId: 'u-1',
    })
    expect(board.state).toBe('availability_unverified')
    expect(board.unmatchedRostered).toBe(4)
    expect(board.candidates).toEqual([])
    expect(board.notes.join(' ')).toContain("We can't verify who's available in this league: 4 players")
  })

  it('CONTROL: a Sleeper league with the same wire lists both free agents and carries no count', async () => {
    const prisma = prismaWith([{ players: ['6038'] }]) as any
    prisma.league.findUnique = async () => ({ id: 'S1', settings: { scoring_settings: { rec: 1 }, roster_positions: ['TE'] }, platform: 'sleeper', sport: 'NFL' })
    const { findMyRoster } = await import('@/lib/core-app/myRoster')
    vi.mocked(findMyRoster).mockResolvedValueOnce({ found: true, playerData: { players: ['6038'] } } as never)
    const board = await loadWaiverBoard({ prisma, leagueId: 'S1', userId: 'u-1' })
    expect(board.state).toBe('ok')
    expect(board.unmatchedRostered).toBeUndefined()
    expect(board.candidates.map((c) => c.name).sort()).toEqual(['Pasted Guy', 'Real Free Agent'])
  })
})
