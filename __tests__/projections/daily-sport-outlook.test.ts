/**
 * The request-path loader (lib/projections/dailySportOutlook.ts): roster/pool ids reach the stored form
 * lines through the identity bridge, team names in either spelling reach the week's slate, and the
 * period is the week — or today, in a daily-lineup league. Reads are mocked; arithmetic is real.
 *
 * NBA 2026 opened Tue 20 Oct, so 2026-10-25 is week 1 (20–26 Oct).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const store = vi.hoisted(() => ({ blob: null as unknown, prior: null as unknown }))
vi.mock('@/lib/projections/dailySportFormStore', () => ({
  readDailySportForm: vi.fn(async () => store.blob),
  readPriorDailySportForm: vi.fn(async () => store.prior),
}))

type Opp = { opponent: string; home: boolean }
const slate = vi.hoisted(() => ({
  byTeamDay: new Map<string, Map<string, Date>>(),
  opponents: new Map<string, Map<string, { opponent: string; home: boolean }>>(),
  calls: [] as unknown[],
}))
vi.mock('@/lib/redraft/lineupLock', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/redraft/lineupLock')>()
  return {
    ...real,
    buildWeekKickoffMap: vi.fn(async (_db: unknown, args: unknown) => {
      slate.calls.push(args)
      return { byTeam: new Map(), firstKickoff: null, byTeamDay: slate.byTeamDay, opponentsByTeamDay: slate.opponents, warnings: [] }
    }),
  }
})

import { applyDailySportOutlook, loadDailySportOutlook } from '@/lib/projections/dailySportOutlook'
import type { DailySportFormBlob } from '@/lib/projections/dailySportForm'

const NOW = new Date('2026-10-25T18:00:00Z')
const days = (...d: string[]) => new Map(d.map((x) => [x, new Date(`${x}T23:00:00Z`)]))

// Identity rows: RI 907 -> uuid-a (C, Denver); RI 74 -> uuid-b (C, Miami); RI 55 -> uuid-c (PG, Miami).
const identity = [
  { id: 'uuid-a', rollingInsightsId: '907', sleeperId: null },
  { id: 'uuid-b', rollingInsightsId: '74', sleeperId: null },
  { id: 'uuid-c', rollingInsightsId: '55', sleeperId: null },
]
const db = {
  playerIdentityMap: {
    findMany: vi.fn(async (args: { where: { rollingInsightsId?: { in: string[] }; sleeperId?: { in: string[] } } }) =>
      args.where.rollingInsightsId ? identity.filter((r) => args.where.rollingInsightsId!.in.includes(r.rollingInsightsId)) : [],
    ),
  },
} as never

// Lines summed already: a has 3 games of 20 pts (60), b 2 games of 10 pts (20), c 2 games of 5 pts.
const blob: DailySportFormBlob = {
  v: 1,
  sport: 'NBA',
  season: 2026,
  computedAt: '2026-10-25T07:00:00.000Z',
  recentGames: 10,
  players: {
    'uuid-a': { pos: 'C', team: 'DEN', sg: 3, ss: { pts: 60 }, rg: 3, rs: { pts: 60 }, part: null },
    'uuid-b': { pos: 'C', team: 'MIA', sg: 2, ss: { pts: 20 }, rg: 2, rs: { pts: 20 }, part: null },
    'uuid-c': { pos: 'PG', team: 'MIA', sg: 2, ss: { pts: 10 }, rg: 2, rs: { pts: 10 }, part: null },
  },
}

const league = (settings: Record<string, unknown> = {}) => ({ sport: 'NBA', season: 2026, settings })

beforeEach(() => {
  store.blob = blob
  store.prior = null
  slate.calls.length = 0
  slate.opponents = new Map<string, Map<string, Opp>>([
    ['DENVER NUGGETS', new Map([['2026-10-24', { opponent: 'Miami Heat', home: false }], ['2026-10-25', { opponent: 'Utah Jazz', home: true }]])],
    ['MIAMI HEAT', new Map([['2026-10-26', { opponent: 'Boston Celtics', home: true }]])],
  ])
  // TheSportsDB names, normalized the way the lineup lock keys them.
  slate.byTeamDay = new Map([
    ['DENVER NUGGETS', days('2026-10-21', '2026-10-24', '2026-10-25')],
    ['MIAMI HEAT', days('2026-10-22', '2026-10-26')],
  ])
})

describe('loadDailySportOutlook', () => {
  it('weekly league: per game x this week\'s team games; full names and codes both reach the slate', async () => {
    const out = await loadDailySportOutlook(db, {
      league: league(),
      players: [
        { key: 'r907', lookupId: '907', team: 'Denver Nuggets', injuryStatus: null },
        { key: 'r74', lookupId: '74', team: 'MIA', injuryStatus: null },
      ],
      now: NOW,
    })
    expect(slate.calls).toEqual([{ sport: 'NBA', season: 2026, week: 1 }])
    expect(out.period).toEqual({ kind: 'week', season: 2026, week: 1, day: null })
    // a: 20 per game x 3 Denver games
    expect(out.byKey.get('r907')).toMatchObject({ projectedPoints: 60, periodGames: 3, perGame: 20, seasonPoints: 60 })
    // b: 10 per game x 2 Miami games
    expect(out.byKey.get('r74')).toMatchObject({ projectedPoints: 20, periodGames: 2 })
    expect(out.byKey.get('r907')!.positionRank).toEqual({ position: 'C', rank: 1, of: 2 })
    expect(out.byKey.get('r74')!.positionRank).toEqual({ position: 'C', rank: 2, of: 2 })
  })

  it('daily league: the period is today — a game today is 1, none is 0', async () => {
    const daily = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
    const out = await loadDailySportOutlook(db, {
      league: league(daily),
      players: [
        { key: 'den', lookupId: '907', team: 'Denver Nuggets', injuryStatus: null },
        { key: 'mia', lookupId: '74', team: 'Miami Heat', injuryStatus: null },
      ],
      now: NOW,
    })
    expect(out.period).toEqual({ kind: 'day', season: 2026, week: 1, day: '2026-10-25' })
    expect(out.byKey.get('den')).toMatchObject({ periodGames: 1, projectedPoints: 20 })
    expect(out.byKey.get('mia')).toMatchObject({ periodGames: 0, projectedPoints: 0 })
  })

  it('a ruled-out player projects 0 but keeps his rank; an unknown id gets nothing', async () => {
    const out = await loadDailySportOutlook(db, {
      league: league(),
      players: [
        { key: 'hurt', lookupId: '907', team: 'DEN', injuryStatus: 'Out' },
        { key: 'ghost', lookupId: '999999', team: 'DEN', injuryStatus: null },
      ],
      now: NOW,
    })
    expect(out.byKey.get('hurt')).toMatchObject({ projectedPoints: 0, positionRank: { position: 'C', rank: 1, of: 2 } })
    expect(out.byKey.has('ghost')).toBe(false)
  })

  it('no slate this week is "unknown", not a zero for everyone; the rank still prints', async () => {
    slate.byTeamDay = new Map()
    const out = await loadDailySportOutlook(db, {
      league: league(),
      players: [{ key: 'r55', lookupId: '55', team: 'MIA', injuryStatus: null }],
      now: NOW,
    })
    expect(out.byKey.get('r55')).toMatchObject({ projectedPoints: null, periodGames: null, positionRank: { position: 'PG', rank: 1, of: 1 } })
  })

  it('declines a categories league, and says when the form lines are missing', async () => {
    const cats = await loadDailySportOutlook(db, { league: league({ scoring_mode: 'categories' }), players: [], now: NOW })
    expect(cats.reason).toBe('category_league')
    store.blob = null
    const none = await loadDailySportOutlook(db, { league: league(), players: [], now: NOW })
    expect(none.reason).toBe('form_not_computed')
    const nfl = await loadDailySportOutlook(db, { league: { sport: 'NFL', season: 2026, settings: {} }, players: [], now: NOW })
    expect(nfl.reason).toBe('not_a_daily_form_sport')
  })
})

describe('the day picker: a daily league prices the SELECTED day', () => {
  const daily = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
  const roster = [
    { key: 'den', lookupId: '907', team: 'Denver Nuggets', injuryStatus: null },
    { key: 'mia', lookupId: '74', team: 'Miami Heat', injuryStatus: null },
  ]

  it('a future day: that day\'s games and that day\'s opponent, not today\'s', async () => {
    const out = await loadDailySportOutlook(db, { league: league(daily), players: roster, now: NOW, day: '2026-10-26' })
    expect(out.period).toEqual({ kind: 'day', season: 2026, week: 1, day: '2026-10-26' })
    // Denver plays today (the 25th) but not on the 26th; Miami is the other way round.
    expect(out.byKey.get('den')).toMatchObject({ periodGames: 0, projectedPoints: 0, opponent: null, homeAway: null })
    expect(out.byKey.get('mia')).toMatchObject({ periodGames: 1, projectedPoints: 10, opponent: 'BOS', homeAway: 'home' })
  })

  it('a past day in the week, and today when nothing (or garbage) is selected', async () => {
    const sat = await loadDailySportOutlook(db, { league: league(daily), players: roster, now: NOW, day: '2026-10-24' })
    expect(sat.byKey.get('den')).toMatchObject({ periodGames: 1, projectedPoints: 20, opponent: 'MIA', homeAway: 'away' })
    for (const day of [undefined, null, 'tomorrow', '2026-13-45']) {
      const today = await loadDailySportOutlook(db, { league: league(daily), players: roster, now: NOW, day })
      expect(today.period?.day).toBe('2026-10-25')
      expect(today.byKey.get('den')).toMatchObject({ periodGames: 1, opponent: 'UTA', homeAway: 'home' })
    }
  })

  it('a day in the NEXT week reads that week\'s slate', async () => {
    await loadDailySportOutlook(db, { league: league(daily), players: roster, now: NOW, day: '2026-10-27' })
    expect(slate.calls).toEqual([{ sport: 'NBA', season: 2026, week: 2 }])
  })

  it('a weekly league ignores a day: its period stays the week, and it names no opponent', async () => {
    const out = await loadDailySportOutlook(db, { league: league(), players: roster, now: NOW, day: '2026-10-26' })
    expect(out.period).toEqual({ kind: 'week', season: 2026, week: 1, day: null })
    expect(out.byKey.get('den')).toMatchObject({ periodGames: 3, projectedPoints: 60 })
    expect(out.byKey.get('den')).not.toHaveProperty('opponent')
  })

  it('the opponent reaches the wire row, and from there the lineup row', async () => {
    const out = await loadDailySportOutlook(db, { league: league(daily), players: roster, now: NOW, day: '2026-10-26' })
    const [den, mia] = applyDailySportOutlook([{ id: 'den', projectedPoints: null, projectionsSource: null }, { id: 'mia', projectedPoints: null, projectionsSource: null }], out)
    expect(mia).toMatchObject({ periodOpponent: 'BOS', periodHomeAway: 'home', projectedPoints: 10 })
    expect(den).toMatchObject({ periodOpponent: null, projectedPoints: 0 })
  })
})

describe('prior-season blend through the loader', () => {
  it('blends last season in by PRIOR_SEASON_BLEND_GAMES and prices a player with no game yet', async () => {
    store.prior = {
      ...blob,
      season: 2025,
      players: {
        'uuid-a': { pos: 'C', team: 'DEN', sg: 70, ss: { pts: 700 }, rg: 10, rs: { pts: 0 }, part: null }, // 10 a game
        'uuid-z': { pos: 'C', team: 'DEN', sg: 60, ss: { pts: 900 }, rg: 10, rs: { pts: 0 }, part: null }, // 15 a game
      },
    }
    identity.push({ id: 'uuid-z', rollingInsightsId: '300', sleeperId: null })
    try {
      const out = await loadDailySportOutlook(db, {
        league: league(),
        players: [
          { key: 'a', lookupId: '907', team: 'DEN', injuryStatus: null },
          { key: 'z', lookupId: '300', team: 'DEN', injuryStatus: null },
        ],
        now: NOW,
      })
      expect(out.priorSeason).toBe(2025)
      // a: (3 x 20 + 6 x 10) / 9 = 13.33 a game, x 3 Denver games
      expect(out.byKey.get('a')).toMatchObject({ perGame: 13.33, projectedPoints: 39.99, positionRank: { position: 'C', rank: 1, of: 2 } })
      // z: no game this season — last season's 15 a game, x 3; not ranked this season
      expect(out.byKey.get('z')).toMatchObject({ perGame: 15, projectedPoints: 45, positionRank: null })
    } finally {
      identity.pop()
    }
  })

  it('a prior built from season totals is declined by a league weighting a key the totals lack', async () => {
    const totalsPrior = {
      ...blob,
      season: 2025,
      basis: 'season_totals',
      mappedKeys: ['pts', 'reb', 'ast', 'stl', 'blk', 'to', 'threes', 'fgm', 'ftm', 'fga', 'fta'],
      players: { 'uuid-a': { pos: 'C', team: 'DEN', sg: 70, ss: { pts: 700 }, rg: 0, rs: {}, part: null } },
    }
    store.prior = totalsPrior
    const players = [{ key: 'a', lookupId: '907', team: 'DEN', injuryStatus: null }]
    // NBA's default scoring weights double-doubles, which the totals cannot supply: this season alone.
    const declined = await loadDailySportOutlook(db, { league: league(), players, now: NOW })
    expect(declined.priorSeason).toBeNull()
    expect(declined.byKey.get('a')).toMatchObject({ perGame: 20 })
    // A league that scores neither double takes the totals rate: (3 x 20 + 6 x 10) / 9.
    const accepted = await loadDailySportOutlook(db, {
      league: league({ sportConfig: { categoryPoints: { pts: 1, dbl_dbl: 0, trpl_dbl: 0 } } }),
      players,
      now: NOW,
    })
    expect(accepted.priorSeason).toBe(2025)
    expect(accepted.byKey.get('a')).toMatchObject({ perGame: 13.33 })
  })

  it('no prior season stored: this season alone, unchanged', async () => {
    const out = await loadDailySportOutlook(db, { league: league(), players: [{ key: 'a', lookupId: '907', team: 'DEN', injuryStatus: null }], now: NOW })
    expect(out.priorSeason).toBeNull()
    expect(out.byKey.get('a')).toMatchObject({ perGame: 20, projectedPoints: 60 })
  })
})

describe('MLB pitcher participation (owner: kept as is)', () => {
  it('a starter who takes one turn in five projects a fifth of his per-start rate; a hitter does not scale', async () => {
    store.blob = {
      v: 1, sport: 'MLB', season: 2026, computedAt: blob.computedAt, recentGames: 15,
      players: {
        'uuid-a': { pos: 'SP', team: 'NYY', sg: 2, ss: { so: 20 }, rg: 2, rs: { so: 20 }, part: 0.2 },
        'uuid-b': { pos: 'OF', team: 'NYY', sg: 2, ss: { r: 4 }, rg: 2, rs: { r: 4 }, part: null },
      },
    }
    slate.byTeamDay = new Map([['NYY', days('2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30')]])
    const mlb = { sport: 'MLB', season: 2026, settings: { sportConfig: { categoryPoints: { so: 1, r: 1 } } } }
    const now = new Date('2026-03-27T18:00:00Z')
    const out = await loadDailySportOutlook(db, {
      league: mlb,
      players: [
        { key: 'sp', lookupId: '907', team: 'NYY', injuryStatus: null },
        { key: 'of', lookupId: '74', team: 'NYY', injuryStatus: null },
      ],
      now,
    })
    // SP: 10 a start x 5 team games x 0.2 participation = 10; OF: 2 a game x 5 = 10 with no scaling.
    expect(out.byKey.get('sp')).toMatchObject({ perGame: 10, periodGames: 5, projectedPoints: 10 })
    expect(out.byKey.get('of')).toMatchObject({ perGame: 2, periodGames: 5, projectedPoints: 10 })
  })
})

describe('applyDailySportOutlook', () => {
  it('stamps projection, source and rank; leaves an unpriced row exactly as it was', async () => {
    const out = await loadDailySportOutlook(db, {
      league: league(),
      players: [{ key: 'r907', lookupId: '907', team: 'DEN', injuryStatus: null }],
      now: NOW,
    })
    const rows = [
      { id: 'r907', projectedPoints: null, projectionsSource: null },
      { id: 'other', projectedPoints: 7, projectionsSource: 'x' },
    ]
    const [a, b] = applyDailySportOutlook(rows, out)
    expect(a).toMatchObject({ projectedPoints: 60, projectionsSource: 'allfantasy:projection_recent_form', positionRankLabel: 'C1' })
    expect(b).toBe(rows[1])
  })
})
