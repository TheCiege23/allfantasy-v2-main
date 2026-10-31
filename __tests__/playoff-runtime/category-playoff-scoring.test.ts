/**
 * A head-to-head category league's playoff round is decided by CATEGORY WINS, as its regular season is.
 * The score columns used to hold summed fantasy points — a number the league never plays for — so the
 * team with more points advanced even when it lost the categories.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'
import { accumulateTeamTotals, resolveCategoryMatchup } from '@/lib/category-scoring'
import { resolveLeagueCategories } from '@/lib/category-scoring/leagueScoringType'

type AnyArgs = Record<string, any>

// HOME piles up points and threes; AWAY wins the rest of the nine categories.
const HOME = { pts: 140, reb: 30, ast: 20, stl: 4, blk: 2, to: 18, threes: 20, fgm: 50, fga: 120, ftm: 20, fta: 30 }
const AWAY = { pts: 120, reb: 50, ast: 30, stl: 9, blk: 7, to: 10, threes: 10, fgm: 48, fga: 90, ftm: 18, fta: 20 }
const NINE_CAT = resolveLeagueCategories({}, 'nba_9cat')!

function makeDb(settings: AnyArgs, opts: { weeksPerRound?: number; series?: boolean } = {}) {
  const updates: Array<{ id: string; data: AnyArgs }> = []
  const db = {
    redraftSeason: {
      findFirst: vi.fn(async () => ({ id: 's1', leagueId: 'L1', season: 2026, status: 'playoffs', currentWeek: 20, playoffStartWeek: 20 })),
      update: vi.fn(async (a: AnyArgs) => a),
    },
    redraftPlayoffRound: {
      findMany: vi.fn(async (args: AnyArgs) =>
        args.where.roundNumber?.gte
          ? []
          : [{ roundNumber: 1, status: 'active', matchups: [{ id: 'm1', homeRosterId: 'H', awayRosterId: 'A', homeScore: null, awayScore: null, homeSeed: 1, awaySeed: 4, winnerRosterId: null, status: 'scheduled', metadata: {} }] }],
      ),
    },
    league: {
      findFirst: vi.fn(async () => ({
        playoffWeeksPerRound: opts.weeksPerRound ?? 1,
        settings: { ...settings, ...(opts.series ? { playoff_series: { mode: 'series', lengths: [3] } } : {}) },
      })),
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

const sealedAll = vi.fn(async () => ({ finalized: true, alreadyFinal: false, refusal: null }) as any)
const scorer = (perWeek: (rosterId: string, week: number) => AnyArgs) =>
  vi.fn(async (args: AnyArgs) => {
    const stats = perWeek(args.rosterId, args.week)
    return { rosterId: args.rosterId, starterCount: 10, scoredStarterCount: 10, points: stats.pts, statTotals: stats, missingPlayerIds: [], allFinal: true }
  })

const CATEGORY_LEAGUE = { scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat' }

describe('category playoffs', () => {
  it('the round goes to the team that wins more categories, not the one with more points', async () => {
    const { db, updates } = makeDb(CATEGORY_LEAGUE)
    const expected = resolveCategoryMatchup(HOME, AWAY, NINE_CAT)
    expect(expected.bWins).toBeGreaterThan(expected.aWins) // the control: AWAY wins the categories…
    expect(HOME.pts).toBeGreaterThan(AWAY.pts) // …while HOME has more points

    const out = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 20 },
      { prisma: db, finalizeWeek: sealedAll, scoreRoster: scorer((r) => (r === 'H' ? HOME : AWAY)) as any },
    )
    expect(out.outcome).toBe('scored')
    const data = updates[0].data
    expect([data.homeScore, data.awayScore]).toEqual([expected.aWins, expected.bWins])
    expect(data.status).toBe('final')
    expect(data.metadata.categoryMatchup).toMatchObject({ homeWins: expected.aWins, awayWins: expected.bWins, ties: expected.ties })
    expect(data.metadata.categoryMatchup.categories).toHaveLength(NINE_CAT.length)
  })

  it('a two-week round compares the categories once, on the two weeks’ combined stats', async () => {
    const { db, updates } = makeDb(CATEGORY_LEAGUE, { weeksPerRound: 2 })
    // Week 1 HOME dominates; week 2 AWAY does. Combined, the ratio stats come from the summed makes/attempts.
    const week = (r: string, w: number) => (r === 'H' ? (w === 20 ? AWAY : HOME) : w === 20 ? HOME : AWAY)
    await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 21 },
      { prisma: db, finalizeWeek: sealedAll, scoreRoster: scorer(week) as any },
    )
    const home = accumulateTeamTotals([AWAY, HOME])
    const away = accumulateTeamTotals([HOME, AWAY])
    const expected = resolveCategoryMatchup(home, away, NINE_CAT)
    expect([updates[0].data.homeScore, updates[0].data.awayScore]).toEqual([expected.aWins, expected.bWins])
  })

  it('in series mode each week’s game is that week’s categories', async () => {
    const { db, updates } = makeDb(CATEGORY_LEAGUE, { series: true })
    await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 20 },
      { prisma: db, finalizeWeek: sealedAll, scoreRoster: scorer((r) => (r === 'H' ? HOME : AWAY)) as any },
    )
    const expected = resolveCategoryMatchup(HOME, AWAY, NINE_CAT)
    const game = updates[0].data.metadata.series.games[0]
    expect([game.homePoints, game.awayPoints]).toEqual([expected.aWins, expected.bWins])
    expect(game.winnerRosterId).toBe('A')
  })

  it('a points league is still decided by points', async () => {
    const { db, updates } = makeDb({ scoring_mode: 'points' })
    await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 20 },
      { prisma: db, finalizeWeek: sealedAll, scoreRoster: scorer((r) => (r === 'H' ? HOME : AWAY)) as any },
    )
    expect([updates[0].data.homeScore, updates[0].data.awayScore]).toEqual([140, 120])
    expect(updates[0].data.metadata.categoryMatchup).toBeUndefined()
  })
})
