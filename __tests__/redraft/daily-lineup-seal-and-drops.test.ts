/**
 * Two gaps in daily-lineup scoring (follow-up to the phases B+C work):
 *
 *  1. The week finalizer must cover and seal EVERY player who started on any day of the week, or a
 *     player started Tuesday and benched Wednesday keeps the matchup from ever going final.
 *  2. A player dropped mid-week still counts for the days he started, so dropping him after a bad
 *     game cannot take that game off the score.
 *
 * The roster-player mock honours the `droppedAt` filter it is given — a mock that returns every row
 * whatever the `where` says would pass with the drop fix deleted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn(), findUnique: vi.fn() },
  redraftDailyLineup: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
  playerDailyScore: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftMatchup: { findMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  sportsGame: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { daysOnRoster } from '@/lib/redraft/dailyLineups'
import { calculateScoreFromSportConfig, scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { finalizeRedraftWeek } from '@/lib/redraft/weekFinalizer'

const DAILY_ON = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** Apply the `droppedAt` part of a where clause the way Postgres would. */
function honoursDroppedAt(rows: Array<{ droppedAt: Date | null }>, where: AnyArgs) {
  const matches = (r: { droppedAt: Date | null }, w: AnyArgs): boolean => {
    if (w.OR) return (w.OR as AnyArgs[]).some((c) => matches(r, c))
    if (!('droppedAt' in w)) return true
    if (w.droppedAt === null) return r.droppedAt === null
    if (w.droppedAt?.gte) return r.droppedAt !== null && r.droppedAt >= w.droppedAt.gte
    return true
  }
  return rows.filter((r) => matches(r, where))
}

describe('daysOnRoster', () => {
  const days = [day('2026-10-20'), day('2026-10-21'), day('2026-10-22'), day('2026-10-23')]
  it('counts the add day through the drop day, inclusive', () => {
    const p = { addedAt: new Date('2026-10-21T15:00:00Z'), droppedAt: new Date('2026-10-23T02:00:00Z') } // 10-22 22:00 ET
    expect(daysOnRoster(p, days).map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-10-21', '2026-10-22'])
    expect(daysOnRoster({ addedAt: null, droppedAt: null }, days)).toHaveLength(4)
  })
})

describe('a player dropped mid-week', () => {
  const rows = [
    { id: 'a', rosterId: 'r1', playerId: 'kept', playerName: 'kept', position: 'PG', sport: 'NBA', slotType: 'PG', addedAt: new Date('2026-10-01T12:00:00Z'), droppedAt: null },
    // Started Tuesday, dropped Wednesday afternoon.
    { id: 'b', rosterId: 'r1', playerId: 'dropped', playerName: 'dropped', position: 'SF', sport: 'NBA', slotType: 'SF', addedAt: new Date('2026-10-01T12:00:00Z'), droppedAt: new Date('2026-10-21T19:00:00Z') },
  ]
  beforeEach(() => {
    vi.clearAllMocks()
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: DAILY_ON })
    db.league.findUnique.mockResolvedValue({ sport: 'NBA', settings: DAILY_ON })
    db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: AnyArgs) => honoursDroppedAt(rows, where))
    db.redraftDailyLineup.findMany.mockResolvedValue([
      { rosterId: 'r1', playerId: 'kept', scoringDay: day('2026-10-20'), slotType: 'PG' },
      { rosterId: 'r1', playerId: 'dropped', scoringDay: day('2026-10-20'), slotType: 'SF' },
    ])
    db.playerDailyScore.findMany.mockResolvedValue([
      { playerId: 'kept', scoringDay: day('2026-10-20'), stats: { pts: 10 }, isFinalized: true },
      { playerId: 'dropped', scoringDay: day('2026-10-20'), stats: { pts: 30 }, isFinalized: true }, // counts
      { playerId: 'dropped', scoringDay: day('2026-10-23'), stats: { pts: 25 }, isFinalized: true }, // after the drop
    ])
    db.playerWeeklyScore.findUnique.mockResolvedValue({ isFinalized: true })
  })

  it('still scores the days he started before the drop, and none after it', async () => {
    const pts = async (n: number, pos: string) => calculateScoreFromSportConfig('L1', 'x', 1, { pts: n }, pos)
    const expected = Math.round(((await pts(10, 'PG')) + (await pts(30, 'SF'))) * 100) / 100
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })
    expect(r.points).toBe(expected)
    expect(r.starterCount).toBe(2)
  })
})

