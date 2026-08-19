import { describe, expect, it, vi } from 'vitest'

// F2.9 performance view: warehouse facts → per-player PerformanceContext with the freeze's
// honesty invariants — no history is null (never zero), a real 0.0 game counts, season
// mismatches are declared, port errors degrade to uncertainty, one batched port call.

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/decision-os/world/enrichedWorld', () => ({ resolveEnrichedCanonicalWorld: vi.fn() }))

import {
  projectPerformanceContext,
  projectPerformanceEnrichedWorld,
  resolvePerformanceContext,
  type PerformancePort,
} from '@/lib/decision-os/world/performanceEnrichedWorld'
import type { RawPlayerGameFactRow } from '@/lib/decision-os/world/facts'

const fact = (over: Partial<RawPlayerGameFactRow>): RawPlayerGameFactRow => ({
  playerId: '4984',
  sport: 'NFL',
  season: 2025,
  weekOrRound: 1,
  fantasyPoints: 10,
  normalizedStats: {},
  createdAt: new Date('2026-07-21T16:00:00Z'),
  ...over,
})

describe('projectPerformanceContext', () => {
  it('no fact rows → nulls + uncertainty, NEVER zeros (P2: empty warehouse is unknown)', () => {
    const ctx = projectPerformanceContext([], '2025')
    expect(ctx.gamesPlayed).toBeNull()
    expect(ctx.totalFantasyPoints).toBeNull()
    expect(ctx.avgFantasyPoints).toBeNull()
    expect(ctx.weeklyPoints).toEqual([])
    expect(ctx.uncertainty).toContain('performance_history_unavailable')
  })

  it('a real 0.0-point game counts as a played game, not missing data', () => {
    const ctx = projectPerformanceContext([fact({ weekOrRound: 1, fantasyPoints: 0 })], '2025')
    expect(ctx.gamesPlayed).toBe(1)
    expect(ctx.totalFantasyPoints).toBe(0)
    expect(ctx.avgFantasyPoints).toBe(0)
    expect(ctx.uncertainty).not.toContain('performance_history_unavailable')
  })

  it('aggregates a season correctly: totals, averages, recent form, last game, weekly series', () => {
    const ctx = projectPerformanceContext([
      fact({ weekOrRound: 1, fantasyPoints: 10 }),
      fact({ weekOrRound: 2, fantasyPoints: 20 }),
      fact({ weekOrRound: 3, fantasyPoints: 30 }),
      fact({ weekOrRound: 4, fantasyPoints: 40 }),
    ], '2025')
    expect(ctx.gamesPlayed).toBe(4)
    expect(ctx.totalFantasyPoints).toBe(100)
    expect(ctx.avgFantasyPoints).toBe(25)
    expect(ctx.recentFormAvg).toBe(30) // weeks 2-4
    expect(ctx.lastGamePoints).toBe(40)
    expect(ctx.weeklyPoints.map((w) => w.week)).toEqual([1, 2, 3, 4])
    expect(ctx.seasonUsed).toBe(2025)
    expect(ctx.uncertainty).toEqual([])
  })

  it('never blends seasons: aggregates the newest season only', () => {
    const ctx = projectPerformanceContext([
      fact({ season: 2024, weekOrRound: 17, fantasyPoints: 99 }),
      fact({ season: 2025, weekOrRound: 1, fantasyPoints: 10 }),
      fact({ season: 2025, weekOrRound: 2, fantasyPoints: 20 }),
    ], '2025')
    expect(ctx.seasonUsed).toBe(2025)
    expect(ctx.gamesPlayed).toBe(2)
    expect(ctx.totalFantasyPoints).toBe(30)
  })

  it('declares season mismatch instead of presenting last season as current (offseason honesty)', () => {
    const ctx = projectPerformanceContext([fact({ season: 2025, weekOrRound: 1 })], '2026')
    expect(ctx.seasonUsed).toBe(2025)
    expect(ctx.uncertainty.some((u) => u.startsWith('season_mismatch'))).toBe(true)
  })
})

describe('resolvePerformanceContext', () => {
  it('makes exactly ONE batched port call for the whole id set', async () => {
    const load = vi.fn(async () => [fact({}), fact({ playerId: '3198', fantasyPoints: 30.2 })])
    const port: PerformancePort = { loadPlayerGameFactRows: load }
    const result = await resolvePerformanceContext('NFL', ['4984', '3198', '9999'], port)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('NFL', ['4984', '3198', '9999'])
    expect(result.rowsByPlayer.get('4984')).toHaveLength(1)
    expect(result.rowsByPlayer.get('3198')).toHaveLength(1)
    expect(result.rowsByPlayer.has('9999')).toBe(false)
    expect(result.error).toBeNull()
  })

  it('port failure degrades to an error result — never throws', async () => {
    const port: PerformancePort = { loadPlayerGameFactRows: async () => { throw new Error('db down') } }
    const result = await resolvePerformanceContext('NFL', ['4984'], port)
    expect(result.rowsByPlayer.size).toBe(0)
    expect(result.error).toBe('db down')
  })
})

describe('projectPerformanceEnrichedWorld', () => {
  const base = {
    leagueFacts: { sport: 'NFL', season: '2025' },
    rosters: [{
      rosterId: 'r1', teamId: 't1',
      players: [
        { playerId: '4984', name: 'Josh Allen', position: 'QB', eligiblePositions: ['QB'], team: 'BUF', sport: 'NFL', injuryStatus: null, resolved: true },
        { playerId: '0000', name: 'No History', position: 'RB', eligiblePositions: ['RB'], team: 'FA', sport: 'NFL', injuryStatus: null, resolved: true },
      ],
    }],
  } as never

  it('summarizes coverage honestly and attaches port errors as per-player uncertainty', () => {
    const rowsByPlayer = new Map([[
      '4984', [fact({ weekOrRound: 1, fantasyPoints: 38.76 }), fact({ weekOrRound: 2, fantasyPoints: 22.1 })],
    ]])
    const world = projectPerformanceEnrichedWorld(base, { rowsByPlayer, error: null }, '2025')
    expect(world.performanceSummary).toMatchObject({
      totalPlayers: 2, withHistory: 1, missingCount: 1, seasonUsed: 2025, seasonMismatch: false, weeksCovered: 2,
    })
    const [withHistory, without] = world.rosters[0].players
    expect(withHistory.performanceContext.avgFantasyPoints).toBeCloseTo(30.43)
    expect(without.performanceContext.gamesPlayed).toBeNull()

    const degraded = projectPerformanceEnrichedWorld(base, { rowsByPlayer: new Map(), error: 'db down' }, '2025')
    expect(degraded.rosters[0].players[0].performanceContext.uncertainty.some((u) => u.includes('db down'))).toBe(true)
  })
})
