/**
 * `updateStandings` (lib/redraft/standingsEngine.ts):
 *  - honours the commissioner's tiebreaker order (`League.settings.tiebreaker_order`) after record,
 *    ranked as the bracket seeds — and keeps today's win% → points for → points against with none set;
 *  - credits a team on a plain bye the week's median team score as points for, with no W/L/T.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Update = { where: { id: string }; data: Record<string, unknown> }

const h = vi.hoisted(() => ({
  updates: [] as Update[],
  rosters: [] as Array<{ id: string; ownerId: string }>,
  matchups: [] as unknown[],
  season: {} as Record<string, unknown>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRoster: {
      findMany: vi.fn(async () => h.rosters),
      update: vi.fn(async (args: Update) => {
        h.updates.push(args)
        return {}
      }),
    },
    redraftMatchup: { findMany: vi.fn(async () => h.matchups), updateMany: vi.fn(async () => ({ count: 0 })) },
    redraftSeason: { findUnique: vi.fn(async () => h.season) },
    roster: { findMany: vi.fn(async () => []) },
    teamWeekResult: { findMany: vi.fn(async () => []) },
    // Only the LeagueTeam mirror reads this; an imported platform makes it step aside. The tiebreaker
    // gate reads the season's own league row below.
    league: { findFirst: vi.fn(async () => ({ platform: 'sleeper', settings: {} })) },
    fantasyStanding: { upsert: vi.fn() },
    leagueTeam: { updateMany: vi.fn() },
  },
}))
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }),
  EVENT: { STANDINGS_UPDATED: 'standings.updated' },
}))

import { updateStandings } from '@/lib/redraft/standingsEngine'
import { byeWeekMedianCredits } from '@/lib/redraft/medianGame'
import { coinFlipDraw } from '@/lib/standings/tiebreakerOrder'

const LEAGUE_ID = 'league-tb-7731'
const data = (id: string) => h.updates.find((u) => u.where.id === id)!.data
const order = () =>
  h.updates
    .filter((u) => 'playoffSeed' in u.data)
    .sort((a, b) => Number(a.data.playoffSeed) - Number(b.data.playoffSeed))
    .map((u) => u.where.id)

const season = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}, platform = 'allfantasy') => ({
  leagueId: LEAGUE_ID,
  season: 2026,
  medianGame: false,
  playoffStartWeek: 15,
  playoffBracket: null,
  league: { medianGame: false, settings, playoffSeedingRule: null, platform },
  ...extra,
})

const game = (id: string, week: number, home: string, away: string, hs: number, as: number, status = 'final') => ({
  id, week, type: 'regular', homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as, status, isMedianMatchup: false, lineupSnapshots: null,
})
const bye = (id: string, week: number, rosterId: string, extra: Record<string, unknown> = {}) => ({
  id, week, type: 'regular', homeRosterId: rosterId, awayRosterId: null, homeScore: 0, awayScore: 0, status: 'scheduled', isMedianMatchup: false, lineupSnapshots: null, ...extra,
})

/*
 * Three weeks, four teams:
 *   wk1  tb-ace 150 – 80 tb-cat     tb-bee 100 – 90 tb-dot
 *   wk2  tb-bee 100 – 95 tb-ace     tb-dot 120 – 60 tb-cat
 *   wk3  tb-ace 140 – 100 tb-dot    tb-cat 110 – 90 tb-bee
 * tb-ace 2-1, 385 PF · tb-bee 2-1, 290 PF (and won the meeting with tb-ace)
 * tb-dot 1-2, 310 PF · tb-cat 1-2, 250 PF (tb-dot won their meeting)
 */
const TEAMS = ['tb-ace', 'tb-bee', 'tb-cat', 'tb-dot']
const SEASON = [
  game('tb-m1', 1, 'tb-ace', 'tb-cat', 150, 80),
  game('tb-m2', 1, 'tb-bee', 'tb-dot', 100, 90),
  game('tb-m3', 2, 'tb-bee', 'tb-ace', 100, 95),
  game('tb-m4', 2, 'tb-dot', 'tb-cat', 120, 60),
  game('tb-m5', 3, 'tb-ace', 'tb-dot', 140, 100),
  game('tb-m6', 3, 'tb-cat', 'tb-bee', 110, 90),
]