describe('sealing a daily-lineup week', () => {
  /** NHL week 1 runs 2026-09-29 → 2026-10-06. */
  const AFTER_GRACE = new Date('2026-10-06T12:00:00.000Z')
  const rows = [
    { rosterId: 'r1', playerId: 'p1', position: 'C', sport: 'NHL', slotType: 'C', addedAt: null, droppedAt: null },
    // On the bench now; he started on the Tuesday.
    { rosterId: 'r1', playerId: 'p2', position: 'LW', sport: 'NHL', slotType: 'bench', addedAt: null, droppedAt: null },
  ]

  function arrange(settings: unknown) {
    vi.clearAllMocks()
    db.league.findFirst.mockResolvedValue(null)
    db.league.findUnique.mockResolvedValue({ sport: 'NHL', settings })
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', leagueId: 'L1', sport: 'NHL', season: 2026 })
    db.redraftMatchup.findMany.mockResolvedValue([{ id: 'm1', status: 'active', awayRosterId: 'r2' }])
    db.sportsGame.findMany.mockResolvedValue([
      { status: 'final', startTime: new Date('2026-10-05T23:00:00.000Z'), source: 'thesportsdb', fetchedAt: new Date('2026-10-06T06:00:00Z'), season: 2026, week: 1 },
    ])
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'r1' }])
    db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: AnyArgs) => honoursDroppedAt(rows, where))
    db.redraftDailyLineup.findMany.mockResolvedValue([
      { rosterId: 'r1', playerId: 'p1', scoringDay: day('2026-09-29'), slotType: 'C' },
      { rosterId: 'r1', playerId: 'p2', scoringDay: day('2026-09-29'), slotType: 'LW' },
      { rosterId: 'r1', playerId: 'p1', scoringDay: day('2026-09-30'), slotType: 'C' },
      { rosterId: 'r1', playerId: 'p2', scoringDay: day('2026-09-30'), slotType: 'bench' },
    ])
    db.playerWeeklyScore.findMany.mockImplementation(async (args: AnyArgs) =>
      (args.where.playerId.in as string[]).map((playerId) => ({ playerId, sport: 'NHL' })),
    )
    db.playerWeeklyScore.createMany.mockImplementation(async (args: AnyArgs) => ({ count: args.data.length }))
    db.playerWeeklyScore.updateMany.mockResolvedValue({ count: 2 })
  }

  const run = () =>
    finalizeRedraftWeek(
      { seasonId: 's1', week: 1 },
      { prisma: db as any, now: () => AFTER_GRACE, recalculateMatchups: vi.fn(async () => undefined) as any, notifyResults: vi.fn(async () => undefined) },
    )

  it('covers and seals every player who started on any day', async () => {
    arrange(DAILY_ON)
    const result = await run()
    expect(result.refusal).toBeNull()
    expect(result.starters).toBe(2)
    const sealed = db.playerWeeklyScore.updateMany.mock.calls[0][0].where.playerId.in as string[]
    expect([...sealed].sort()).toEqual(['p1', 'p2'])
  })

  it('a weekly league still covers only the current starters and never reads daily rows', async () => {
    arrange({})
    const result = await run()
    expect(result.starters).toBe(1)
    expect(db.redraftDailyLineup.findMany).not.toHaveBeenCalled()
  })
})
