/**
 * `championship_length` — the final may run longer than the rounds before it.
 *
 * MLB and NHL default to a two-week final (`DefaultPlayoffConfigResolver`), written into
 * `settings.playoff_structure` at creation and shown to the commissioner, while every playoff reader
 * played the final in `playoffWeeksPerRound` weeks: the last week of those seasons went unplayed and
 * the title was decided on one. What these guard:
 *
 *  1. The final spans `max(playoffWeeksPerRound, championship_length)` weeks; earlier rounds and
 *     every round's first week are unchanged.
 *  2. The scorer sums every week of the final and writes no final score — so the roller cannot
 *     advance — until the final's LAST week is sealed.
 *  3. A league without the setting (NFL, imports, anything older) scores exactly the weeks it did.
 *  4. The season's last playoff week and a dynasty season's created length include the longer final.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'
import {
  lastWeekOfPlayoffRound,
  playoffRoundWeeks,
  readChampionshipLength,
  weeksForPlayoffRound,
} from '@/lib/playoff-runtime/playoffRoundWeeks'
import { resolveLastPlayoffWeek } from '@/lib/season-week/seasonWeekService'
import { resolveCreatedSeasonWeeks } from '@/lib/redraft/createdSeasonLength'

type AnyArgs = Record<string, any>

const TWO_WEEK_FINAL = { playoff_structure: { championship_length: 2 } }

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

/** A six-team bracket (three rounds) whose `activeRound` is being played. */
function bracket(activeRound: number) {
  return [1, 2, 3].map((roundNumber) => ({
    roundNumber,
    status: roundNumber < activeRound ? 'completed' : roundNumber === activeRound ? 'active' : 'pending',
    matchups: roundNumber === activeRound ? [matchup(`r${roundNumber}`)] : [],
  }))
}

function makeDb(opts: { playoffStartWeek: number; weeksPerRound?: number | null; settings?: unknown; activeRound: number }) {
  const updates: Array<{ id: string; data: AnyArgs }> = []
  const db = {
    redraftSeason: {
      findFirst: vi.fn(async () => ({
        id: 's1',
        leagueId: 'L1',
        season: 2026,
        status: 'playoffs',
        currentWeek: opts.playoffStartWeek,
        playoffStartWeek: opts.playoffStartWeek,
      })),
      update: vi.fn(async (args: AnyArgs) => args),
    },
    redraftPlayoffRound: { findMany: vi.fn(async () => bracket(opts.activeRound)) },
    league: {
      findFirst: vi.fn(async () => ({ playoffWeeksPerRound: opts.weeksPerRound ?? 1, settings: opts.settings ?? null })),
    },
    redraftPlayoffMatchup: {
      update: vi.fn(async (args: AnyArgs) => {
        updates.push({ id: args.where.id, data: args.data })
        return args
      }),
    },
  }
  return { db: db as any, updates }
}

function finalizer(sealed: number[]) {
  const calls: number[] = []
  const fn = vi.fn(async (params: AnyArgs) => {
    calls.push(params.week)
    const ok = sealed.includes(params.week)
    return { finalized: ok, alreadyFinal: false, refusal: ok ? null : 'games_not_final' } as any
  })
  return { fn, calls }
}

function scorer(points: Record<string, number>) {
  return vi.fn(async (args: AnyArgs) => ({
    rosterId: args.rosterId,
    starterCount: 9,
    scoredStarterCount: 9,
    points: points[`${args.rosterId}@${args.week}`] ?? 0,
    missingPlayerIds: [],
    allFinal: true,
  }))
}

