import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * AllFantasy's own projection in Chimmy (2026-09-30). Two paths hand the model per-player weekly
 * numbers: the player-projection tool and the lineup optimizer. Both now name AF beside the
 * provider's number — and the optimizer keeps every total on the provider's number, with AF quoted
 * as a second opinion the model is told not to re-rank by.
 */

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  find: vi.fn(),
  league: vi.fn(),
  fpFind: vi.fn(),
  latest: vi.fn(),
  lookup: vi.fn(),
  engine: vi.fn(),
}))

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

describe('player-projection tool — AF and API, labelled', () => {
  it('names the engine as AF and, in a league, gives the provider (API) and AF under its rules', async () => {
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back', leagueId: 'lg-1' })
    expect(out).toContain("AF (AllFantasy's own projection engine): 9.2 points PER GAME")
    expect(out).toContain("API (the provider's, Sleeper, projection): 10.0 points in KBFL for week 4")
    // 9.6 engine x (10 league / 8 generic) = 12.0 — the same carry every /core surface uses.
    expect(out).toContain('AF in KBFL for week 4: 12.0 points')
    expect(out).toContain('do not average them')
    expect(h.engine).toHaveBeenCalledWith(['4040'], { season: '2026', week: 4 })
  })

  it('leaves out the AF league line when the engine has no row, keeping the provider line', async () => {
    h.engine.mockResolvedValue(new Map())
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back', leagueId: 'lg-1' })
    expect(out).toContain('API (the provider')
    expect(out).not.toContain('AF in KBFL')
  })

  it('a failed AF read drops only the AF line', async () => {
    h.engine.mockRejectedValue(new Error('db down'))
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back', leagueId: 'lg-1' })
    expect(out).toContain('API (the provider')
    expect(out).not.toContain('AF in KBFL')
    expect(out).not.toContain('could not be read just now')
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
