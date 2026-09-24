/**
 * Closing an NHL week, whose "week" is a date window rather than a column.
 *
 * 🛑 `SportsGame.week` IS NOISE FOR A DAILY SPORT. Measured on production 2026-09-24: NHL
 * season 2026 holds 1,373 `thesportsdb` rows carrying 29 distinct "weeks" ranging 1..500. The
 * sport has no week, so the feed fills the column arbitrarily — querying `week: N` against it
 * picks an arbitrary handful of games and calls that a slate.
 *
 * So the finalizer reads a daily sport's slate by DATE, over the same seven days
 * `syncPlayerWeeklyScoresForRedraftSeason` already aggregates its stats across, anchored on the
 * same recorded opener (NHL 2026 = 2026-09-29).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { DATE_WINDOWED_SPORTS, WEEK_KEYED_SPORTS, finalizeRedraftWeek } from '@/lib/redraft/weekFinalizer'

type AnyArgs = Record<string, any>

const NHL_SEASON = { id: 'season-nhl', leagueId: 'league-nhl', sport: 'NHL', season: 2026 }
/** Week 1 runs 2026-09-29 → 2026-10-06; 13h after the last puck drop clears the 12h grace. */
const LAST_PUCK = '2026-10-05T23:00:00.000Z'
const AFTER_GRACE = new Date('2026-10-06T12:00:00.000Z')

function game(status: string, startTime: string, week: number | null) {
  return {
    status,
    startTime: new Date(startTime),
    source: 'thesportsdb',
    fetchedAt: new Date('2026-10-06T06:00:00.000Z'),
    season: 2026,
    // The junk the feed actually writes.
    week,
  }
}

function makePrisma(games: ReturnType<typeof game>[], scored: string[] = ['p1', 'p2']) {
  const calls: Array<{ key: string; args: AnyArgs }> = []
  return {
    calls,
    prisma: {
      league: { findFirst: vi.fn(async () => null) },
      redraftSeason: { findFirst: vi.fn(async () => NHL_SEASON) },
      redraftMatchup: {
        findMany: vi.fn(async () => [{ id: 'm1', status: 'active' }]),
      },
      sportsGame: {
        findMany: vi.fn(async (args: AnyArgs) => {
          calls.push({ key: 'sportsGame.findMany', args })
          return games
        }),
      },
      redraftRoster: { findMany: vi.fn(async () => [{ id: 'r1' }]) },
      redraftRosterPlayer: {
        findMany: vi.fn(async () => [
          { playerId: 'p1', sport: 'NHL', slotType: 'C' },
          { playerId: 'p2', sport: 'NHL', slotType: 'LW' },
        ]),
      },
      playerWeeklyScore: {
        findMany: vi.fn(async () => scored.map((playerId) => ({ playerId, sport: 'NHL' }))),
        createMany: vi.fn(async (args: AnyArgs) => ({ count: args.data.length })),
        updateMany: vi.fn(async () => ({ count: scored.length })),
      },
    } as any,
  }
}

beforeEach(() => vi.clearAllMocks())

/*
 * NCAAB (switched on 2026-09-24): its slate comes from the Rolling Insights season schedule in
 * SportsDataCache (lib/sports-data/riSeasonSchedule.ts), NEVER from SportsGame, whose NCAAB
 * schedules are incomplete (thesportsdb stops at a 3,000-game cap).
 */
const NCAAB_SEASON = { id: 'season-cbb', leagueId: 'league-cbb', sport: 'NCAAB', season: 2026 }
/** Week 1 runs Monday 2026-11-02 -> 2026-11-09 (Eastern days). */
const CBB_AFTER_GRACE = new Date('2026-11-09T14:00:00.000Z')

function makeNcaabPrisma(schedule: Record<string, unknown> | null, scored: string[] = ['p1', 'p2']) {
  const base = makePrisma([], scored)
  const store = new Map<string, unknown>(schedule ? Object.entries(schedule) : [])
  return {
    ...base,
    prisma: {
      ...base.prisma,
      league: { findFirst: vi.fn(async () => null) },
      redraftSeason: { findFirst: vi.fn(async () => NCAAB_SEASON) },
      redraftRosterPlayer: {
        findMany: vi.fn(async () => [
          { playerId: 'p1', sport: 'NCAAB', slotType: 'PG' },
          { playerId: 'p2', sport: 'NCAAB', slotType: 'C' },
        ]),
      },
      sportsDataCache: {
        findUnique: vi.fn(async (args: AnyArgs) => (store.has(args.where.cacheKey) ? { data: store.get(args.where.cacheKey) } : null)),
        findMany: vi.fn(async (args: AnyArgs) =>
          (args.where.cacheKey.in as string[]).filter((k) => store.has(k)).map((k) => ({ cacheKey: k, data: store.get(k) })),
        ),
      },
    },
  }
}