describe('playoffRoundWeeks with a championship length', () => {
  // NHL shape: 28 weeks, playoffs from week 25, three rounds of one week plus a two-week final.
  const nhl = { playoffStartWeek: 25, weeksPerRound: 1, finalRoundNumber: 3, championshipLength: 2 }

  it('the final spans the championship length; earlier rounds keep weeks per round', () => {
    expect(playoffRoundWeeks({ ...nhl, roundNumber: 1 })).toEqual([25])
    expect(playoffRoundWeeks({ ...nhl, roundNumber: 2 })).toEqual([26])
    expect(playoffRoundWeeks({ ...nhl, roundNumber: 3 })).toEqual([27, 28])
    expect(lastWeekOfPlayoffRound({ ...nhl, roundNumber: 3 })).toBe(28)
  })

  it('unset, or no longer than the other rounds, changes nothing', () => {
    expect(playoffRoundWeeks({ ...nhl, roundNumber: 3, championshipLength: null })).toEqual([27])
    expect(playoffRoundWeeks({ ...nhl, roundNumber: 3, championshipLength: 1 })).toEqual([27])
    // No final named: every round is a regular round, as every caller before this change.
    expect(playoffRoundWeeks({ playoffStartWeek: 25, roundNumber: 3, championshipLength: 2 })).toEqual([27])
  })

  it('never shortens a final below weeks per round; multi-week earlier rounds are unchanged', () => {
    const twoPerRound = { playoffStartWeek: 15, weeksPerRound: 2, finalRoundNumber: 3 }
    expect(playoffRoundWeeks({ ...twoPerRound, roundNumber: 1, championshipLength: 3 })).toEqual([15, 16])
    expect(playoffRoundWeeks({ ...twoPerRound, roundNumber: 2, championshipLength: 3 })).toEqual([17, 18])
    expect(playoffRoundWeeks({ ...twoPerRound, roundNumber: 3, championshipLength: 3 })).toEqual([19, 20, 21])
    expect(playoffRoundWeeks({ ...twoPerRound, roundNumber: 3, championshipLength: 1 })).toEqual([19, 20])
    expect(weeksForPlayoffRound({ roundNumber: 3, weeksPerRound: 2, finalRoundNumber: 3, championshipLength: 1 })).toBe(2)
  })

  it('reads the stored setting, playoff_structure first, and never the sport default', () => {
    expect(readChampionshipLength(TWO_WEEK_FINAL)).toBe(2)
    expect(readChampionshipLength({ championship_length: 2 })).toBe(2)
    expect(readChampionshipLength({ championship_length: 3, playoff_structure: { championship_length: 2 } })).toBe(2)
    expect(readChampionshipLength({})).toBeNull()
    expect(readChampionshipLength(null)).toBeNull()
    expect(readChampionshipLength({ playoff_structure: { championship_length: 0 } })).toBeNull()
    expect(readChampionshipLength({ playoff_structure: { championship_length: 'x' } })).toBeNull()
  })
})

