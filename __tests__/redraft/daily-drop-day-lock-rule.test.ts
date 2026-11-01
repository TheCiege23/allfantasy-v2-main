/**
 * The same-day drop rule for daily-lineup leagues (lib/redraft/dailyLineups.ts `daysOnRoster`,
 * owner's delegate 2026-10-27). A drop or an add on a game day is decided by his game's lock:
 *
 *   1. dropped after his game locked: the day's points stay with the team that dropped him, and a
 *      team that adds him later that day scores nothing for it;
 *   2. dropped before his game locked, nobody adds him: the day's points count for nobody;
 *   3. dropped before the lock, another team adds and starts him before it: that team scores them.
 *
 * Scored end to end through `scoreRosterForWeek`, both rosters, so a double count shows as a sum.
 * The roster-player mock honours the rosterId and droppedAt filters it is given.
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
  playerWeeklyScore: { findUnique: vi.fn(), findMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  sportsGame: { findMany: vi.fn(async () => []) },
}))
const lock = vi.hoisted(() => ({ kickoffs: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/lineupLock', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/redraft/lineupLock')>()
  return { ...real, buildWeekKickoffMap: lock.kickoffs }
})
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { daysOnRoster } from '@/lib/redraft/dailyLineups'
import { normalizeLockTeam } from '@/lib/redraft/lineupLock'
import { calculateScoreFromSportConfig, scoreRosterForWeek } from '@/lib/redraft/scoringEngine'

const DAILY_ON = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const keys = (ds: Date[]) => ds.map((d) => d.toISOString().slice(0, 10))

const TEAM = 'Boston Celtics'
/** His only game of the swing day, Wednesday 2026-10-21: 7:00pm Eastern. */
const TIP = new Date('2026-10-21T23:00:00.000Z')
const BEFORE_TIP = (h: number) => new Date(`2026-10-21T${String(h).padStart(2, '0')}:00:00.000Z`)
const AFTER_TIP = (m: number) => new Date(`2026-10-21T23:${String(m).padStart(2, '0')}:00.000Z`)

describe('daysOnRoster with the lock', () => {
  const days = [day('2026-10-20'), day('2026-10-21'), day('2026-10-22')]
  const lockOn = (d: Date) => (d.getTime() === day('2026-10-21').getTime() ? TIP : null)

  it('a drop after the lock keeps the day; a drop before it does not', () => {
    expect(keys(daysOnRoster({ addedAt: null, droppedAt: AFTER_TIP(30) }, days, lockOn))).toEqual(['2026-10-20', '2026-10-21'])
    expect(keys(daysOnRoster({ addedAt: null, droppedAt: BEFORE_TIP(15) }, days, lockOn))).toEqual(['2026-10-20'])
  })
  it('an add before the lock takes the day; an add after it does not', () => {
    expect(keys(daysOnRoster({ addedAt: BEFORE_TIP(16), droppedAt: null }, days, lockOn))).toEqual(['2026-10-21', '2026-10-22'])
    expect(keys(daysOnRoster({ addedAt: AFTER_TIP(45), droppedAt: null }, days, lockOn))).toEqual(['2026-10-22'])
  })
  it('[control] no known lock keeps the whole-day rule', () => {
    expect(keys(daysOnRoster({ addedAt: null, droppedAt: BEFORE_TIP(15) }, days, () => null))).toEqual(['2026-10-20', '2026-10-21'])
    expect(keys(daysOnRoster({ addedAt: null, droppedAt: BEFORE_TIP(15) }, days))).toEqual(['2026-10-20', '2026-10-21'])
  })
})

