/**
 * The league-engine scoring worker (`scoreLeagueWeek`) keeps a LOCKED best ball week at the positions it
 * was locked at — the same rule the native stamp follows (lib/bestball/resultRuleStamp.ts).
 *
 * There is no position history in the schema, so the worker seated every rescore at the player's CURRENT
 * position: a TE re-listed as a WR moved into a WR seat in weeks that were already locked, and their
 * scores changed (audit 2026-11-06, "Position-change effective dates").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type StatRow = { playerId: string; normalizedStatMap: Record<string, number> | null; fantasyPoints: number | null }

const statRows = vi.fn<(ids: string[]) => StatRow[]>()
const playerGameStatFindMany = vi.fn(async (args: { where: { playerId: { in: string[] } } }) =>
  statRows(args.where.playerId.in).filter((r) => args.where.playerId.in.includes(r.playerId)),
)
const leagueFindUnique = vi.fn()
const sportsPlayerFindMany = vi.fn(async (): Promise<unknown[]> => [])
const teamPerformanceUpsert = vi.fn(async () => ({}))
const teamPerformanceFindMany = vi.fn(async (): Promise<unknown[]> => [])

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: { findMany: (args: never) => playerGameStatFindMany(args) },
    sportsPlayer: { findMany: (...a: unknown[]) => sportsPlayerFindMany(...(a as [])) },
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a), update: vi.fn(async () => ({})) },
    teamPerformance: {
      upsert: (...a: unknown[]) => teamPerformanceUpsert(...(a as [])),
      findMany: (...a: unknown[]) => teamPerformanceFindMany(...(a as [])),
    },
    leagueTeam: { update: vi.fn(async () => ({})) },
    scoringSettingsSnapshot: { create: vi.fn(async () => ({})) },
  },
}))
vi.mock('@/lib/multi-sport/MultiSportScoringResolver', () => ({
  resolveScoringRulesForLeague: vi.fn(async () => []),
}))

import { scoreLeagueWeek } from '@/lib/scoring/scoring-engine'

const row = (playerId: string, fantasyPoints: number): StatRow => ({ playerId, normalizedStatMap: null, fantasyPoints })
const sleeperRow = (id: string, position: string) => ({ externalId: id, sleeperId: id, name: id, position, team: 'KC', source: 'sleeper', updatedAt: new Date(0) })

const bestBallLeague = {
  id: 'L',
  sport: 'NFL',
  platform: 'sleeper',
  leagueVariant: null,
  settings: { best_ball: true, roster: { config: { sections: [{ key: 'primary', slots: { WR: 1, BN: 4 } }] } } },
  rosters: [{ id: 'r1', platformUserId: 'u1', playerData: { players: ['p1', 'p2'] } }],
  teams: [{ id: 't1', externalId: 'u1' }],
}

type Write = { create: { points: number; data: { starterIds: string[]; sealedPositions?: Record<string, string | null> } }; update: { data: { sealedPositions?: Record<string, string | null> } } }
const lastWrite = () => (teamPerformanceUpsert.mock.calls.at(-1) as unknown as [Write])[0]

beforeEach(() => {
  vi.clearAllMocks()
  leagueFindUnique.mockResolvedValue(bestBallLeague)
  // p1 was a TE when the week was locked and is listed as a WR today; p2 has always been a WR.
  statRows.mockReturnValue([row('p1', 20), row('p2', 7)])
  sportsPlayerFindMany.mockResolvedValue([sleeperRow('p1', 'WR'), sleeperRow('p2', 'WR')])
  teamPerformanceFindMany.mockResolvedValue([])
})

describe('the scoring worker and a locked best ball week', () => {
  it('rescoring a locked week seats players at the positions it was locked at, and keeps them', async () => {
    teamPerformanceFindMany.mockResolvedValue([
      { teamId: 't1', result: 'locked', data: { starterIds: ['p2'], sealedPositions: { p1: 'TE', p2: 'WR' } } },
    ])
    const r = await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3 })
    expect(r.status).toBe('scored')
    const write = lastWrite()
    // p1 was a TE that week, so the only WR seat is p2's. Today's position would seat p1 for 20.
    expect(write.create.data.starterIds).toEqual(['p2'])
    expect(write.create.points).toBe(7)
    expect(write.update.data.sealedPositions).toEqual({ p1: 'TE', p2: 'WR' })
  })

  it('the write that locks a week records the position each optimized player was seated at', async () => {
    await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3, lockScores: true })
    expect(lastWrite().update.data.sealedPositions).toEqual({ p1: 'WR', p2: 'WR' })
  })

  it('an open week uses today’s positions and records none', async () => {
    teamPerformanceFindMany.mockResolvedValue([
      { teamId: 't1', result: null, data: { sealedPositions: { p1: 'TE', p2: 'WR' } } },
    ])
    await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3 })
    const write = lastWrite()
    expect(write.create.data.starterIds).toEqual(['p1'])
    expect(write.update.data.sealedPositions).toBeUndefined()
  })

  it('a week locked before positions were recorded keeps today’s behaviour and is never back-filled', async () => {
    teamPerformanceFindMany.mockResolvedValue([{ teamId: 't1', result: 'locked', data: { starterIds: ['p1'] } }])
    await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3, lockScores: true })
    const write = lastWrite()
    expect(write.create.data.starterIds).toEqual(['p1'])
    expect(write.update.data.sealedPositions).toBeUndefined()
  })
})
