/**
 * The soccer projection rows the writer STORES. Until 2026-10-09 every soccer run threw "no
 * fantasy_stat_lines found for sport=SOCCER" (15 of 15 in a fortnight) and soccer had no projections;
 * its season lines are now built from the per-match rows. Driven through a prisma double — nothing here
 * touches a database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as unknown[], upserts: [] as any[], scheduledSeason: 2026 as number | null }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // A soccer run must never read vendor season lines: there are none, and reading them is what threw.
    fantasyStatLine: {
      findFirst: vi.fn(async () => { throw new Error('soccer read fantasy_stat_lines') }),
      findMany: vi.fn(async () => { throw new Error('soccer read fantasy_stat_lines') }),
    },
    playerGameStat: {
      findFirst: vi.fn(async (args: any) => (args?.where?.season?.lt != null ? null : { season: 2026 })),
      findMany: vi.fn(async () => state.rows),
    },
    depthChart: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
    playerIdentityMap: {
      findMany: vi.fn(async () => [
        { id: 'fwd', canonicalName: 'A Forward', sleeperId: null },
        { id: 'gk', canonicalName: 'A Keeper', sleeperId: null },
        { id: 'sub', canonicalName: 'A Substitute', sleeperId: null },
      ]),
    },
    aFProjectionSnapshot: { upsert: vi.fn(async (args: any) => { state.upserts.push(args); return {} }) },
    fantasyProjection: { upsert: vi.fn(async () => ({})) },
    sportsGame: { aggregate: vi.fn(async () => ({ _max: { season: state.scheduledSeason } })) },
  },
}))
vi.mock('@/lib/sports-data/sleeperMarketService', () => ({ getWeekBoard: vi.fn(async () => null) }))

import { writeAfProjectionSnapshots } from '@/lib/af-projections/writeAfProjectionSnapshots'

const fielder = (position: string, stats: Record<string, number>) => ({ group: 'fielders', position, stats })
const keeper = (stats: Record<string, number>) => ({ group: 'goalkeepers', position: 'Goalkeeper', stats })
const row = (playerId: string, gameId: string, day: string, normalizedStatMap: unknown) => ({
  playerId, gameId, season: 2026, team: 'RAC', gameDate: new Date(`${day}T04:00:00Z`), normalizedStatMap,
})

beforeEach(() => {
  state.upserts = []
  state.scheduledSeason = 2026
  state.rows = [
    row('fwd', '20260905-1:fielders', '2026-09-05', fielder('Forward', { goals: 1, shots_on_goal: 2, shots_attempted: 3, minutes_played: 90 })),
    row('fwd', '20260912-1:fielders', '2026-09-12', fielder('Forward', { goals: 1, assists: 1, shots_on_goal: 1, minutes_played: 80 })),
    row('gk', '20260905-1:goalkeepers', '2026-09-05', keeper({ saves: 4, goals_conceded: 0, clean_sheets: 1, minutes_played: 90 })),
    row('gk', '20260912-1:goalkeepers', '2026-09-12', keeper({ saves: 2, goals_conceded: 1, clean_sheets: 0, minutes_played: 90 })),
    // One appearance only: below the engine's two-game floor, so it refuses rather than projects.
    row('sub', '20260912-1:fielders', '2026-09-12', fielder('Midfielder', { minutes_played: 12 })),
  ]
})

describe('the soccer projection run', () => {
  it('projects from the match rows into the season being played, without reading vendor season lines', async () => {
    const result = await writeAfProjectionSnapshots({ sport: 'SOCCER' })
    expect(result).toMatchObject({ sourceSeason: 2026, targetSeason: 2026, written: 2, refused: 1 })
    expect(result.refusalsByReason).toEqual({ insufficient_sample: 1 })
  })

  it('stores per-appearance rates in the engine’s keys and a per-appearance points projection', async () => {
    await writeAfProjectionSnapshots({ sport: 'SOCCER' })
    const stored = (id: string) => state.upserts.find((u) => u.create.playerId === id)!.create

    const fwd = stored('fwd')
    expect(fwd).toMatchObject({ sport: 'SOCCER', season: 2026, week: null, position: 'FWD', playerName: 'A Forward' })
    expect(fwd.adjustmentFactors.basis).toBe('season_category_components')
    expect(fwd.adjustmentFactors.perGameRates).toMatchObject({ goals: 1, assists: 0.5, shots_on_target: 1.5, minutes_played: 85 })
    expect(fwd.adjustmentFactors.confidenceReasons).toContain('2 games in the season sample')
    // Per appearance, on what an unsaved soccer league scores: a goal (6), half an assist (1.5), 1.5 shots
    // on target (0.75), 1.5 shots (0.3) and 85 minutes (1.7).
    expect(fwd.afProjection).toBeCloseTo(6 + 1.5 + 0.75 + 0.3 + 1.7, 6)

    const gk = stored('gk')
    expect(gk.position).toBe('GK')
    expect(gk.adjustmentFactors.perGameRates).toMatchObject({ saves: 3, gk_goals_against: 0.5, clean_sheet_gk: 0.5 })
  })
})