const cbbGame = (gameId: string, day: string, status: string, startTime: string) => ({
  gameId, day, startTime, status, seasonType: 'regular', eventName: null, replacedBy: null,
})

describe('finalizeRedraftWeek — NCAAB reads the Rolling Insights schedule', () => {
  it('lists NCAAB as date-windowed', () => {
    expect(DATE_WINDOWED_SPORTS).toContain('NCAAB')
  })

  it('REFUSES while the season schedule is unsynced (2026-27 still 304s) — and never falls back to SportsGame', async () => {
    const { prisma } = makeNcaabPrisma(null)
    const result = await finalizeRedraftWeek(
      { seasonId: 'season-cbb', week: 1, dryRun: true },
      { prisma, now: () => CBB_AFTER_GRACE, recalculateMatchups: vi.fn() as any },
    )
    expect(result.finalized).toBe(false)
    expect(result.refusal).toBe('no_games_on_slate')
    expect(result.slate?.source).toMatch(/not synced/)
    expect(prisma.sportsGame.findMany).not.toHaveBeenCalled()
  })

  it('gets past the slate when the synced week is all final — a replaced game does not hold it open', async () => {
    const { prisma } = makeNcaabPrisma({
      'NCAAB:rischedule:2026:meta': { games: 3 },
      'NCAAB:rischedule:2026:2026-11-02': { games: [cbbGame('20261102-1-2', '2026-11-02', 'final', '2026-11-02T23:00:00.000Z')] },
      'NCAAB:rischedule:2026:2026-11-08': {
        games: [
          cbbGame('20261108-3-4', '2026-11-08', 'completed', '2026-11-08T23:00:00.000Z'),
          cbbGame('20261108-5-6', '2026-11-08', 'replaced', '2026-11-08T20:00:00.000Z'),
        ],
      },
    })
    const result = await finalizeRedraftWeek(
      { seasonId: 'season-cbb', week: 1, dryRun: true },
      { prisma, now: () => CBB_AFTER_GRACE, recalculateMatchups: vi.fn() as any },
    )
    expect(result.slate).toMatchObject({ games: 3, final: 2, cancelled: 1, unfinished: 0, source: 'rolling_insights_schedule' })
    expect(['games_not_final', 'no_games_on_slate', 'season_start_unknown']).not.toContain(result.refusal)
  })

  it('holds the week open for a game still scheduled', async () => {
    const { prisma } = makeNcaabPrisma({
      'NCAAB:rischedule:2026:meta': { games: 1 },
      'NCAAB:rischedule:2026:2026-11-08': { games: [cbbGame('20261108-3-4', '2026-11-08', 'scheduled', '2026-11-08T23:00:00.000Z')] },
    })
    const result = await finalizeRedraftWeek(
      { seasonId: 'season-cbb', week: 1, dryRun: true },
      { prisma, now: () => CBB_AFTER_GRACE, recalculateMatchups: vi.fn() as any },
    )
    expect(result.refusal).toBe('games_not_final')
  })
})