describe('scoring a mid-day drop', () => {
  let rows: AnyArgs[] = []
  let lineupRows: AnyArgs[] = []

  /** `droppedAt` for the dropping team; `addedAt` for the adding team, or null when nobody adds him. */
  function arrange(droppedAt: Date, addedAt: Date | null, opts: { lockKnown?: boolean } = {}) {
    vi.clearAllMocks()
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: DAILY_ON })
    db.league.findUnique.mockResolvedValue({ sport: 'NBA', settings: DAILY_ON })
    lock.kickoffs.mockResolvedValue({
      byTeam: new Map(),
      firstKickoff: null,
      byTeamDay: opts.lockKnown === false ? new Map() : new Map([[normalizeLockTeam('NBA', TEAM), new Map([['2026-10-21', TIP]])]]),
      warnings: [],
    })
    rows = [
      { id: 'rp-drop-keep', rosterId: 'r-dropper', playerId: 'pl-anchor', playerName: 'Anchor', position: 'PG', team: 'Denver Nuggets', sport: 'NBA', slotType: 'PG', addedAt: new Date('2026-10-01T12:00:00Z'), droppedAt: null },
      { id: 'rp-drop-swing', rosterId: 'r-dropper', playerId: 'pl-swing', playerName: 'Swing', position: 'SF', team: TEAM, sport: 'NBA', slotType: 'SF', addedAt: new Date('2026-10-01T12:00:00Z'), droppedAt },
      ...(addedAt
        ? [{ id: 'rp-add-swing', rosterId: 'r-adder', playerId: 'pl-swing', playerName: 'Swing', position: 'SF', team: TEAM, sport: 'NBA', slotType: 'SF', addedAt, droppedAt: null }]
        : []),
    ]
    lineupRows = [
      { rosterId: 'r-dropper', playerId: 'pl-anchor', scoringDay: day('2026-10-20'), slotType: 'PG' },
      { rosterId: 'r-dropper', playerId: 'pl-swing', scoringDay: day('2026-10-20'), slotType: 'SF' },
      // The adding team starts him on the swing day.
      ...(addedAt ? [{ rosterId: 'r-adder', playerId: 'pl-swing', scoringDay: day('2026-10-21'), slotType: 'SF' }] : []),
    ]
    db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: AnyArgs) =>
      rows.filter((r) => {
        if (where.rosterId && r.rosterId !== where.rosterId) return false
        const or = (where.OR ?? []) as AnyArgs[]
        if (!or.length) return true
        return or.some((c) => (c.droppedAt === null ? r.droppedAt === null : r.droppedAt !== null && r.droppedAt >= c.droppedAt.gte))
      }),
    )
    db.redraftDailyLineup.findMany.mockImplementation(async ({ where }: AnyArgs) =>
      lineupRows.filter((r) => (where.rosterId.in as string[]).includes(r.rosterId)),
    )
    db.playerDailyScore.findMany.mockResolvedValue([
      { playerId: 'pl-anchor', scoringDay: day('2026-10-20'), stats: { pts: 12 }, isFinalized: true },
      { playerId: 'pl-swing', scoringDay: day('2026-10-20'), stats: { pts: 10 }, isFinalized: true },
      { playerId: 'pl-swing', scoringDay: day('2026-10-21'), stats: { pts: 40 }, isFinalized: true }, // the swing day
    ])
    db.playerWeeklyScore.findUnique.mockResolvedValue({ isFinalized: true })
  }

  const pts = (n: number, pos: string) => calculateScoreFromSportConfig('lg-drop-rule', 'x', 1, { pts: n }, pos)
  const round = (n: number) => Math.round(n * 100) / 100
  const score = (rosterId: string) => scoreRosterForWeek({ leagueId: 'lg-drop-rule', rosterId, week: 1, seasonYear: 2026 })

  it('1. dropped after his game locked: the dropping team keeps the day, a later add scores none of it', async () => {
    arrange(AFTER_TIP(30), AFTER_TIP(45))
    const dropper = await score('r-dropper')
    const adder = await score('r-adder')
    expect(dropper.points).toBe(round((await pts(12, 'PG')) + (await pts(10, 'SF')) + (await pts(40, 'SF'))))
    expect(adder.points).toBe(0)
  })

  it('2. dropped before his game locked, nobody adds him: the day counts for nobody', async () => {
    arrange(BEFORE_TIP(15), null)
    const dropper = await score('r-dropper')
    expect(dropper.points).toBe(round((await pts(12, 'PG')) + (await pts(10, 'SF'))))
  })

  it('3. dropped before the lock, added and started by another team before it: that team scores the day, once', async () => {
    arrange(BEFORE_TIP(15), BEFORE_TIP(16))
    const dropper = await score('r-dropper')
    const adder = await score('r-adder')
    expect(dropper.points).toBe(round((await pts(12, 'PG')) + (await pts(10, 'SF'))))
    expect(adder.points).toBe(round(await pts(40, 'SF')))
  })

  it('[control] an unread schedule keeps the whole-day rule rather than take a game off a score', async () => {
    arrange(BEFORE_TIP(15), null, { lockKnown: false })
    const dropper = await score('r-dropper')
    expect(dropper.points).toBe(round((await pts(12, 'PG')) + (await pts(10, 'SF')) + (await pts(40, 'SF'))))
  })
})
