// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: vi.fn(async () => [{ id: 'id-1', rollingInsightsId: 'ri-1' }]) },
    playerGameStat: {
      findFirst: vi.fn(async () => ({ id: 'any' })),
      findMany: vi.fn(async () => h.rows),
    },
  },
}))

import { loadDailyPoints } from '@/lib/league/collegePro/dailyPoints'

const LEAGUE = {
  fantrax_settings: { scoringSystem: { type: 'HEAD_TO_HEAD_POINTS_BASED', scoringCategories: { PLAYER: {
    PTS: { Default: 'points1' }, FTM: { Default: 'points1' }, 'FT-': { Default: 'points-1' }, '2D': { Default: 'points2' }, W: { Default: 'points1' },
  } } } },
}
const line = (stats: Record<string, number>, gameDate: string) => ({
  playerId: 'id-1', sportType: 'NCAAB', season: 2026, gameDate: new Date(gameDate),
  normalizedStatMap: { stats, seasonType: 'regular' },
})
const args = {
  sport: 'NCAAB' as const,
  window: { start: new Date('2026-11-16T00:00:00Z'), end: new Date('2026-11-23T00:00:00Z') },
  players: [{ id: 'fx-1', rollingInsightsId: 'ri-1', position: 'G' }],
}

beforeEach(() => {
  h.rows = [
    // Game 1: 20 pts, 11 reb → a double-double; 4 of 6 free throws.
    line({ points: 20, total_rebounds: 11, free_throws_made: 4, free_throws_attempted: 6 }, '2026-11-18T00:00:00Z'),
    // Game 2: 8 pts, 9 reb → no double-double; 2 of 2.
    line({ points: 8, total_rebounds: 9, free_throws_made: 2, free_throws_attempted: 2 }, '2026-11-20T00:00:00Z'),
  ]
})

describe('loadDailyPoints with the league settings', () => {
  it("scores each game under the league's own rules and sums the week", async () => {
    const r = await loadDailyPoints({ ...args, settings: LEAGUE })
    // Game 1: 20 + 4 − 2 + 2 (double-double) = 24. Game 2: 8 + 2 − 0 = 10.
    expect(r.points).toEqual({ 'fx-1': 34 })
    expect(r.scoredWith).toBe('league')
    expect(r.unscored).toEqual(['wins'])
  })

  it('a double-double counts per GAME, not off the week total', async () => {
    // Summed, 28 pts and 20 reb would look like a double-double twice over; only game 1 is one.
    const r = await loadDailyPoints({ ...args, settings: LEAGUE })
    expect(r.points['fx-1']).toBe(34)
  })

  it('keeps the native defaults when the league has no Fantrax points scoring', async () => {
    const r = await loadDailyPoints({ ...args, settings: null })
    expect(r.scoredWith).toBe('standard')
    expect(r.unscored).toEqual([])
  })
})