describe('finalizeRedraftWeek — a daily sport', () => {
  it('lists NHL as date-windowed, not week-keyed', () => {
    expect(WEEK_KEYED_SPORTS).not.toContain('NHL')
    expect(DATE_WINDOWED_SPORTS).toContain('NHL')
  })

  /**
   * ⚠ THE ASSERTION THAT MATTERS IS THE QUERY SHAPE. A slate read that still filtered on
   * `week` would select games from across the season and look plausible while being wrong.
   */
  it('reads the slate by date window and never by week', async () => {
    const { prisma, calls } = makePrisma([
      game('FT', '2026-09-29T23:00:00.000Z', 500),
      game('FT', '2026-10-02T23:00:00.000Z', 1),
      game('AOT', LAST_PUCK, 37),
    ])

    await finalizeRedraftWeek(
      { seasonId: 'season-nhl', week: 1, dryRun: true },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any },
    )

    const where = calls.find((c) => c.key === 'sportsGame.findMany')?.args.where
    expect(where.week).toBeUndefined()
    expect(where.startTime.gte.toISOString()).toBe('2026-09-29T00:00:00.000Z')

    // ⚠ The upper bound OVER-SELECTS past the window's end on purpose: a game played on the
    // last Eastern evening has a UTC instant on the following day, and the exact membership
    // test is `easternCalendarDay` in JS. Asserted as "at least the window, and less than a
    // day past it" rather than a magic constant, so the margin can change without a false red.
    const end = where.startTime.lt.getTime()
    expect(end).toBeGreaterThan(Date.parse('2026-10-06T00:00:00.000Z'))
    expect(end).toBeLessThanOrEqual(Date.parse('2026-10-07T00:00:00.000Z'))
  })

  /**
   * TheSportsDB's vocabulary, which is what NHL actually arrives in: `FT` full time,
   * `AOT` after overtime, `AP` after penalties. All three are finished games.
   */
  it('counts the provider\'s own finished statuses as final', async () => {
    const { prisma } = makePrisma([
      game('FT', '2026-09-29T23:00:00.000Z', 500),
      game('AOT', '2026-10-02T23:00:00.000Z', 1),
      game('AP', LAST_PUCK, 37),
    ])

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-nhl', week: 1, dryRun: true },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any },
    )

    expect(result.slate?.games).toBe(3)
    expect(result.slate?.final).toBe(3)
    expect(result.slate?.unfinished).toBe(0)
    expect(result.refusal).toBeNull()
  })

  it('still holds the week open for a game that has not started', async () => {
    const { prisma } = makePrisma([
      game('FT', '2026-09-29T23:00:00.000Z', 500),
      game('NS', LAST_PUCK, 37),
    ])

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-nhl', week: 1, dryRun: true },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any },
    )

    expect(result.refusal).toBe('games_not_final')
  })

  /**
   * 🛑 A SEASON NOBODY HAS RECORDED GETS ITS OWN REFUSAL, NOT `sport_not_week_keyed`. The fix
   * is one dated line in `dailySportSeasonStarts.ts`; the other refusal would send the reader
   * to rewrite a subsystem instead.
   */
  it('names the missing opener rather than blaming the sport', async () => {
    const { prisma } = makePrisma([])
    prisma.redraftSeason.findFirst = vi.fn(async () => ({ ...NHL_SEASON, season: 2031 }))

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-nhl', week: 1, dryRun: true },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any },
    )

    expect(result.refusal).toBe('season_start_unknown')
    // It refused before reading a slate, rather than reading an empty one and blaming that.
    expect(prisma.sportsGame.findMany).not.toHaveBeenCalled()
  })

  /**
   * 🛑 THE WINDOW IS EASTERN DAYS, NOT UTC INSTANTS, AND FOR NHL THAT IS MOST OF THE SEASON.
   *
   * `player_game_stats.game_date` stores the EASTERN calendar day (#1194) and the stat sync
   * buckets by it. Measured on production 2026-09-24: 957 of 1,415 NHL 2026 games — 67.6% —
   * start after UTC midnight, because a 7-10pm Eastern puck drop is the next UTC day. Week 1
   * holds 42 games by UTC instant against 43 by Eastern day — so a slate selected on the
   * instant is SHORT one game, and a short slate can report itself complete and seal a week
   * whose stats include a game it never checked.
   */
  it('includes a game played on the window\'s last Eastern evening, after UTC midnight', async () => {
    // 2026-10-06T01:30Z is 9:30pm on Oct 5 in New York — inside week 1 (Sep 29 – Oct 5).
    const { prisma } = makePrisma([
      game('FT', '2026-09-29T23:00:00.000Z', 500),
      game('FT', '2026-10-06T01:30:00.000Z', 12),
    ])

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-nhl', week: 1, dryRun: true },
      { prisma, now: () => new Date('2026-10-06T18:00:00.000Z'), recalculateMatchups: vi.fn() as any },
    )

    expect(result.slate?.games).toBe(2)
    expect(result.slate?.final).toBe(2)
  })

  it('excludes a game whose Eastern day falls in the NEXT window', async () => {
    // 2026-10-06T23:00Z is 7pm on Oct 6 in New York — week 2, not week 1.
    const { prisma } = makePrisma([
      game('FT', '2026-09-29T23:00:00.000Z', 500),
      game('NS', '2026-10-06T23:00:00.000Z', 12),
    ])

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-nhl', week: 1, dryRun: true },
      { prisma, now: () => new Date('2026-10-07T18:00:00.000Z'), recalculateMatchups: vi.fn() as any },
    )

    // The unplayed week-2 game must not hold week 1 open.
    expect(result.slate?.games).toBe(1)
    expect(result.slate?.unfinished).toBe(0)
  })

  it('still refuses a sport it cannot close at all', async () => {
    const { prisma } = makePrisma([])
    prisma.redraftSeason.findFirst = vi.fn(async () => ({ ...NHL_SEASON, sport: 'MLB' }))

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-nhl', week: 1, dryRun: true },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any },
    )

    expect(result.refusal).toBe('sport_not_week_keyed')
  })
})
