/**
 * The week finalizer — the step that lets a native season move past week 1.
 *
 * What these guard, all of which fail silently in production if they regress:
 *
 *  1. A week is sealed ONLY when its slate is genuinely over. An `unknown` game status is
 *     not "finished" (`SportsGame.status` holds sixteen provider vocabularies), and a
 *     cancelled game does not hold the week open forever.
 *  2. The grace period after the last kickoff, so stat corrections land before results are
 *     sealed.
 *  3. THE FAKE-ZERO GUARD. Sealing a week writes a 0 for any starter with no stat row, so a
 *     week whose stats never arrived must be REFUSED, not zeroed. Production week 2 of 2026
 *     is the exact shape: team-defense rows only, no offensive players at all.
 *  4. The write is scoped and idempotent: zeros only for the missing, finalization only for
 *     rows that are not already final, and an already-final week does no work.
 *
 * The fake prisma records every call so the assertions read the WHERE CLAUSES, not just the
 * return values — a mock that answers regardless of the query cannot validate the query.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  WEEK_FINALIZE_COVERAGE_FLOOR,
  finalizeCompletedWeeksForSeason,
  finalizeRedraftWeek,
} from '@/lib/redraft/weekFinalizer'

type AnyArgs = Record<string, any>

const SEASON = { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026 }
const LAST_KICKOFF = '2026-09-21T20:15:00.000Z'
/** 13 hours after the last kickoff — past the 12-hour default grace. */
const AFTER_GRACE = new Date('2026-09-22T09:15:00.000Z')

function starter(playerId: string, sport = 'NFL') {
  return { playerId, sport, slotType: 'QB' }
}

/** A slate row as the selection helper needs to see it: feed, freshness, season and week. */
function game(
  status: string,
  opts: { source?: string; fetchedAt?: string; startTime?: string } = {},
) {
  return {
    status,
    startTime: new Date(opts.startTime ?? LAST_KICKOFF),
    source: opts.source ?? 'espn',
    fetchedAt: new Date(opts.fetchedAt ?? '2026-09-22T08:00:00.000Z'),
    season: 2026,
    week: 2,
  }
}

function makePrisma(overrides: {
  matchupsBefore?: Array<{ id: string; status: string }>
  matchupsAfter?: Array<{ status: string }>
  games?: Array<ReturnType<typeof game>>
  rosterPlayers?: Array<{ playerId: string; sport: string; slotType: string }>
  existingScores?: Array<{ playerId: string; sport: string }>
  season?: typeof SEASON | null
} = {}) {
  const calls: Array<{ key: string; args: AnyArgs }> = []
  const record = (key: string) => (args: AnyArgs) => {
    calls.push({ key, args })
    return args
  }

  const matchupFindMany = vi.fn(async (args: AnyArgs) => {
    record('redraftMatchup.findMany')(args)
    const seen = calls.filter((c) => c.key === 'redraftMatchup.findMany').length
    return seen === 1
      ? (overrides.matchupsBefore ?? [{ id: 'm1', status: 'active' }])
      : (overrides.matchupsAfter ?? [{ status: 'final' }])
  })

  const prisma = {
    redraftSeason: {
      findFirst: vi.fn(async (args: AnyArgs) => {
        record('redraftSeason.findFirst')(args)
        return overrides.season === undefined ? SEASON : overrides.season
      }),
    },
    redraftMatchup: { findMany: matchupFindMany },
    sportsGame: {
      findMany: vi.fn(async (args: AnyArgs) => {
        record('sportsGame.findMany')(args)
        return overrides.games ?? [game('final')]
      }),
    },
    redraftRoster: {
      findMany: vi.fn(async (args: AnyArgs) => {
        record('redraftRoster.findMany')(args)
        return [{ id: 'roster-1' }]
      }),
    },
    redraftRosterPlayer: {
      findMany: vi.fn(async (args: AnyArgs) => {
        record('redraftRosterPlayer.findMany')(args)
        return overrides.rosterPlayers ?? [starter('p1'), starter('p2')]
      }),
    },
    playerWeeklyScore: {
      findMany: vi.fn(async (args: AnyArgs) => {
        record('playerWeeklyScore.findMany')(args)
        return overrides.existingScores ?? [{ playerId: 'p1', sport: 'NFL' }, { playerId: 'p2', sport: 'NFL' }]
      }),
      createMany: vi.fn(async (args: AnyArgs) => {
        record('playerWeeklyScore.createMany')(args)
        return { count: args.data.length }
      }),
      updateMany: vi.fn(async (args: AnyArgs) => {
        record('playerWeeklyScore.updateMany')(args)
        return { count: 2 }
      }),
    },
  }

  return { prisma: prisma as any, calls }
}

