import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The league "Worth adding" list priced on NEXT week's board (lib/core-app/waiverClaimWeek.ts).
 * Same harness shape as __tests__/idp-projections/waiverBoard.test.ts.
 */

const h = vi.hoisted(() => ({
  nextLines: [] as Array<{ playerId: string; week: number; projectedPoints: number; stats: unknown }>,
  ready: true,
  formCalls: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/core-app/myRoster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/myRoster')>()),
  findMyRoster: vi.fn(async () => ({ found: true, playerData: { players: ['mine'], starters: ['mine'] } })),
}))
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  afEngineForLeague: (await importOriginal<typeof import('@/lib/core-app/playerProjections')>()).afEngineForLeague,
  lookupAfEngineProjections: vi.fn(async () => new Map()),
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 4 })),
  /* The week BEING PLAYED: the free agent looks great this week. */
  lookupProjections: vi.fn(async (ids: readonly string[]) => {
    const feed: Record<string, number> = { mine: 5, fa1: 12 }
    return new Map(
      ids.filter((id) => feed[id] != null).map((id) => [id, { projectedPoints: feed[id], name: id, position: 'TE', team: 'KC', componentStats: { rec: feed[id] } }]),
    )
  }),
}))
vi.mock('@/lib/projections/futureWeekProjectionStore', () => ({
  futureWeekProjectionsReady: async () => h.ready,
  futureWeekStoreReader: {
    readLines: async (input: { playerIds: readonly string[] }) => h.nextLines.filter((l) => input.playerIds.includes(l.playerId)),
  },
}))
vi.mock('@/lib/projections/leagueScoring', () => ({
  computeLeagueProjectedPoints: (line: Record<string, number>) => ({ points: Number(line.rec) }),
}))
vi.mock('@/lib/waivers/recentFormProjection', () => ({
  projectFromRecentForm: vi.fn(async () => {
    h.formCalls++
    return new Map([['fa2', { points: 30, games: 3 }]])
  }),
}))

import { loadWaiverBoard } from '@/lib/waivers/waiverBoard'

const prisma = (scoring: Record<string, number> = { rec: 1 }) =>
  ({
    league: {
      findUnique: async () => ({ id: 'L1', settings: { scoring_settings: scoring, roster_positions: ['TE'] }, platform: 'sleeper', sport: 'NFL' }),
      findFirst: async () => null,
    },
    roster: { findMany: async () => [{ playerData: { players: ['mine'] } }] },
    playerGameStat: {
      aggregate: async (args: { where?: { season?: number } }) => (args?.where?.season ? { _max: { weekOrRound: 4 } } : { _max: { season: 2026 } }),
      findMany: async () => [{ playerId: 'fa1' }, { playerId: 'fa2' }],
    },
    sportsPlayer: {
      findMany: async () => [
        { sleeperId: 'fa1', name: 'Free Agent One', team: 'KC', position: 'TE', source: 'sleeper', updatedAt: new Date() },
        { sleeperId: 'fa2', name: 'Bye Week Guy', team: 'BUF', position: 'TE', source: 'sleeper', updatedAt: new Date() },
        { sleeperId: 'mine', name: 'My Tight End', team: 'DAL', position: 'TE', source: 'sleeper', updatedAt: new Date() },
      ],
    },
    sportsGame: { findMany: async () => [] },
  }) as never

beforeEach(() => {
  h.ready = true
  h.formCalls = 0
  /* Next week: fa1 is a 3-point TE, my starter 9 — and fa2 has NO line (a bye). */
  h.nextLines = [
    { playerId: 'mine', week: 5, projectedPoints: 9, stats: { rec: 9 } },
    { playerId: 'fa1', week: 5, projectedPoints: 3, stats: { rec: 3 } },
  ]
})

describe('loadWaiverBoard on next week’s board', () => {
  it('CONTROL: without a claim week it ranks the week being played — fa1 +7', async () => {
    const b = await loadWaiverBoard({ prisma: prisma(), leagueId: 'L1', userId: 'u' })
    expect(b.candidates.find((c) => c.sleeperId === 'fa1')?.gain).toBe(7)
  })

  it('prices next week: fa1 (3) no longer beats my tight end (9), so nobody is worth adding', async () => {
    const b = await loadWaiverBoard({ prisma: prisma(), leagueId: 'L1', userId: 'u', claimWeek: { season: '2026', week: 5 } })
    expect(b.week).toBe(5)
    expect(b.currentLineupPoints).toBe(9)
    expect(b.candidates).toEqual([])
    expect(b.notes.join(' ')).toContain("Sleeper's week 5 projections")
  })

  it('never prices a player with no next-week line off recent form — that player is usually on bye', async () => {
    const b = await loadWaiverBoard({ prisma: prisma(), leagueId: 'L1', userId: 'u', claimWeek: { season: '2026', week: 5 } })
    expect(h.formCalls).toBe(0)
    expect(JSON.stringify(b)).not.toContain('Bye Week Guy')
  })

  it('falls back to the week being played when next week’s tables are not there', async () => {
    h.ready = false
    const b = await loadWaiverBoard({ prisma: prisma(), leagueId: 'L1', userId: 'u', claimWeek: { season: '2026', week: 5 } })
    expect(b.week).toBe(4)
    expect(b.candidates.find((c) => c.sleeperId === 'fa1')?.gain).toBe(7)
  })

  it('keeps an IDP league on the week being played', async () => {
    const b = await loadWaiverBoard({ prisma: prisma({ rec: 1, idp_tkl: 1 }), leagueId: 'L1', userId: 'u', claimWeek: { season: '2026', week: 5 } })
    expect(b.week).toBe(4)
  })
})
