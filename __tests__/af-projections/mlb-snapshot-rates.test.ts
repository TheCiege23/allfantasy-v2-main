/**
 * The row the projection writer STORES for an MLB player — the half `mlb-per-game-rates.test.ts` cannot
 * see. Until 2026-10-09 every MLB snapshot carried `perGameRates: {E, PO}`, which nothing can score.
 * Driven through an injected prisma double; nothing here touches a database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ lines: [] as unknown[], upserts: [] as any[] }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyStatLine: {
      findFirst: vi.fn(async (args: any) => (args?.where?.season?.lt != null ? null : { season: '2025' })),
      findMany: vi.fn(async () => state.lines),
    },
    playerGameStat: { findMany: vi.fn(async () => []) },
    depthChart: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    aFProjectionSnapshot: { upsert: vi.fn(async (args: any) => { state.upserts.push(args); return {} }) },
    fantasyProjection: { upsert: vi.fn(async () => ({})) },
    sportsGame: { aggregate: vi.fn(async () => ({ _max: { season: null } })) },
  },
}))

import { writeAfProjectionSnapshots } from '@/lib/af-projections/writeAfProjectionSnapshots'

// Verbatim 2025 production payload (fantasy_stat_lines), innings in baseball notation as a string.
const SKENES = {
  playerId: 'skenes',
  stats: {
    riTeam: 'Pittsburgh', riPlayerName: 'Paul Skenes', position: 'P',
    regular_season: {
      games_played: 32, PO: 9,
      pitching: { H: 136, K: 216, L: 10, R: 45, S: 0, W: 10, BB: 42, ER: 41, HR: 11, IP: '187.2', ERA: '1.97', HBP: 6, HLD: 0 },
    },
  },
}
const JUDGE = {
  playerId: 'judge',
  stats: {
    riTeam: 'New York', riPlayerName: 'Aaron Judge', position: 'RF',
    regular_season: {
      games_played: 152, E: 3, PO: 280,
      batting: { H: 179, R: 137, '1B': 94, '2B': 30, '3B': 2, AB: 541, BB: 124, HR: 53, SB: 12, SO: 160, RBI: 114 },
    },
  },
}

beforeEach(() => {
  state.lines = [SKENES, JUDGE]
  state.upserts = []
})

describe('the MLB projection row', () => {
  it('stores batting and pitching per-game rates in the engine’s keys, not fielding', async () => {
    const result = await writeAfProjectionSnapshots({ sport: 'MLB' })
    expect(result.written).toBe(2)
    const stored = (id: string) => state.upserts.find((u) => u.create.playerId === id)!.create.adjustmentFactors.perGameRates

    const judge = stored('judge')
    expect(judge.hr).toBeCloseTo(53 / 152, 9)
    expect(judge.ab).toBeCloseTo(541 / 152, 9)
    expect(judge).not.toHaveProperty('E')
    expect(judge).not.toHaveProperty('PO')

    const skenes = stored('skenes')
    expect(skenes.ip).toBeCloseTo((187 + 2 / 3) / 32, 9)
    expect(skenes.so).toBeCloseTo(216 / 32, 9)
    expect(skenes).not.toHaveProperty('era')
  })
})