describe('scoreActivePlayoffRound — a two-week final', () => {
  const points = { 'r3-home@27': 40, 'r3-home@28': 50, 'r3-away@27': 60, 'r3-away@28': 20 }

  it('NOT FINAL AFTER ITS FIRST WEEK: totals stay live and the score columns stay empty', async () => {
    const { db, updates } = makeDb({ playoffStartWeek: 25, settings: TWO_WEEK_FINAL, activeRound: 3 })
    const fin = finalizer([27])
    const res = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 27 },
      { prisma: db, finalizeWeek: fin.fn, scoreRoster: scorer(points) },
    )
    expect(res.weeks).toEqual([27, 28])
    expect(res.outcome).toBe('live')
    expect(updates[0].data.homeScore).toBeUndefined()
    expect(updates[0].data.status).toBeUndefined()
    expect(updates[0].data.metadata.live).toMatchObject({ homeScore: 40, awayScore: 60, weeks: [27] })
  })

  it('a sealed first week with the second unsealed still does not decide the title', async () => {
    const { db, updates } = makeDb({ playoffStartWeek: 25, settings: TWO_WEEK_FINAL, activeRound: 3 })
    const res = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 28 },
      { prisma: db, finalizeWeek: finalizer([27]).fn, scoreRoster: scorer(points) },
    )
    expect(res.outcome).toBe('live')
    expect(res.weekRefusals).toEqual({ 28: 'games_not_final' })
    expect(updates[0].data.homeScore).toBeUndefined()
  })

  it('ONCE BOTH WEEKS SEAL: the final is scored over both, and the result flips on the second week', async () => {
    const { db, updates } = makeDb({ playoffStartWeek: 25, settings: TWO_WEEK_FINAL, activeRound: 3 })
    const fin = finalizer([27, 28])
    const res = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 28 },
      { prisma: db, finalizeWeek: fin.fn, scoreRoster: scorer(points) },
    )
    expect(res.outcome).toBe('scored')
    // Week 27 alone has the away team ahead 60-40; the two-week sum is 90-80 to the home team.
    expect(updates[0].data).toMatchObject({ homeScore: 90, awayScore: 80, status: 'final' })
    expect(updates[0].data.metadata.scoredWeeks).toEqual([27, 28])
    expect(fin.calls).toEqual([27, 28])
  })

  it('an earlier round of the same league is still one week', async () => {
    const { db, updates } = makeDb({ playoffStartWeek: 25, settings: TWO_WEEK_FINAL, activeRound: 2 })
    const res = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 26 },
      { prisma: db, finalizeWeek: finalizer([26]).fn, scoreRoster: scorer({ 'r2-home@26': 10, 'r2-away@26': 5 }) },
    )
    expect(res.weeks).toEqual([26])
    expect(res.outcome).toBe('scored')
    expect(updates[0].data.metadata.scoredWeeks).toEqual([26])
  })

  it('NFL / no stored setting: the final is the one week it always was', async () => {
    const { db, updates } = makeDb({ playoffStartWeek: 15, activeRound: 3 })
    const res = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 17 },
      { prisma: db, finalizeWeek: finalizer([17]).fn, scoreRoster: scorer({ 'r3-home@17': 100, 'r3-away@17': 90 }) },
    )
    expect(res.weeks).toEqual([17])
    expect(res.outcome).toBe('scored')
    expect(updates[0].data).toMatchObject({ homeScore: 100, awayScore: 90, status: 'final' })
  })

  it('NFL with championship_length 1 stored and two weeks per round: unchanged two-week rounds', async () => {
    const { db } = makeDb({ playoffStartWeek: 15, weeksPerRound: 2, settings: { playoff_structure: { championship_length: 1 } }, activeRound: 3 })
    const res = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 19 },
      { prisma: db, finalizeWeek: finalizer([]).fn, scoreRoster: scorer({}) },
    )
    expect(res.weeks).toEqual([19, 20])
  })
})

describe('resolveLastPlayoffWeek — when the season reads as complete', () => {
  function seasonDb(settings: unknown, weeksPerRound = 1) {
    return {
      redraftPlayoffRound: { findFirst: vi.fn(async () => ({ roundNumber: 3 })) },
      league: { findUnique: vi.fn(async () => ({ playoffWeeksPerRound: weeksPerRound, settings })) },
    } as any
  }

  it('a two-week final ends on its second week', async () => {
    expect(await resolveLastPlayoffWeek(seasonDb(TWO_WEEK_FINAL), 's1', 25, 'L1')).toBe(28)
  })

  it('without the setting the last playoff week is unchanged', async () => {
    expect(await resolveLastPlayoffWeek(seasonDb(null), 's1', 15, 'L1')).toBe(17)
    expect(await resolveLastPlayoffWeek(seasonDb(null, 2), 's1', 15, 'L1')).toBe(20)
  })
})

describe('resolveCreatedSeasonWeeks — a dynasty season is sized for the longer final', () => {
  it('NHL dynasty: 24 regular weeks + two one-week rounds + a two-week final = 28 (the sport shape)', () => {
    expect(
      resolveCreatedSeasonWeeks(
        { dynastyConfig: { regularSeasonWeeks: 24 }, playoffTeams: 6, playoffWeeksPerRound: 1, settings: TWO_WEEK_FINAL },
        28,
      ),
    ).toBe(28)
  })

  it('without the setting the length is unchanged', () => {
    expect(resolveCreatedSeasonWeeks({ dynastyConfig: { regularSeasonWeeks: 14 }, playoffTeams: 6, playoffWeeksPerRound: 1 }, 17)).toBe(17)
    expect(
      resolveCreatedSeasonWeeks(
        { dynastyConfig: { regularSeasonWeeks: 14 }, playoffTeams: 6, playoffWeeksPerRound: 2, settings: TWO_WEEK_FINAL },
        17,
      ),
    ).toBe(20)
  })
})