beforeEach(() => {
  h.updates = []
  h.rosters = TEAMS.map((id) => ({ id, ownerId: `owner-${id}` }))
  h.matchups = SEASON
  h.season = season({})
})

describe('custom tiebreaker order', () => {
  it('no order set: win% → points for, as before (positive control)', async () => {
    await updateStandings('season-tb-1', 3)
    expect(data('tb-ace')).toMatchObject({ wins: 2, losses: 1, pointsFor: 385 })
    expect(data('tb-bee')).toMatchObject({ wins: 2, losses: 1, pointsFor: 290 })
    expect(order()).toEqual(['tb-ace', 'tb-bee', 'tb-dot', 'tb-cat'])
  })

  it('head-to-head first: the 2-1 team that won the meeting goes ahead of the points leader', async () => {
    h.season = season({ tiebreaker_order: ['head_to_head', 'points_for', 'points_against', 'all_play', 'coin_flip'] })
    await updateStandings('season-tb-1', 3)
    expect(order()).toEqual(['tb-bee', 'tb-ace', 'tb-dot', 'tb-cat'])
  })

  it('coin flip first: the seeded draw decides each tied pair, the same on every run', async () => {
    h.season = season({ tiebreaker_order: ['coin_flip'] })
    await updateStandings('season-tb-1', 3)
    const draw = (id: string) => coinFlipDraw(`${LEAGUE_ID}:2026`, id)
    const pair = (x: string, y: string) => (draw(x) > draw(y) ? [x, y] : [y, x])
    const expected = [...pair('tb-ace', 'tb-bee'), ...pair('tb-cat', 'tb-dot')]
    expect(order()).toEqual(expected)
    const first = order()
    h.updates = []
    await updateStandings('season-tb-1', 3)
    expect(order()).toEqual(first)
  })

  it('record still comes first: a custom order only separates teams level on record', async () => {
    h.season = season({ tiebreaker_order: ['points_against'] })
    await updateStandings('season-tb-1', 3)
    const o = order()
    expect(o.slice(0, 2).sort()).toEqual(['tb-ace', 'tb-bee'])
    expect(o.slice(2).sort()).toEqual(['tb-cat', 'tb-dot'])
  })

  it('an imported league ignores the setting and follows the default order', async () => {
    h.season = season({ tiebreaker_order: ['head_to_head'] }, {}, 'sleeper')
    await updateStandings('season-tb-1', 3)
    expect(order()).toEqual(['tb-ace', 'tb-bee', 'tb-dot', 'tb-cat'])
  })

  it('points-only seeding ignores the setting, as the bracket does', async () => {
    h.season = season({ tiebreaker_order: ['head_to_head'] })
    ;(h.season.league as Record<string, unknown>).playoffSeedingRule = 'points_only'
    await updateStandings('season-tb-1', 3)
    // Points only: 385, 310, 290, 250.
    expect(order()).toEqual(['tb-ace', 'tb-dot', 'tb-bee', 'tb-cat'])
  })
})

/*
 * Five teams, one bye a week:
 *   wk1  tb-ant 100 – 90 tb-bat     tb-cow 80 – 70 tb-dog     tb-eel bye
 * The week's team scores are 100, 90, 80, 70 → median 85.
 */
const ODD_TEAMS = ['tb-ant', 'tb-bat', 'tb-cow', 'tb-dog', 'tb-eel']
const ODD_WEEK_1 = [
  game('tb-o1', 1, 'tb-ant', 'tb-bat', 100, 90),
  game('tb-o2', 1, 'tb-cow', 'tb-dog', 80, 70),
  bye('tb-o3', 1, 'tb-eel'),
]