function argsFor(calls: Array<{ key: string; args: AnyArgs }>, key: string): AnyArgs | undefined {
  return calls.find((c) => c.key === key)?.args
}

const recalc = vi.fn(async () => ({ updated: 1, incomplete: 0, summaries: [] as any[] }))

beforeEach(() => {
  recalc.mockClear()
  delete process.env.REDRAFT_WEEK_FINALIZER_DISABLED
})

describe('finalizeRedraftWeek', () => {
  it('seals a finished week: zeros only the missing starters, finalizes only unfinalized rows', async () => {
    const { prisma, calls } = makePrisma({
      rosterPlayers: [starter('p1'), starter('p2'), starter('p3'), starter('p4'), starter('p5')],
      // 4 of 5 starters have stats — above the floor, one genuinely absent (bye/inactive).
      existingScores: [
        { playerId: 'p1', sport: 'NFL' },
        { playerId: 'p2', sport: 'NFL' },
        { playerId: 'p3', sport: 'NFL' },
        { playerId: 'p4', sport: 'NFL' },
      ],
      matchupsAfter: [{ status: 'final' }, { status: 'final' }],
    })

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.finalized).toBe(true)
    expect(result.refusal).toBeNull()
    expect(result.zeroRowsWritten).toBe(1)
    expect(result.zeroedPlayerIds).toEqual(['p5'])
    expect(result.matchupsFinal).toBe(2)
    expect(recalc).toHaveBeenCalledWith('season-1', 2)

    // The zero row is empty and sealed — not a fabricated stat line.
    const created = argsFor(calls, 'playerWeeklyScore.createMany')
    expect(created?.data).toEqual([
      { playerId: 'p5', sport: 'NFL', week: 2, season: 2026, stats: {}, fantasyPts: 0, isFinalized: true },
    ])
    expect(created?.skipDuplicates).toBe(true)

    // Finalization is scoped to this week, this sport, these players, and skips rows already final.
    const updated = argsFor(calls, 'playerWeeklyScore.updateMany')
    expect(updated?.where).toMatchObject({ week: 2, season: 2026, sport: 'NFL', isFinalized: false })
    expect(updated?.where.playerId.in.sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(updated?.data).toEqual({ isFinalized: true })
  })

  it('refuses while any game is unfinished, and writes nothing', async () => {
    const { prisma, calls } = makePrisma({
      games: [game('final'), game('in_progress')],
    })

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.refusal).toBe('games_not_final')
    expect(result.finalized).toBe(false)
    expect(result.slate).toMatchObject({ games: 2, final: 1, unfinished: 1 })
    expect(argsFor(calls, 'playerWeeklyScore.createMany')).toBeUndefined()
    expect(argsFor(calls, 'playerWeeklyScore.updateMany')).toBeUndefined()
    expect(recalc).not.toHaveBeenCalled()
  })

  it('treats an unrecognised game status as unfinished, never as final', async () => {
    const { prisma } = makePrisma({
      games: [game('weather delay tbd')],
    })

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.refusal).toBe('games_not_final')
  })

  it('does not let a cancelled game hold the week open', async () => {
    const { prisma } = makePrisma({
      games: [game('final'), game('canceled')],
    })

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.finalized).toBe(true)
    expect(result.slate).toMatchObject({ cancelled: 1, unfinished: 0 })
  })

  it('refuses inside the grace period after the last kickoff', async () => {
    const { prisma } = makePrisma()

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      {
        prisma,
        // One hour after kickoff: the games read final, but corrections have not landed.
        now: () => new Date('2026-09-21T21:15:00.000Z'),
        recalculateMatchups: recalc as any,
      },
    )

    expect(result.refusal).toBe('within_grace_period')
    expect(recalc).not.toHaveBeenCalled()
  })

  it('refuses when stat coverage is below the floor — the production week-2 shape', async () => {
    const { prisma, calls } = makePrisma({
      // 16 starters, and only the two team defenses ever got a row.
      rosterPlayers: Array.from({ length: 16 }, (_, i) => starter(`p${i}`)),
      existingScores: [
        { playerId: 'p0', sport: 'NFL' },
        { playerId: 'p1', sport: 'NFL' },
      ],
    })

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.refusal).toBe('stat_coverage_below_floor')
    expect(result.coverage).toBeCloseTo(2 / 16)
    expect(result.coverage!).toBeLessThan(WEEK_FINALIZE_COVERAGE_FLOOR)
    expect(argsFor(calls, 'playerWeeklyScore.createMany')).toBeUndefined()
    expect(argsFor(calls, 'playerWeeklyScore.updateMany')).toBeUndefined()
    expect(recalc).not.toHaveBeenCalled()
  })

  /**
   * The differential control for the guard above: one fixture, one variable.
   *
   * The same 4-of-5 coverage that seals the week in the first test must refuse once the floor
   * is raised above it. If the coverage check were ever removed, this case would seal — so this
   * is the test that goes red, rather than the guard failing open unnoticed.
   */
  it('finalizes or refuses the SAME week purely on where the coverage floor sits', async () => {
    const fixture = {
      rosterPlayers: [starter('p1'), starter('p2'), starter('p3'), starter('p4'), starter('p5')],
      existingScores: [
        { playerId: 'p1', sport: 'NFL' },
        { playerId: 'p2', sport: 'NFL' },
        { playerId: 'p3', sport: 'NFL' },
        { playerId: 'p4', sport: 'NFL' },
      ],
    }

    const below = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2, coverageFloor: 0.9 },
      { prisma: makePrisma(fixture).prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )
    const above = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2, coverageFloor: 0.8 },
      { prisma: makePrisma(fixture).prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(below.refusal).toBe('stat_coverage_below_floor')
    expect(below.finalized).toBe(false)
    expect(above.refusal).toBeNull()
    expect(above.finalized).toBe(true)
    // 0.8 coverage against a 0.8 floor seals: the floor is a minimum, not a threshold to beat.
    expect(above.coverage).toBeCloseTo(0.8)
  })

  /**
   * Both of these are the production shape of NFL 2026 on 2026-09-22, and they fail in
   * opposite directions if the slate is read without ranked selection.
   */
  it('ignores a stale feed that still calls an unplayed week final', async () => {
    const { prisma, calls } = makePrisma({
      games: [
        // The week ahead: every fresh feed says nothing has been played…
        game('scheduled', { source: 'espn', fetchedAt: '2026-09-22T08:00:00.000Z' }),
        game('scheduled', { source: 'thesportsdb', fetchedAt: '2026-09-22T08:00:00.000Z' }),
        // …while a feed last fetched a month ago holds rows marked final.
        game('final', { source: 'espn_live', fetchedAt: '2026-08-24T20:23:55.000Z' }),
      ],
    })

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 3 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.refusal).toBe('games_not_final')
    expect(result.slate?.source).not.toBe('espn_live')
    expect(argsFor(calls, 'playerWeeklyScore.createMany')).toBeUndefined()
  })

  it('is not blocked by a stale feed still showing a finished week as unfinished', async () => {
    const { prisma } = makePrisma({
      games: [
        game('final', { source: 'espn', fetchedAt: '2026-09-22T19:08:00.000Z' }),
        game('final', { source: 'espn', fetchedAt: '2026-09-22T19:08:00.000Z' }),
        game('in_progress', { source: 'espn_live', fetchedAt: '2026-09-21T03:21:00.000Z' }),
      ],
    })

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.finalized).toBe(true)
    expect(result.slate).toMatchObject({ source: 'espn', unfinished: 0 })
  })

  it('asks only feeds that are allowed to answer a live-score question', async () => {
    const { prisma, calls } = makePrisma()

    await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    const where = argsFor(calls, 'sportsGame.findMany')?.where
    expect(where.source.in).toContain('espn')
    expect(where.source.in).not.toContain('cfbd')
  })

  it('reads the slate with the season-type discriminator, including rows written before the column', async () => {
    const { prisma, calls } = makePrisma()

    await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    const slateArgs = argsFor(calls, 'sportsGame.findMany')
    expect(slateArgs?.where).toMatchObject({ sport: 'NFL', season: 2026, week: 2 })
    expect(slateArgs?.where.OR).toEqual([{ seasonType: 'regular' }, { seasonType: null }])
  })

  it('does no work when every matchup is already final', async () => {
    const { prisma, calls } = makePrisma({
      matchupsBefore: [{ id: 'm1', status: 'final' }, { id: 'm2', status: 'final' }],
    })

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 1 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.alreadyFinal).toBe(true)
    expect(result.finalized).toBe(false)
    expect(argsFor(calls, 'sportsGame.findMany')).toBeUndefined()
    expect(recalc).not.toHaveBeenCalled()
  })

  it('refuses a daily sport, whose week is a date window rather than a column', async () => {
    const { prisma } = makePrisma({ season: { ...SEASON, sport: 'NBA' } })

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.refusal).toBe('sport_not_week_keyed')
  })

  it('can be switched off in an incident', async () => {
    process.env.REDRAFT_WEEK_FINALIZER_DISABLED = '1'
    const { prisma } = makePrisma()

    const result = await finalizeRedraftWeek(
      { seasonId: 'season-1', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.refusal).toBe('finalizer_disabled')
  })

  it('refuses a season it cannot find', async () => {
    const { prisma } = makePrisma({ season: null })

    const result = await finalizeRedraftWeek(
      { seasonId: 'nope', week: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    expect(result.refusal).toBe('season_not_found')
  })
})

describe('finalizeCompletedWeeksForSeason', () => {
  it('looks back over unfinished weeks only, within the bounded window', async () => {
    const calls: Array<{ key: string; args: AnyArgs }> = []
    const prisma = {
      redraftMatchup: {
        findMany: vi.fn(async (args: AnyArgs) => {
          calls.push({ key: 'sweep', args })
          // Weeks 2 and 4 still open; week 2 appears twice and must be visited once.
          return [{ week: 4 }, { week: 2 }, { week: 2 }]
        }),
      },
      redraftSeason: { findFirst: vi.fn(async () => null) },
    } as any

    const result = await finalizeCompletedWeeksForSeason(
      { seasonId: 'season-1', throughWeek: 5 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any },
    )

    const where = calls[0]?.args.where
    expect(where).toMatchObject({ seasonId: 'season-1', status: { not: 'final' } })
    expect(where.week).toEqual({ gte: 2, lte: 5 })

    // Ascending, de-duplicated: the earliest open week is closed first, since one open week
    // blocks every later advance.
    expect(result.results.map((r) => r.week)).toEqual([2, 4])
    expect(result.finalized).toBe(0)
    expect(result.refusals.season_not_found).toBe(2)
  })
})

/**
 * 🛑 A PAST WEEK IS JUDGED ON STATS NOBODY HAS REFRESHED SINCE IT WAS CURRENT.
 *
 * Score-sync reconciles exactly one week — the one `resolveSeasonWeekForRedraftSeason` calls
 * current — so a week that missed its window keeps whatever coverage it had then, and the
 * sweep refuses it every five minutes on data nothing is updating. Measured in production
 * 2026-09-24 on the one native league that has played: week 2 at 86/90 (95.6%) while week 1
 * sat at 62/90 (69%), and because the roller advances from `currentWeek`, that week 1 held the
 * entire season on week 1.
 *
 * So the sweep may fill a week's rows and try once more — for that refusal alone.
 */
describe('finalizeCompletedWeeksForSeason — backfilling a past week', () => {
  /** Coverage that starts below the floor and rises only if `syncWeekStats` is called. */
  function makeSweepPrisma(scored: Array<{ playerId: string; sport: string }>) {
    return {
      redraftSeason: { findFirst: vi.fn(async () => SEASON) },
      redraftMatchup: {
        findMany: vi.fn(async (args: AnyArgs) =>
          // The sweep's own query asks for weeks that are NOT final; the per-week calls do not.
          args.where?.status?.not === 'final' ? [{ week: 1 }] : [{ id: 'm1', status: 'active' }],
        ),
      },
      sportsGame: { findMany: vi.fn(async () => [game('final')]) },
      redraftRoster: { findMany: vi.fn(async () => [{ id: 'roster-1' }]) },
      redraftRosterPlayer: {
        findMany: vi.fn(async () => [starter('p1'), starter('p2'), starter('p3'), starter('p4')]),
      },
      playerWeeklyScore: {
        findMany: vi.fn(async () => [...scored]),
        createMany: vi.fn(async (args: AnyArgs) => ({ count: args.data.length })),
        updateMany: vi.fn(async () => ({ count: 4 })),
      },
    } as any
  }

  it('fills the week and seals it on the second attempt', async () => {
    const scored = [{ playerId: 'p1', sport: 'NFL' }, { playerId: 'p2', sport: 'NFL' }]
    const prisma = makeSweepPrisma(scored)
    const syncWeekStats = vi.fn(async ({ week }: { seasonId: string; week: number }) => {
      expect(week).toBe(1)
      scored.push({ playerId: 'p3', sport: 'NFL' }, { playerId: 'p4', sport: 'NFL' })
    })

    const result = await finalizeCompletedWeeksForSeason(
      { seasonId: 'season-1', throughWeek: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn(async () => ({ updated: 1 })) as any, syncWeekStats },
    )

    expect(syncWeekStats).toHaveBeenCalledTimes(1)
    expect(syncWeekStats).toHaveBeenCalledWith({ seasonId: 'season-1', week: 1 })
    expect(result.finalized).toBe(1)
    // The refusal that triggered the backfill is not reported — the week closed.
    expect(result.refusals.stat_coverage_below_floor).toBeUndefined()
    expect(result.results[0]?.coverage).toBe(1)
  })

  it('reports the refusal unchanged when the backfill cannot close the gap', async () => {
    const prisma = makeSweepPrisma([{ playerId: 'p1', sport: 'NFL' }])
    // A provider with nothing for that week: called, changes nothing.
    const syncWeekStats = vi.fn(async () => {})

    const result = await finalizeCompletedWeeksForSeason(
      { seasonId: 'season-1', throughWeek: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any, syncWeekStats },
    )

    expect(syncWeekStats).toHaveBeenCalledTimes(1)
    expect(result.finalized).toBe(0)
    // Counted ONCE, from the second attempt — not once per attempt.
    expect(result.refusals.stat_coverage_below_floor).toBe(1)
  })

  it('leaves the original refusal standing when the backfill throws', async () => {
    const prisma = makeSweepPrisma([{ playerId: 'p1', sport: 'NFL' }])
    const syncWeekStats = vi.fn(async () => {
      throw new Error('sleeper down')
    })

    const result = await finalizeCompletedWeeksForSeason(
      { seasonId: 'season-1', throughWeek: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any, syncWeekStats },
    )

    expect(result.finalized).toBe(0)
    expect(result.refusals.stat_coverage_below_floor).toBe(1)
  })

  /**
   * ⚠ THE REFUSAL HAS TO BE THE ONE A BACKFILL CAN ANSWER. An unfinished slate is not about
   * missing rows, and fetching on every refusal would turn one tick into a provider sweep.
   */
  it('does not fetch for a refusal a backfill cannot answer', async () => {
    const prisma = makeSweepPrisma([])
    prisma.sportsGame.findMany = vi.fn(async () => [game('scheduled')])
    const syncWeekStats = vi.fn(async () => {})

    const result = await finalizeCompletedWeeksForSeason(
      { seasonId: 'season-1', throughWeek: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any, syncWeekStats },
    )

    expect(syncWeekStats).not.toHaveBeenCalled()
    expect(result.refusals.games_not_final).toBe(1)
  })

  it('does not fetch for a week that seals on the first attempt', async () => {
    const prisma = makeSweepPrisma([
      { playerId: 'p1', sport: 'NFL' },
      { playerId: 'p2', sport: 'NFL' },
      { playerId: 'p3', sport: 'NFL' },
      { playerId: 'p4', sport: 'NFL' },
    ])
    const syncWeekStats = vi.fn(async () => {})

    const result = await finalizeCompletedWeeksForSeason(
      { seasonId: 'season-1', throughWeek: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn(async () => ({ updated: 1 })) as any, syncWeekStats },
    )

    expect(syncWeekStats).not.toHaveBeenCalled()
    expect(result.finalized).toBe(1)
  })

  /**
   * 🛑 A SPENT QUOTA AND AN EMPTY WEEK PRODUCE THE SAME COVERAGE NUMBER.
   *
   * `NflLiveStatsProvider.fetchPlayerStatsForGames` returns an EMPTY map when the rate limiter
   * refuses it, so the sync writes nothing and the finalizer computes exactly the figure it
   * would have computed if those players had not played. Measured 2026-09-24: week 1 refused at
   * 0.721 while 19 of its 24 unscored starters had real lines in Sleeper's payload, unreachable
   * because the team-defense fetch had spent the hour's 1,000 calls. The refusal sent the reader
   * to the roster; the cause was a quota.
   */
  it('names the quota, not the coverage, when the backfill was rate limited', async () => {
    const prisma = makeSweepPrisma([{ playerId: 'p1', sport: 'NFL' }])
    const syncWeekStats = vi.fn(async () => ({ rateLimited: true }))

    const result = await finalizeCompletedWeeksForSeason(
      { seasonId: 'season-1', throughWeek: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any, syncWeekStats },
    )

    expect(result.refusals.provider_rate_limited).toBe(1)
    expect(result.refusals.stat_coverage_below_floor).toBeUndefined()
    // The coverage figure is still reported — it is true, it is just not the cause.
    expect(result.results[0]?.coverage).toBeCloseTo(0.25)
  })

  it('does not blame the quota for a week that sealed anyway', async () => {
    const scored = [{ playerId: 'p1', sport: 'NFL' }]
    const prisma = makeSweepPrisma(scored)
    const syncWeekStats = vi.fn(async () => {
      scored.push({ playerId: 'p2', sport: 'NFL' }, { playerId: 'p3', sport: 'NFL' }, { playerId: 'p4', sport: 'NFL' })
      // Rate-limited for the NEXT caller, but this run still got its rows.
      return { rateLimited: true }
    })

    const result = await finalizeCompletedWeeksForSeason(
      { seasonId: 'season-1', throughWeek: 2 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn(async () => ({ updated: 1 })) as any, syncWeekStats },
    )

    expect(result.finalized).toBe(1)
    expect(result.refusals.provider_rate_limited).toBeUndefined()
  })

  it('writes nothing on a dry run, including the backfill', async () => {
    const prisma = makeSweepPrisma([{ playerId: 'p1', sport: 'NFL' }])
    const syncWeekStats = vi.fn(async () => {})

    await finalizeCompletedWeeksForSeason(
      { seasonId: 'season-1', throughWeek: 2, dryRun: true },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn() as any, syncWeekStats },
    )

    expect(syncWeekStats).not.toHaveBeenCalled()
  })
})
