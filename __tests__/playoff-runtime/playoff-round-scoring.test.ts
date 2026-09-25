/**
 * The playoff scorer — the writer `RedraftPlayoffMatchup.homeScore` / `awayScore` never had.
 *
 * What these guard, each of which fails silently if it regresses:
 *
 *  1. A round is scored from its OWN weeks (`playoffStartWeek`, round number, weeks per round),
 *     so a two-week round sums two weeks and is not final until both are sealed.
 *  2. THE ADVANCE-SAFETY RULE. The hourly advance reads only the score columns, so a round
 *     that is still being played must write its totals to `metadata.live` and leave the columns
 *     null. A live score in the columns would decide a round mid-week.
 *  3. Weeks are sealed for the teams still playing only (`rosterIds`), byes and decided
 *     matchups are left alone, and the league's week pointer only ever moves forward.
 *  4. Consolation rounds (stored at 100 + n) are never read as the title bracket.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'
import {
  CONSOLATION_ROUND_OFFSET,
  isChampionshipRoundNumber,
  lastWeekOfPlayoffRound,
  playoffRoundWeeks,
} from '@/lib/playoff-runtime/playoffRoundWeeks'

type AnyArgs = Record<string, any>

function matchup(id: string, over: Partial<AnyArgs> = {}) {
  return {
    id,
    homeRosterId: `${id}-home`,
    awayRosterId: `${id}-away`,
    homeScore: null,
    awayScore: null,
    winnerRosterId: null,
    status: 'scheduled',
    metadata: { bracketType: 'championship' },
    ...over,
  }
}

function makeDb(opts: {
  status?: string
  currentWeek?: number
  playoffStartWeek?: number
  weeksPerRound?: number | null
  rounds?: Array<{ roundNumber: number; status: string; matchups: AnyArgs[] }>
} = {}) {
  const updates: Array<{ id: string; data: AnyArgs }> = []
  const seasonUpdates: AnyArgs[] = []
  const roundQueries: AnyArgs[] = []
  const db = {
    redraftSeason: {
      findFirst: vi.fn(async () => ({
        id: 's1',
        leagueId: 'L1',
        season: 2026,
        status: opts.status ?? 'playoffs',
        currentWeek: opts.currentWeek ?? 15,
        playoffStartWeek: opts.playoffStartWeek ?? 15,
      })),
      update: vi.fn(async (args: AnyArgs) => {
        seasonUpdates.push(args.data)
        return args
      }),
    },
    redraftPlayoffRound: {
      findMany: vi.fn(async (args: AnyArgs) => {
        roundQueries.push(args)
        return opts.rounds ?? [{ roundNumber: 1, status: 'active', matchups: [matchup('m1'), matchup('m2')] }]
      }),
    },
    league: {
      findFirst: vi.fn(async () => ({ playoffWeeksPerRound: opts.weeksPerRound ?? 1 })),
    },
    redraftPlayoffMatchup: {
      update: vi.fn(async (args: AnyArgs) => {
        updates.push({ id: args.where.id, data: args.data })
        return args
      }),
    },
  }
  return { db: db as any, updates, seasonUpdates, roundQueries }
}

/** A finalizer double: weeks in `sealed` finalize, the rest refuse with games_not_final. */
function finalizer(sealed: number[]) {
  const calls: AnyArgs[] = []
  const fn = vi.fn(async (params: AnyArgs) => {
    calls.push(params)
    const ok = sealed.includes(params.week)
    return { finalized: ok, alreadyFinal: false, refusal: ok ? null : 'games_not_final' } as any
  })
  return { fn, calls }
}

/** Each roster scores `points` per week; `allFinal` as given. */
function scorer(points: Record<string, number>, allFinal = true) {
  const calls: AnyArgs[] = []
  const fn = vi.fn(async (args: AnyArgs) => {
    calls.push(args)
    return {
      rosterId: args.rosterId,
      starterCount: 9,
      scoredStarterCount: 9,
      points: points[`${args.rosterId}@${args.week}`] ?? points[args.rosterId] ?? 0,
      missingPlayerIds: [],
      allFinal,
    }
  })
  return { fn, calls }
}

