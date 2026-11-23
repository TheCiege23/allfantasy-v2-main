import { describe, expect, it, vi } from 'vitest'

/**
 * My Team's bench check, graded in NBA / NHL / MLB weekly-points leagues (2026-11-23): each sport on its own calendar,
 * under the league's own scoring, into its own line — never the NFL record.
 */

const h = vi.hoisted(() => ({
  window: vi.fn((_sport: string, _season: number, week: number) =>
    week >= 1 ? { start: new Date(Date.UTC(2026, 10, 2 + 7 * (week - 1))), end: new Date(Date.UTC(2026, 10, 9 + 7 * (week - 1))) } : null,
  ),
  importedBridge: vi.fn(async (args: { rosterIds: readonly string[] }) => ({
    gameLogIds: args.rosterIds.map((id) => `id-${id}`),
    rosterIdFor: (g: string) => g.replace(/^id-/, ''),
  })),
  rosterBridge: vi.fn(async (_db: unknown, _keys: string[], ids: string[]) => ({
    gameLogIds: [...ids, ...ids.map((id) => `ri-${id}`)],
    rosterIdFor: (g: string) => g.replace(/^ri-/, ''),
  })),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/season-week/dailySportSeasonStarts', () => ({ resolveDailySportWeekWindow: h.window }))
vi.mock('@/lib/redraft/importedGameLogIdBridge', () => ({ bridgeImportedGameLogIds: h.importedBridge }))
vi.mock('@/lib/redraft/rosterGameLogIdBridge', () => ({ bridgeRosterIdsToGameLogIds: h.rosterBridge }))
// The league's scoring: points per stat as the league's settings say (here: 1 per `pts`, x2 when settings.double).
vi.mock('@/lib/redraft/scoringEngine', () => ({
  buildLeagueStatScorer: (league: { settings?: { double?: boolean; none?: boolean } }) =>
    league.settings?.none ? null : (stats: Record<string, number>) => (stats.pts ?? 0) * (league.settings?.double ? 2 : 1),
}))
vi.mock('@/lib/scoring-runtime/dailySportStatNormalization', () => ({
  getDailySportNormalizer: () => (raw: unknown) => ({ stats: { ...(raw as Record<string, number>) }, unmappedKeys: [] }),
  aggregateWeeklyStats: (rows: unknown[], normalizer: (r: unknown) => { stats: Record<string, number> }) => {
    const stats: Record<string, number> = {}
    for (const r of rows) for (const [k, v] of Object.entries(normalizer(r).stats)) stats[k] = (stats[k] ?? 0) + v
    return { stats, gamesCounted: rows.length, unmappedKeys: [] }
  },
}))
vi.mock('@/lib/sports-data/riSeasonType', () => ({
  resolveStoredSeasonType: (row: { normalizedStatMap: { pre?: boolean } }) => (row.normalizedStatMap?.pre ? 'pre' : 'regular'),
}))

const { sportPeriodState, gradeSportBenchCalls, PERIOD_SETTLE_HOURS } = await import('@/lib/chimmy-outcomes/sportBenchRecord')
const { gradeSportBench, gradeAllSportBench } = await import('@/lib/chimmy-outcomes/sportBenchGrading')

const NOW = new Date(Date.UTC(2026, 10, 23, 12))
const day = (d: number, hour = 0) => new Date(Date.UTC(2026, 10, d, hour))

describe('when a basketball / hockey / baseball period is over — its own schedule, never the NFL calendar', () => {
  const window = { start: day(2), end: day(9) }
  it('over once the window closed and its last scheduled game started more than the settle time ago', () => {
    expect(sportPeriodState({ window, lastStart: day(8, 23) }, NOW)).toBe('over')
    expect(sportPeriodState({ window, lastStart: day(8, 23) }, new Date(day(8, 23).getTime() + (PERIOD_SETTLE_HOURS - 1) * 3_600_000))).toBe('pending')
  })
  it('pending while the window is open, whatever the schedule says', () => {
    expect(sportPeriodState({ window, lastStart: day(3) }, day(5))).toBe('pending')
  })
  it('no scheduled game in it: pending for a week past its end, then unplaceable — never "over" unproven', () => {
    expect(sportPeriodState({ window, lastStart: null }, day(12))).toBe('pending')
    expect(sportPeriodState({ window, lastStart: null }, day(17))).toBe('unplaceable')
    expect(sportPeriodState({ window: null, lastStart: null }, NOW)).toBe('unplaceable')
  })
})

describe('the tally', () => {
  it('right / wrong / same, pending, withdrawn and unscored — a missing line is unscored, never zero', () => {
    const out = gradeSportBenchCalls(
      [
        { withdrawn: false, state: 'over', recPts: 120, altPts: 100 },
        { withdrawn: false, state: 'over', recPts: 90, altPts: 100 },
        { withdrawn: false, state: 'over', recPts: 100.5, altPts: 100 },
        { withdrawn: false, state: 'pending', recPts: null, altPts: null },
        { withdrawn: true, state: 'over', recPts: 1, altPts: 2 },
        { withdrawn: false, state: 'over', recPts: 80, altPts: null },
        { withdrawn: false, state: 'unplaceable', recPts: 80, altPts: 10 },
      ],
      NOW,
    )
    expect(out.tally).toEqual({ right: 1, wrong: 1, same: 1, gain: 10.5, pending: 1, unscored: 2, withdrawn: 1 })
    expect(out.graded).toHaveLength(3)
  })
})

/** A db double: the recorded calls, the schedule, the game lines, the identity positions. */
function dbWith(opts: { rows: unknown[]; lastStart?: Date | null; lines: Array<{ playerId: string; gameDate: Date; normalizedStatMap: Record<string, unknown> }> }) {
  return {
    $queryRaw: vi.fn(async () => opts.rows),
    sportsGame: { findFirst: vi.fn(async () => (opts.lastStart === null ? null : { startTime: opts.lastStart ?? day(8, 23) })) },
    playerGameStat: { findMany: vi.fn(async () => opts.lines.map((l) => ({ ...l, sportType: 'NBA', season: 2026 }))) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
  }
}
const call = (over: Record<string, unknown> = {}) => ({
  league_id: 'L1', platform: 'sleeper', settings: {}, season: 2026, week: 1, withdrawn: false,
  rec_key: '100', alt_key: '200', rec_projected: 110, alt_projected: 100, given_at: day(2), ...over,
})

describe('🛑 an NBA call is graded on that week\'s stored game lines, under the league\'s scoring', () => {
  it('sums each player\'s games inside the week (not before, not after, not preseason) and scores them by the league', async () => {
    const db = dbWith({
      rows: [call()],
      lines: [
        { playerId: 'id-100', gameDate: day(3), normalizedStatMap: { pts: 30 } },
        { playerId: 'id-100', gameDate: day(5), normalizedStatMap: { pts: 25 } },
        { playerId: 'id-100', gameDate: day(10), normalizedStatMap: { pts: 99 } }, // next week
        { playerId: 'id-100', gameDate: day(4), normalizedStatMap: { pts: 99, pre: true } }, // preseason
        { playerId: 'id-200', gameDate: day(4), normalizedStatMap: { pts: 40 } },
      ],
    })
    const out = await gradeSportBench('NBA', { now: NOW, db: db as never })
    expect(out?.tally).toMatchObject({ right: 1, wrong: 0, gain: 15 })
    // Sleeper NBA ids go through the Sleeper-NBA bridge, as the lineup's own pricing does.
    expect(h.importedBridge).toHaveBeenCalledWith(expect.objectContaining({ provider: 'sleeper', sport: 'NBA' }))
    // The league's scoring, not the feed's: doubling the league's points doubles the gain.
    const doubled = await gradeSportBench('NBA', { now: NOW, db: dbWith({ rows: [call({ settings: { double: true } })], lines: [
      { playerId: 'id-100', gameDate: day(3), normalizedStatMap: { pts: 30 } },
      { playerId: 'id-200', gameDate: day(4), normalizedStatMap: { pts: 40 } },
    ] }) as never })
    expect(doubled?.tally).toMatchObject({ wrong: 1, gain: -20 })
  })

  it('a native league\'s ids go through the roster bridge, the translated id winning over the id itself', async () => {
    const db = dbWith({
      rows: [call({ platform: 'allfantasy' })],
      lines: [
        { playerId: '100', gameDate: day(3), normalizedStatMap: { pts: 1 } }, // an identity that merely shares the digits
        { playerId: 'ri-100', gameDate: day(3), normalizedStatMap: { pts: 50 } },
        { playerId: 'ri-200', gameDate: day(3), normalizedStatMap: { pts: 20 } },
      ],
    })
    const out = await gradeSportBench('NHL', { now: NOW, db: db as never })
    expect(out?.tally).toMatchObject({ right: 1, gain: 30 })
  })

  it('not over yet → pending; no line for a player → unscored; a league with no scorer → unscored', async () => {
    expect((await gradeSportBench('NBA', { now: day(8), db: dbWith({ rows: [call()], lines: [] }) as never }))?.tally).toMatchObject({ pending: 1 })
    expect((await gradeSportBench('NBA', { now: NOW, db: dbWith({ rows: [call()], lines: [{ playerId: 'id-100', gameDate: day(3), normalizedStatMap: { pts: 9 } }] }) as never }))?.tally)
      .toMatchObject({ unscored: 1, right: 0, wrong: 0 })
    expect((await gradeSportBench('NBA', { now: NOW, db: dbWith({ rows: [call({ settings: { none: true } })], lines: [{ playerId: 'id-100', gameDate: day(3), normalizedStatMap: { pts: 9 } }, { playerId: 'id-200', gameDate: day(3), normalizedStatMap: { pts: 1 } }] }) as never }))?.tally)
      .toMatchObject({ unscored: 1 })
  })

  it('reads only this sport\'s my_team_bench start/sit rows', async () => {
    const db = dbWith({ rows: [], lines: [] })
    expect(await gradeSportBench('MLB', { now: NOW, db: db as never })).toBeNull()
    const [strings, ...values] = db.$queryRaw.mock.calls[0] as unknown as [readonly string[], ...unknown[]]
    expect(strings.join('?')).toMatch(/upper\(a\.sport\) = \?/)
    expect(values).toContain('MLB')
    expect(values).toContain('my_team_bench')
  })
})

describe('🛑 each sport is contained: one sport\'s failure costs only its own line', () => {
  it('NBA throws, NHL still grades', async () => {
    const db = {
      $queryRaw: vi.fn(async (_s: readonly string[], ...values: unknown[]) => {
        if (values.includes('NBA')) throw new Error('boom')
        if (values.includes('NHL')) return [call({ platform: 'allfantasy' })]
        return []
      }),
      sportsGame: { findFirst: vi.fn(async () => ({ startTime: day(8, 23) })) },
      playerGameStat: { findMany: vi.fn(async () => [{ playerId: 'ri-100', gameDate: day(3), normalizedStatMap: { pts: 5 }, sportType: 'NHL', season: 2026 }, { playerId: 'ri-200', gameDate: day(3), normalizedStatMap: { pts: 1 }, sportType: 'NHL', season: 2026 }]) },
      playerIdentityMap: { findMany: vi.fn(async () => []) },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await gradeAllSportBench({ now: NOW, db: db as never })
    expect(Object.keys(out)).toEqual(['NHL'])
    expect(out.NHL?.tally.right).toBe(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NBA'), 'boom')
    warn.mockRestore()
  })
})

describe('🛑 the ledger rebuild carries each sport\'s line beside the NFL record, and through the NFL offseason', () => {
  it('no NFL weeks scheduled: the snapshot still carries the NBA line, and nothing NFL', async () => {
    const { recomputeLedgerRecord } = await import('@/lib/chimmy-outcomes/ledgerGrading')
    const db = {
      $queryRaw: vi.fn(async (strings: readonly string[], ...values: unknown[]) => {
        const sql = strings.join('?')
        if (sql.includes('FROM "SportsGame"')) return []
        if (sql.includes('chimmy_advice') && values.includes('NBA')) return [call()]
        return []
      }),
      sportsGame: { findFirst: vi.fn(async () => ({ startTime: day(8, 23) })) },
      playerGameStat: { findMany: vi.fn(async () => [{ playerId: 'id-100', gameDate: day(3), normalizedStatMap: { pts: 30 }, sportType: 'NBA', season: 2026 }, { playerId: 'id-200', gameDate: day(3), normalizedStatMap: { pts: 10 }, sportType: 'NBA', season: 2026 }]) },
      playerIdentityMap: { findMany: vi.fn(async () => []) },
    }
    const snap = await recomputeLedgerRecord({ now: NOW, db: db as never })
    expect(snap?.sportBench?.NBA?.tally).toMatchObject({ right: 1, gain: 20 })
    // Its calibration: projected 110 over 100 is a 10% edge on the starter — the `clear` band, one call, silent until 20.
    expect(snap?.sportBench?.NBA?.edges).toEqual({ clear: expect.objectContaining({ n: 1, right: 1 }) })
    expect(snap?.bench).toMatchObject({ right: 0, wrong: 0 })
    expect(snap?.users).toEqual({})
  })

  it('no NFL weeks and no other sport either: no snapshot, as before', async () => {
    const { recomputeLedgerRecord } = await import('@/lib/chimmy-outcomes/ledgerGrading')
    const db = { $queryRaw: vi.fn(async () => []) }
    expect(await recomputeLedgerRecord({ now: NOW, db: db as never })).toBeNull()
  })
})

describe('🛑 a DAILY-lineup call (advice_day, 2026-11-23) is graded on THAT DAY: its games, its lines', () => {
  /** The day's last game: 7pm Eastern on the queried day (EST in November: Eastern midnight is 05:00Z). */
  function dbDaily(rows: unknown[], lines: Array<{ playerId: string; gameDate: Date; normalizedStatMap: Record<string, unknown> }>) {
    return {
      $queryRaw: vi.fn(async () => rows),
      sportsGame: {
        findFirst: vi.fn(async (args: { where: { startTime: { gte: Date; lt: Date } } }) => ({
          startTime: new Date(args.where.startTime.gte.getTime() + 19 * 3_600_000),
        })),
      },
      playerGameStat: { findMany: vi.fn(async () => lines.map((l) => ({ ...l, sportType: 'NBA', season: 2026 }))) },
      playerIdentityMap: { findMany: vi.fn(async () => []) },
    }
  }
  const DAY_LINES = [
    { playerId: 'id-100', gameDate: day(4), normalizedStatMap: { pts: 30 } },
    { playerId: 'id-100', gameDate: day(5), normalizedStatMap: { pts: 1 } }, // the next day, same week
    { playerId: 'id-200', gameDate: day(4), normalizedStatMap: { pts: 20 } },
    { playerId: 'id-200', gameDate: day(3), normalizedStatMap: { pts: 99 } }, // the day before, same week
  ]

  it('only lines dated that day count — not the rest of its week (which would grade it wrong)', async () => {
    const out = await gradeSportBench('NBA', { now: NOW, db: dbDaily([call({ day: '2026-11-04' })], DAY_LINES) as never })
    expect(out?.tally).toMatchObject({ right: 1, wrong: 0, gain: 10 })
  })

  it('over once that day\'s last game started 12h+ ago, found inside the US Eastern day', async () => {
    const db = dbDaily([call({ day: '2026-11-04' })], DAY_LINES)
    // Eastern Nov 4 (EST) = 05:00Z Nov 4 → 05:00Z Nov 5; its last game 00:00Z Nov 5 (7pm ET).
    const lastStart = Date.UTC(2026, 10, 5, 0)
    expect((await gradeSportBench('NBA', { now: new Date(lastStart + 11 * 3_600_000), db: db as never }))?.tally).toMatchObject({ pending: 1, right: 0 })
    expect((await gradeSportBench('NBA', { now: new Date(lastStart + 13 * 3_600_000), db: db as never }))?.tally).toMatchObject({ pending: 0, right: 1 })
    const where = db.sportsGame.findFirst.mock.calls[0][0].where.startTime
    expect(where.gte.toISOString()).toBe('2026-11-04T05:00:00.000Z')
    expect(where.lt.toISOString()).toBe('2026-11-05T05:00:00.000Z')
  })

  it('two days of one week are two calls, and a weekly call beside them still sums its week', async () => {
    const out = await gradeSportBench('NBA', {
      now: NOW,
      db: dbDaily([call({ day: '2026-11-04' }), call({ day: '2026-11-05' }), call({ day: '' })], DAY_LINES) as never,
    })
    // Nov 4: 30 v 20 right (+10). Nov 5: 1 v no line → unscored. The week: 31 v 119 wrong (-88).
    expect(out?.tally).toMatchObject({ right: 1, wrong: 1, unscored: 1, gain: -78 })
    expect(out?.graded).toHaveLength(2)
  })

  it('before the day migration the read falls back to the original SELECT, and every call is weekly', async () => {
    const db = dbDaily([call()], DAY_LINES)
    const undefinedColumn = Object.assign(new Error('column a.advice_day does not exist'), { code: 'P2010', meta: { code: '42703' } })
    db.$queryRaw.mockRejectedValueOnce(undefinedColumn)
    const out = await gradeSportBench('NBA', { now: NOW, db: db as never })
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
    const sqlOf = (n: number) => (db.$queryRaw.mock.calls[n] as unknown as [readonly string[]])[0].join('?')
    expect(sqlOf(0)).toContain('a.advice_day AS day')
    expect(sqlOf(1)).not.toContain('advice_day')
    // The whole week: 31 v 119.
    expect(out?.tally).toMatchObject({ wrong: 1, gain: -88 })
  })

  it('any other read error still propagates (contained per sport by the caller)', async () => {
    const db = dbDaily([], [])
    db.$queryRaw.mockRejectedValueOnce(new Error('connection reset'))
    await expect(gradeSportBench('NBA', { now: NOW, db: db as never })).rejects.toThrow('connection reset')
  })
})
