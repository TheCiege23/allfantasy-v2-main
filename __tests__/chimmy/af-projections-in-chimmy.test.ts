import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * AllFantasy's own projection in Chimmy (2026-09-30). Two paths hand the model per-player weekly
 * numbers: the player-projection tool and the lineup optimizer. Both now name AF beside the
 * provider's number — and the optimizer keeps every total on the provider's number, with AF quoted
 * as a second opinion the model is told not to re-rank by.
 */

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  metrics: vi.fn(),
  find: vi.fn(),
  league: vi.fn(),
  fpFind: vi.fn(),
  latest: vi.fn(),
  lookup: vi.fn(),
  engine: vi.fn(),
}))

vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: h.metrics }))
vi.mock('@/lib/af-projections/readAfProjections', () => ({ findAfProjectionsByName: h.find }))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: h.league }, fantasyProjection: { findMany: h.fpFind } },
}))
vi.mock('@/lib/projections/leagueScoring', () => ({
  extractScoringSettings: (s: { scoring_settings?: Record<string, number> } | null) => s?.scoring_settings ?? null,
  // rec x the league's `rec`: 5 rec under rec 2 -> 10 points, against a generic 8.
  computeLeagueProjectedPoints: (line: Record<string, number>, rules: Record<string, number>) => ({
    points: Number(line.rec) * Number(rules.rec ?? 1),
  }),
}))
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  afEngineForLeague: (await importOriginal<typeof import('@/lib/core-app/playerProjections')>()).afEngineForLeague,
  latestProjectionWeek: h.latest,
  lookupProjections: h.lookup,
  lookupAfEngineProjections: h.engine,
}))

import { buildPlayerProjectionContext } from '@/lib/chimmy/tools/playerProjectionTool'
import { renderLineupOptimizationBlock, type LineupOptimization, type OptimizerPlayer } from '@/lib/chimmy/lineupOptimizerGrounding'

const row = {
  playerId: 'uuid-1', playerName: 'Test Back', position: 'RB', sport: 'NFL', season: 2026, week: 4,
  afProjection: 9.2, baselineProjection: 9.2, weatherAdjustment: 0, weatherConsidered: false,
  rosProjection: 120.5, rosWeeksRemaining: 13, confidenceLevel: 'high', adjustmentReason: null,
  isOutdoorGame: true, computedAt: new Date('2026-09-30T07:58:00Z'),
}

beforeEach(() => {
  vi.resetAllMocks()
  h.find.mockResolvedValue({ rows: [row], season: 2026 })
  h.league.mockResolvedValue({ name: 'KBFL', settings: { scoring_settings: { rec: 2 } } })
  h.latest.mockResolvedValue({ season: '2026', week: 4 })
  h.fpFind.mockResolvedValue([{ playerId: '4040', stats: { name: 'Test Back' } }])
  h.lookup.mockResolvedValue(new Map([['4040', { playerId: '4040', projectedPoints: 8, componentStats: { rec: 5 } }]]))
  h.engine.mockResolvedValue(new Map([['4040', { playerId: '4040', projectedPoints: 9.6, basis: null, confidence: null }]]))
})

describe('player projection from the connected league', () => {
  const board = { sport: 'NFL', season: 2026, week: 4, unit: 'fantasy points' }
  const metric = { playerName: 'Test Back', position: 'RB', rank: 3, positionRank: 1, perGame: 9.2, weekGames: 1, weekly: 12 }

  it('quotes the AF week, season and units used by the league and OS', async () => {
    h.metrics.mockResolvedValue({ ...board, rows: [{ ...metric, fullSeason: 150, restOfSeason: 105 }] })
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back', leagueId: 'lg-1' })
    expect(out).toContain('AF league rank #3')
    expect(out).toContain('Week 4: 12.00 fantasy points')
    expect(out).toContain('150.00 fantasy points over the full season')
    expect(h.lookup).not.toHaveBeenCalled()
  })

  it('distinguishes an unavailable week from a verified zero for a defender', async () => {
    for (const weekly of [null, 0]) {
      h.metrics.mockResolvedValue({ ...board, rows: [{ ...metric, position: 'LB', weekly }] })
      const out = await buildPlayerProjectionContext({ playerName: 'Test Back', leagueId: 'lg-1' })
      expect(out).toContain(weekly == null ? 'Weekly estimate unavailable' : 'Week 4: 0.00 fantasy points')
    }
  })

  it('withholds estimates for another sport, missing identity, or unavailable AF data', async () => {
    h.metrics.mockResolvedValueOnce({ ...board, rows: [metric] }).mockResolvedValueOnce({ ...board, rows: [] }).mockRejectedValueOnce(new Error('unavailable'))
    for (const sport of ['NBA', 'NFL', 'NFL']) {
      const out = await buildPlayerProjectionContext({ playerName: 'Test Back', leagueId: 'lg-1', sport })
      expect(out).toContain('no matching projection')
    }
    expect(h.fpFind).not.toHaveBeenCalled()
  })
})

const p = (name: string, points: number | null, af?: number): OptimizerPlayer => ({
  playerId: name, name, position: 'WR', team: 'KC', injury: null, points, ...(af != null ? { af } : {}),
})
const ready = (players: { a: OptimizerPlayer; b: OptimizerPlayer }): LineupOptimization => ({
  status: 'ready',
  week: { season: '2026', week: 4 } as never,
  best: { points: 14, slots: [{ slot: 'WR', player: players.a }] },
  current: { starters: [players.b], points: 9, emptySlots: 0, known: true },
  startInstead: [players.a],
  benchInstead: [players.b],
  gain: 5,
  unpricedStarters: [],
  injuredStarters: [],
  bench: [],
  unpricedActive: 0,
  unfilledSlots: [],
})

describe('lineup optimizer block — AF as a second opinion', () => {
  it('shows AF beside every priced player and says the maths used the provider number only', () => {
    const out = renderLineupOptimizationBlock(ready({ a: p('Alpha', 14, 11.2), b: p('Bravo', 9, 12.8) }))
    expect(out).toContain('Alpha (WR, KC) — 14.0 pts · AF 11.2')
    expect(out).toContain('BENCH Bravo (WR, KC) (9.0 pts · AF 12.8)')
    expect(out).toContain('computed from the FIRST number only')
    expect(out).toContain('never re-rank the lineup')
    // The totals stay the provider's.
    expect(out).toContain('Best lineup projects 14.0 pts')
    expect(out).toContain('gains 5.0 projected pts')
  })

  it('without any AF figure the block is exactly as before — no AF note', () => {
    const out = renderLineupOptimizationBlock(ready({ a: p('Alpha', 14), b: p('Bravo', 9) }))
    expect(out).not.toContain('AF')
  })
})