describe('playoffRoundWeeks — one rule for which weeks a round spans', () => {
  it('one week per round by default', () => {
    expect(playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 1 })).toEqual([15])
    expect(playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 3 })).toEqual([17])
  })

  it('honours League.playoffWeeksPerRound, which nothing read before', () => {
    expect(playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 2, weeksPerRound: 2 })).toEqual([17, 18])
    expect(lastWeekOfPlayoffRound({ playoffStartWeek: 15, roundNumber: 2, weeksPerRound: 2 })).toBe(18)
  })

  it('an unusable weeks-per-round value means one', () => {
    expect(playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 2, weeksPerRound: null })).toEqual([16])
    expect(playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 2, weeksPerRound: 0 })).toEqual([16])
  })

  it('a consolation round is not a championship round', () => {
    expect(isChampionshipRoundNumber(3)).toBe(true)
    expect(isChampionshipRoundNumber(CONSOLATION_ROUND_OFFSET + 1)).toBe(false)
  })
})

describe('scoreActivePlayoffRound', () => {
  it('does nothing for a season that is not in its playoffs', async () => {
    const { db, updates } = makeDb({ status: 'active' })
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: 15 }, { prisma: db })
    expect(res.outcome).toBe('not_in_playoffs')
    expect(updates).toHaveLength(0)
  })

  it('reads the title bracket only — consolation rounds are filtered out in the query', async () => {
    const { db, roundQueries } = makeDb()
    const fin = finalizer([])
    await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: 15 }, { prisma: db, finalizeWeek: fin.fn, scoreRoster: scorer({}).fn })
    expect(roundQueries[0].where.roundNumber).toEqual({ lt: CONSOLATION_ROUND_OFFSET })
  })

  it('waits for the round\'s first week', async () => {
    const { db, updates } = makeDb({ rounds: [{ roundNumber: 2, status: 'active', matchups: [matchup('m1')] }] })
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: 15 }, { prisma: db })
    expect(res.outcome).toBe('round_not_started')
    expect(res.weeks).toEqual([16])
    expect(updates).toHaveLength(0)
  })

  it('WHILE THE ROUND IS PLAYED: totals go to metadata.live and the score columns stay empty', async () => {
    const { db, updates } = makeDb()
    const fin = finalizer([]) // week 15 not sealed yet
    const sc = scorer({ 'm1-home': 88.4, 'm1-away': 91.2 }, false)
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: 15 }, { prisma: db, finalizeWeek: fin.fn, scoreRoster: sc.fn })

    expect(res.outcome).toBe('live')
    expect(res.weekRefusals).toEqual({ 15: 'games_not_final' })
    const m1 = updates.find((u) => u.id === 'm1')!
    expect(m1.data.homeScore).toBeUndefined()
    expect(m1.data.awayScore).toBeUndefined()
    // The column is CHECK-constrained (scheduled/in_progress/final/bye/cancelled); a live round
    // must not write the runtime's 'active', and writes no status at all.
    expect(m1.data.status).toBeUndefined()
    expect(m1.data.metadata.live).toMatchObject({ homeScore: 88.4, awayScore: 91.2, weeks: [15] })
    expect(m1.data.metadata.bracketType).toBe('championship')
  })

  it('a sealed week whose rows are not all final is still live, not final', async () => {
    const { db, updates } = makeDb()
    const res = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 15 },
      { prisma: db, finalizeWeek: finalizer([15]).fn, scoreRoster: scorer({ 'm1-home': 100 }, false).fn },
    )
    expect(res.outcome).toBe('live')
    expect(updates.every((u) => u.data.homeScore === undefined)).toBe(true)
  })

  it('ONCE THE ROUND IS SEALED: final scores are written and live totals cleared', async () => {
    const { db, updates } = makeDb({
      rounds: [
        {
          roundNumber: 1,
          status: 'active',
          matchups: [
            matchup('m1', { metadata: { bracketType: 'championship', live: { homeScore: 1, awayScore: 2 } } }),
            matchup('m2'),
            matchup('bye', { awayRosterId: null, status: 'bye' }),
          ],
        },
      ],
    })
    const fin = finalizer([15])
    const sc = scorer({ 'm1-home': 120.5, 'm1-away': 99.1, 'm2-home': 80, 'm2-away': 81 })
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: 16 }, { prisma: db, finalizeWeek: fin.fn, scoreRoster: sc.fn })

    expect(res.outcome).toBe('scored')
    expect(res.matchupsScored).toBe(2)
    const m1 = updates.find((u) => u.id === 'm1')!
    expect(m1.data).toMatchObject({ homeScore: 120.5, awayScore: 99.1, status: 'final' })
    expect(m1.data.metadata.live).toBeUndefined()
    expect(m1.data.metadata.scoredWeeks).toEqual([15])
    // The bye is not a contested matchup and is never written.
    expect(updates.find((u) => u.id === 'bye')).toBeUndefined()
    // Sealed for the four teams still playing, not the whole league.
    expect(fin.calls[0]).toMatchObject({ seasonId: 's1', week: 15 })
    expect([...fin.calls[0].rosterIds].sort()).toEqual(['m1-away', 'm1-home', 'm2-away', 'm2-home'])
  })

  it('a two-week round sums both weeks, and is not final after the first', async () => {
    const rounds = [{ roundNumber: 1, status: 'active', matchups: [matchup('m1')] }]
    const points = { 'm1-home@15': 50, 'm1-home@16': 60, 'm1-away@15': 70, 'm1-away@16': 30 }

    const first = makeDb({ weeksPerRound: 2, rounds })
    const afterWeekOne = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 15 },
      { prisma: first.db, finalizeWeek: finalizer([15]).fn, scoreRoster: scorer(points).fn },
    )
    expect(afterWeekOne.outcome).toBe('live')
    expect(first.updates[0].data.homeScore).toBeUndefined()

    const second = makeDb({ weeksPerRound: 2, rounds })
    const afterWeekTwo = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 16 },
      { prisma: second.db, finalizeWeek: finalizer([15, 16]).fn, scoreRoster: scorer(points).fn },
    )
    expect(afterWeekTwo.outcome).toBe('scored')
    expect(second.updates[0].data).toMatchObject({ homeScore: 110, awayScore: 100, status: 'final' })
    expect(second.updates[0].data.metadata.scoredWeeks).toEqual([15, 16])
  })

  it('an already-scored round is left for the roller to advance', async () => {
    const { db, updates } = makeDb({
      rounds: [{ roundNumber: 1, status: 'active', matchups: [matchup('m1', { homeScore: 1, awayScore: 2, status: 'final' })] }],
    })
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: 16 }, { prisma: db })
    expect(res.outcome).toBe('already_scored')
    expect(updates).toHaveLength(0)
  })

  it('moves currentWeek forward onto the round being played, never back', async () => {
    const forward = makeDb({ currentWeek: 15, rounds: [{ roundNumber: 2, status: 'active', matchups: [matchup('m1')] }] })
    const res = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 16 },
      { prisma: forward.db, finalizeWeek: finalizer([]).fn, scoreRoster: scorer({}).fn },
    )
    expect(res.currentWeekMovedTo).toBe(16)
    expect(forward.seasonUpdates).toEqual([{ currentWeek: 16 }])

    const ahead = makeDb({ currentWeek: 17, rounds: [{ roundNumber: 2, status: 'active', matchups: [matchup('m1')] }] })
    await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 16 },
      { prisma: ahead.db, finalizeWeek: finalizer([]).fn, scoreRoster: scorer({}).fn },
    )
    expect(ahead.seasonUpdates).toHaveLength(0)
  })
})
