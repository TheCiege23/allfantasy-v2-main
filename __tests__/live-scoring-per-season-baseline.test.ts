/**
 * 🛑 Two leagues rostering the same player: the first one's tick wrote the play into the SHARED
 * `playerWeeklyScore` row, the second read that row as its "previous" stats, diffed to zero and never
 * rescored — its matchups waited for the five-minute reconcile instead of the two-minute live tick
 * (measured on production 2026-11-22). Each season now diffs against what IT last scored on.
 *
 * The fake `playerWeeklyScore` here is a real shared store — upserts land in it and reads return them —
 * so a return to the shared-table baseline reproduces the bug instead of passing against an empty table.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { LiveStatsProvider } from '@/lib/live-scoring/provider'

const rescored = vi.hoisted(() => vi.fn(async (_seasonId: string, _week: number) => ({ updated: 1, incomplete: 1, summaries: [] })))
vi.mock('@/lib/redraft/scoringEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/scoringEngine')>()),
  recalculateMatchupsForSeasonWeek: rescored,
}))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn(async () => []) }))

import { resetLiveSeasonBaselinesForTests, runLiveScoringTickForSeason } from '@/server/services/liveScoring/liveScoreRunner'

const seasonA = { id: 's-a', leagueId: 'l-a', sport: 'NFL', season: 2026, currentWeek: 11 }
const seasonB = { id: 's-b', leagueId: 'l-b', sport: 'NFL', season: 2026, currentWeek: 11 }

/** One shared stat table for every season, as in production. */
let sharedWeekly: Map<string, Record<string, number>>

function fakePrisma(seasonId: string) {
  const roster = [{ playerId: 'rb1', slotType: 'RB', position: 'RB' }]
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async (args: Record<string, any>) => {
          if (name === 'league' && method === 'findFirst') return { bestBallMode: false, leagueType: 'redraft', leagueVariant: null }
          if (name === 'redraftRosterPlayer' && method === 'findMany') return roster
          if (name === 'redraftRoster' && method === 'findMany') {
            return [
              { id: `${seasonId}-r1`, players: roster.map((p) => ({ playerId: p.playerId, slotType: p.slotType })) },
              { id: `${seasonId}-r2`, players: [] },
            ]
          }
          if (name === 'redraftMatchup' && method === 'findMany') {
            return [{ id: `${seasonId}-m1`, homeRosterId: `${seasonId}-r1`, awayRosterId: `${seasonId}-r2`, status: 'active' }]
          }
          if (name === 'playerWeeklyScore' && method === 'upsert') {
            sharedWeekly.set(args.where.playerId_week_season_sport.playerId, args.update.stats)
            return {}
          }
          if (name === 'playerWeeklyScore' && method === 'findMany') {
            return [...sharedWeekly].map(([playerId, stats]) => ({ playerId, stats }))
          }
          if (method.startsWith('find') && method !== 'findMany') return null
          if (method === 'count') return 0
          return []
        },
      },
    )
  return new Proxy({}, { get: (_t, prop: string) => model(prop) }) as unknown as PrismaClient
}

function provider(rushYds: number) {
  return {
    fetchActiveGames: vi.fn(async () => [
      { gameId: 'g1', status: 'in_progress', startTime: new Date('2026-11-22T18:00:00Z'), homeTeam: 'DET', awayTeam: 'NYG' },
    ]),
    fetchPlayerStatsForGames: vi.fn(async () => new Map([['rb1', { rush_yd: rushYds }]])),
    fetchTeamDefenseStatsForGames: vi.fn(async () => new Map()),
    normalizeGameStatus: vi.fn(() => 'in_progress' as const),
  }
}

const tick = (season: typeof seasonA, rushYds: number) =>
  runLiveScoringTickForSeason(fakePrisma(season.id), season, {
    provider: provider(rushYds) as unknown as LiveStatsProvider,
    broadcast: () => {},
    seasonType: 'regular',
    now: new Date('2026-11-22T18:40:00Z'),
  })

const rescoresFor = (seasonId: string) => rescored.mock.calls.filter(([id]) => id === seasonId).length

beforeEach(() => {
  sharedWeekly = new Map()
  rescored.mockClear()
  resetLiveSeasonBaselinesForTests()
})

describe('live tick — each league rescores on its own view of the stats', () => {
  it('🛑 a second league rostering the same player still rescores after the first league recorded the play', async () => {
    await tick(seasonA, 40)
    expect(rescoresFor('s-a')).toBe(1)
    expect(sharedWeekly.get('rb1')).toEqual({ rush_yd: 40 }) // the shared row already holds the play

    const b = await tick(seasonB, 40)
    expect(b.reason).not.toBe('no_change')
    expect(rescoresFor('s-b')).toBe(1)
  })

  it('[control] the same league seeing the same stats again does nothing — still idempotent', async () => {
    await tick(seasonA, 40)
    const again = await tick(seasonA, 40)
    expect(again.reason).toBe('no_change')
    expect(rescoresFor('s-a')).toBe(1)
  })

  it('a new play rescores the league again', async () => {
    await tick(seasonA, 40)
    await tick(seasonA, 52)
    expect(rescoresFor('s-a')).toBe(2)
  })

  it('a rescore that failed is retried on the next tick, not counted as applied', async () => {
    rescored.mockRejectedValueOnce(new Error('db blip'))
    await expect(tick(seasonA, 40)).rejects.toThrow('db blip')
    await tick(seasonA, 40)
    expect(rescoresFor('s-a')).toBe(2)
  })
})
