/**
 * Contest best ball lineups store the rules they were scored under (lib/bestball/resultRuleStamp.ts).
 * League matchups already carried `redraftScoring.bestBallRules`; the contest rows that contest scoring
 * reads (`BestBallOptimizedLineup` for a `BestBallEntry`, written by runBestBallOptimizer) did not. They
 * now carry the same record in `optimizerLog.bestBallRules`: the optimizer that ran, the template slots
 * it seated, and a scoring fingerprint (null, with the reason, because a contest has no scoring rules of
 * its own). Prisma is mocked; nothing touches a database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  template: null as null | { lineupSlots: unknown; scoringPeriod: string },
  scores: new Map<string, number>(),
  create: vi.fn(async (args: { data: Record<string, unknown> }) => args.data),
  update: vi.fn(async (args: { data: Record<string, unknown> }) => args.data),
  existing: null as null | Record<string, unknown>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bestBallEntry: {
      findFirst: vi.fn(async () => ({
        id: 'e1',
        contestId: 'c1',
        contest: { variant: 'tournament', contestStartsAt: new Date('2026-09-01T00:00:00Z') },
        roster: [
          { playerId: 'qb1', playerName: 'QB One', position: 'QB' },
          { playerId: 'rb1', playerName: 'RB One', position: 'RB' },
          { playerId: 'wr1', playerName: 'WR One', position: 'WR' },
        ],
      })),
    },
    league: { findFirst: vi.fn(async () => null) },
    bestBallSportTemplate: { findUnique: vi.fn(async () => m.template) },
    playerWeeklyScore: {
      findUnique: vi.fn(async (args: { where: { playerId_week_season_sport: { playerId: string } } }) => {
        const id = args.where.playerId_week_season_sport.playerId
        return m.scores.has(id) ? { fantasyPts: m.scores.get(id), isFinalized: true } : null
      }),
    },
    bestBallOptimizedLineup: {
      findFirst: vi.fn(async () => m.existing),
      create: m.create,
      update: m.update,
    },
  },
}))

import { runBestBallOptimizer } from '@/lib/bestball/optimizer'
import { OPTIMAL_LINEUP_ALGORITHM } from '@/lib/lineup-optimizer/optimalLineup'

type Stamp = {
  v: number
  algorithm: string
  slots: { slot: string; eligible: string[]; count: number; min?: number; max?: number }[]
  scoringFingerprint: string | null
  scoringSource: string
}
const stampOf = (row: unknown) => ((row as { optimizerLog: { bestBallRules?: Stamp } }).optimizerLog.bestBallRules)

beforeEach(() => {
  m.create.mockClear()
  m.update.mockClear()
  m.existing = null
  m.scores = new Map([['qb1', 20], ['rb1', 15], ['wr1', 12]])
  m.template = {
    scoringPeriod: 'weekly',
    lineupSlots: [
      { slot: 'QB', eligible: ['QB'], count: 1 },
      { slot: 'FLEX', eligible: ['RB', 'WR'], count: 1 },
    ],
  }
})

describe('contest optimized lineup rule stamp', () => {
  it('a contest row records the optimizer, the template slots it seated, and why there is no fingerprint', async () => {
    const row = await runBestBallOptimizer({ entryId: 'e1', week: 3, sport: 'NFL' })
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(stampOf(row)).toEqual({
      v: 1,
      algorithm: OPTIMAL_LINEUP_ALGORITHM,
      slots: [
        { slot: 'QB', eligible: ['QB'], count: 1 },
        { slot: 'FLEX', eligible: ['RB', 'WR'], count: 1 },
      ],
      scoringFingerprint: null,
      scoringSource: 'PlayerWeeklyScore.fantasyPts',
    })
    // The stamp sits beside the existing log; nothing it already carried is lost.
    const log = (row as { optimizerLog: Record<string, unknown> }).optimizerLog
    expect(log.algorithm).toBe(OPTIMAL_LINEUP_ALGORITHM)
    expect((log.dataQuality as { status: string }).status).toBe('AVAILABLE')
    expect((row as { totalPoints: number }).totalPoints).toBe(35)
  })

  it('the stamp follows the template the row was seated on: a template change shows in the next row', async () => {
    m.template = { scoringPeriod: 'weekly', lineupSlots: [{ slot: 'QB', eligible: ['QB'], count: 1 }, { slot: 'RB', eligible: ['RB'], count: 1 }, { slot: 'WR', eligible: ['WR'], count: 1 }] }
    m.existing = { id: 'row1', optimizerLog: {} }
    const row = await runBestBallOptimizer({ entryId: 'e1', week: 3, sport: 'NFL' })
    expect(m.update).toHaveBeenCalledTimes(1)
    expect(stampOf(row)?.slots.map((s) => s.slot)).toEqual(['QB', 'RB', 'WR'])
    expect((row as { totalPoints: number }).totalPoints).toBe(47)
  })

  it('a SOCCER formation template records the formation optimizer and keeps the min/max range it seated', async () => {
    m.scores = new Map([['qb1', 1]])
    m.template = {
      scoringPeriod: 'weekly',
      lineupSlots: [
        { slot: 'GK', eligible: ['GK'], count: 1, min: 1, max: 1 },
        { slot: 'DEF', eligible: ['DEF'], count: 4, min: 3, max: 5 },
      ],
    }
    const row = await runBestBallOptimizer({ entryId: 'e1', week: 3, sport: 'SOCCER' })
    const stamp = stampOf(row)!
    expect(stamp.algorithm).toBe('soccer-formation-v1')
    expect(stamp.slots).toEqual([
      { slot: 'GK', eligible: ['GK'], count: 1, min: 1, max: 1 },
      { slot: 'DEF', eligible: ['DEF'], count: 4, min: 3, max: 5 },
    ])
  })
})