describe('bye week: median points for', () => {
  beforeEach(() => {
    h.rosters = ODD_TEAMS.map((id) => ({ id, ownerId: `owner-${id}` }))
    h.matchups = ODD_WEEK_1
  })

  it('the bye team is credited the week’s median as points for, and no result', async () => {
    await updateStandings('season-tb-odd', 1)
    expect(data('tb-eel')).toMatchObject({ wins: 0, losses: 0, ties: 0, pointsFor: 85, pointsAgainst: 0, streak: null })
    // Nobody else's points move.
    expect(data('tb-ant')).toMatchObject({ pointsFor: 100, pointsAgainst: 90 })
    expect(data('tb-dog')).toMatchObject({ pointsFor: 70, pointsAgainst: 80 })
  })

  it('accumulates across byes and stacks on games played', async () => {
    h.matchups = [
      ...ODD_WEEK_1,
      game('tb-o4', 2, 'tb-eel', 'tb-ant', 120, 60),
      game('tb-o5', 2, 'tb-bat', 'tb-cow', 50, 40),
      bye('tb-o6', 2, 'tb-dog'),
    ]
    await updateStandings('season-tb-odd', 2)
    expect(data('tb-eel')).toMatchObject({ wins: 1, losses: 0, pointsFor: 205, pointsAgainst: 60 })
    // Week 2 scores 120, 60, 50, 40 → median 55.
    expect(data('tb-dog')).toMatchObject({ wins: 0, losses: 1, pointsFor: 125, pointsAgainst: 80 })
  })

  it('no credit while a game of that week is still open', async () => {
    h.matchups = [ODD_WEEK_1[0], { ...ODD_WEEK_1[1], status: 'in_progress' }, ODD_WEEK_1[2]]
    await updateStandings('season-tb-odd', 1)
    expect(data('tb-eel')).toMatchObject({ pointsFor: 0 })
  })

  it('a bye that plays the extra matchup counts its own game, not the median', async () => {
    h.matchups = [
      ODD_WEEK_1[0],
      ODD_WEEK_1[1],
      bye('tb-o3', 1, 'tb-eel', {
        homeScore: 95,
        status: 'final',
        lineupSnapshots: { extraMatchup: { opponentRosterId: 'tb-ant', rule: 'top_scorer', reason: 'projected', scoring: 'leftover_only' } },
      }),
    ]
    await updateStandings('season-tb-odd', 1)
    expect(data('tb-eel')).toMatchObject({ wins: 0, losses: 1, pointsFor: 95, pointsAgainst: 100 })
  })

  it('a category league gets no credit (there is no comparable team score)', async () => {
    h.season = season({ scoring_mode: 'h2h_category' })
    await updateStandings('season-tb-odd', 1)
    expect(data('tb-eel')).toMatchObject({ pointsFor: 0 })
  })

  it('the pure helper gives the same credit', () => {
    expect(byeWeekMedianCredits(ODD_WEEK_1, { playoffStartWeek: 15 })).toEqual([{ week: 1, rosterId: 'tb-eel', median: 85 }])
  })
})

describe('byeWeekMedianCredits', () => {
  it('odd number of game scores: the middle one', () => {
    // Three teams' worth of scores cannot happen in a two-sided game list; a 7-team week has 6 scores.
    const rows = [
      game('tb-p1', 3, 'tb-ant', 'tb-bat', 10, 20),
      game('tb-p2', 3, 'tb-cow', 'tb-dog', 30, 40),
      game('tb-p3', 3, 'tb-eel', 'tb-fox', 50, 61),
      bye('tb-p4', 3, 'tb-gnu'),
    ]
    expect(byeWeekMedianCredits(rows, { playoffStartWeek: 15 })).toEqual([{ week: 3, rosterId: 'tb-gnu', median: 35 }])
  })

  it('playoff-phase weeks and median-game rows are never credited', () => {
    const rows = [
      game('tb-q1', 15, 'tb-ant', 'tb-bat', 100, 90),
      bye('tb-q2', 15, 'tb-cow'),
      game('tb-q3', 4, 'tb-ant', 'tb-bat', 100, 90),
      bye('tb-q4', 4, 'tb-cow', { isMedianMatchup: true }),
    ]
    expect(byeWeekMedianCredits(rows, { playoffStartWeek: 15 })).toEqual([])
  })

  it('the bye team’s own scored row is not part of its median', () => {
    const rows = [game('tb-r1', 2, 'tb-ant', 'tb-bat', 100, 80), bye('tb-r2', 2, 'tb-cow', { homeScore: 500, status: 'final' })]
    expect(byeWeekMedianCredits(rows, { playoffStartWeek: null })).toEqual([{ week: 2, rosterId: 'tb-cow', median: 90 }])
  })
})
