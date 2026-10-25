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

const store = vi.hoisted(() => ({ blob: null as unknown }))
vi.mock('@/lib/projections/dailySportFormStore', () => ({ readDailySportForm: vi.fn(async () => store.blob) }))

const slate = vi.hoisted(() => ({ byTeamDay: new Map<string, Map<string, Date>>(), calls: [] as unknown[] }))
vi.mock('@/lib/redraft/lineupLock', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/redraft/lineupLock')>()
  return {
    ...real,
    buildWeekKickoffMap: vi.fn(async (_db: unknown, args: unknown) => {
      slate.calls.push(args)
      return { byTeam: new Map(), firstKickoff: null, byTeamDay: slate.byTeamDay, warnings: [] }
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
  slate.calls.length = 0
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
