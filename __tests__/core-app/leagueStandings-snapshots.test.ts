import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `getLeagueStandings` with weekly snapshots (item 9): a settled week is folded once and stored; a later
 * visit reads it back and folds only what is newer; a stat correction invalidates it; the kill switch
 * turns the whole thing off. Prisma is a double that holds a tiny league in memory.
 */

type Row = { seasonYear: number; week: number; rosterId: string; matchupId: number | null; pointsFor: number; pointsAgainst: number }

const db = {
  rows: [] as Row[],
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  matchupQueries: [] as Array<Record<string, unknown>>,
  upserts: [] as string[],
  teams: [] as Array<Record<string, unknown>>,
  settings: {} as Record<string, unknown>,
}

function stats() {
  const by = new Map<string, { seasonYear: number; week: number; rows: number; scored: number; pf: number; pa: number }>()
  for (const r of db.rows) {
    const k = `${r.seasonYear}:${r.week}`
    const s = by.get(k) ?? { seasonYear: r.seasonYear, week: r.week, rows: 0, scored: 0, pf: 0, pa: 0 }
    s.rows += 1
    if (r.pointsFor > 0 || r.pointsAgainst > 0) s.scored += 1
    s.pf += r.pointsFor
    s.pa += r.pointsAgainst
    by.set(k, s)
  }
  return [...by.values()]
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => stats()),
    weeklyMatchup: {
      findMany: vi.fn(async (args: { where: { seasonYear: number; week?: { gt?: number; lte?: number } } }) => {
        db.matchupQueries.push(args.where)
        const w = args.where.week
        return db.rows.filter(
          (r) =>
            r.seasonYear === args.where.seasonYear &&
            (w?.gt == null || r.week > w.gt) &&
            (w?.lte == null || r.week <= w.lte),
        )
      }),
    },
    leagueTeam: { findMany: vi.fn(async () => db.teams) },
    seasonStandingFact: { findMany: vi.fn(async () => []) },
    sportsDataCache: {
      findMany: vi.fn(async (args: { where: { cacheKey: { in: string[] } } }) =>
        args.where.cacheKey.in
          .filter((k) => db.cache.has(k))
          .map((k) => ({ cacheKey: k, ...db.cache.get(k)! })),
      ),
      upsert: vi.fn(async (args: { where: { cacheKey: string }; create: { data: unknown; expiresAt: Date } }) => {
        db.upserts.push(args.where.cacheKey)
        db.cache.set(args.where.cacheKey, { data: args.create.data, expiresAt: args.create.expiresAt })
        return {}
      }),
    },
  },
}))

const { getLeagueStandings } = await import('@/lib/core-app/leagueStandings')
const { standingsSnapshotKey } = await import('@/lib/core-app/standingsSnapshots')

const USER = 'user-1'
const LEAGUE = 'af-league-1'
const PID = 'sleeper-123'

function ctx() {
  return {
    leagueId: LEAGUE,
    userId: USER,
    league: async () =>
      ({
        id: LEAGUE,
        name: 'Test League',
        platform: 'sleeper',
        platformLeagueId: PID,
        season: 2026,
        settings: db.settings,
      }) as never,
    claimedTeam: async () => null,
    claimedTeams: async () => [{ externalId: '2' }] as never,
  }
}

function week(w: number, scores: [number, number, number, number] | null): Row[] {
  const [a, b, c, d] = scores ?? [0, 0, 0, 0]
  return [
    { seasonYear: 2026, week: w, rosterId: '1', matchupId: 1, pointsFor: a, pointsAgainst: b },
    { seasonYear: 2026, week: w, rosterId: '2', matchupId: 1, pointsFor: b, pointsAgainst: a },
    { seasonYear: 2026, week: w, rosterId: '3', matchupId: 2, pointsFor: c, pointsAgainst: d },
    { seasonYear: 2026, week: w, rosterId: '4', matchupId: 2, pointsFor: d, pointsAgainst: c },
  ]
}

function team(id: string, wins: number, losses: number) {
  return { externalId: id, teamName: `Team ${id}`, ownerName: 'o', avatarUrl: null, wins, losses, ties: 0, pointsFor: 0, pointsAgainst: 0, currentRank: null }
}

beforeEach(() => {
  db.cache.clear()
  db.matchupQueries = []
  db.upserts = []
  db.settings = { playoffSettings: { playoffTeams: 2, playoffStartWeek: 5 } }
  // Weeks 1–3 final, week 4 unplayed, week 5 is a playoff week.
  db.rows = [
    ...week(1, [120, 100, 110, 90]),
    ...week(2, [100, 130, 90, 95]),
    ...week(3, [140, 100, 80, 120]),
    ...week(4, null),
    ...week(5, null),
  ]
  // Sleeper's records agree with weeks 1–3.
  db.teams = [team('1', 2, 1), team('2', 1, 2), team('3', 1, 2), team('4', 2, 1)]
})

afterEach(() => {
  delete process.env.CORE_STANDINGS_SNAPSHOTS_DISABLED
})

describe('getLeagueStandings — weekly snapshots', () => {
  it('folds every week on the first visit and stores the settled ones', async () => {
    const result = await getLeagueStandings(LEAGUE, USER, ctx())
    expect(result.available).toBe(true)
    if (!result.available) return
    // Regular season only: week 5 is a playoff week and never read.
    expect(db.matchupQueries).toEqual([{ leagueId: PID, seasonYear: 2026, week: { lte: 4 } }])
    expect(db.upserts).toEqual([1, 2, 3].map((w) => standingsSnapshotKey(PID, 2026, w)))
    expect(result.board.platformCheck).toBe('matches')
    expect(result.board.throughWeek).toBe(3)
    // 1 and 4 are 2-1 (1 has more points); 2 and 3 are 1-2 (2 has more).
    expect(result.board.teams.map((t) => [t.rosterId, t.record.wins])).toEqual([
      ['1', 2],
      ['4', 2],
      ['2', 1],
      ['3', 1],
    ])
    expect(result.week).toBe(4)
    expect(result.board.gamesRemaining).toBe(2)
  })

  it('reads stored weeks back and folds only what is newer', async () => {
    const first = await getLeagueStandings(LEAGUE, USER, ctx())
    db.matchupQueries = []
    db.upserts = []
    const second = await getLeagueStandings(LEAGUE, USER, ctx())
    expect(db.matchupQueries).toEqual([{ leagueId: PID, seasonYear: 2026, week: { gt: 3, lte: 4 } }])
    expect(db.upserts).toEqual([])
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('throws a stored week away when a stat correction changes it', async () => {
    await getLeagueStandings(LEAGUE, USER, ctx())
    db.matchupQueries = []
    db.upserts = []
    // Week 2: team 2's 130 becomes 99 — the result flips.
    db.rows = db.rows.map((r) => (r.week === 2 && r.rosterId === '2' ? { ...r, pointsFor: 99 } : r))
    db.rows = db.rows.map((r) => (r.week === 2 && r.rosterId === '1' ? { ...r, pointsAgainst: 99 } : r))
    db.teams = [team('1', 3, 0), team('2', 0, 3), team('3', 1, 2), team('4', 2, 1)]
    const result = await getLeagueStandings(LEAGUE, USER, ctx())
    // Week 1 is still valid; weeks 2 and 3 are refolded and rewritten.
    expect(db.matchupQueries).toEqual([{ leagueId: PID, seasonYear: 2026, week: { gt: 1, lte: 4 } }])
    expect(db.upserts).toEqual([2, 3].map((w) => standingsSnapshotKey(PID, 2026, w)))
    if (!result.available) throw new Error('expected a board')
    expect(result.board.teams[0]).toMatchObject({ rosterId: '1', record: { wins: 3, losses: 0, ties: 0 } })
  })

  it('does not store a live week the platform has not finalised', async () => {
    // Week 4 has started: one game has points.
    db.rows = db.rows.map((r) => (r.week === 4 && (r.rosterId === '1' || r.rosterId === '2') ? { ...r, pointsFor: 20, pointsAgainst: 15 } : r))
    const result = await getLeagueStandings(LEAGUE, USER, ctx())
    if (!result.available) throw new Error('expected a board')
    expect(result.board.pendingWeeks).toEqual([4])
    expect(result.board.throughWeek).toBe(3)
    expect(db.upserts).toEqual([1, 2, 3].map((w) => standingsSnapshotKey(PID, 2026, w)))
    // Both week-4 games still count as left to play.
    expect(result.board.gamesRemaining).toBe(2)
  })

  it('does nothing with the cache when the kill switch is set', async () => {
    process.env.CORE_STANDINGS_SNAPSHOTS_DISABLED = '1'
    await getLeagueStandings(LEAGUE, USER, ctx())
    await getLeagueStandings(LEAGUE, USER, ctx())
    expect(db.upserts).toEqual([])
    expect(db.matchupQueries.every((q) => (q.week as { gt?: number }).gt == null)).toBe(true)
  })

  it('gives unpaired rosters no record — the fifteen leagues that showed everyone 1-0', async () => {
    db.rows = [1, 2, 3, 4].map((i) => ({
      seasonYear: 2026,
      week: 1,
      rosterId: String(i),
      matchupId: i,
      pointsFor: 100 + i,
      pointsAgainst: 0,
    }))
    db.teams = [team('1', 0, 0), team('2', 0, 0), team('3', 0, 0), team('4', 0, 0)]
    const result = await getLeagueStandings(LEAGUE, USER, ctx())
    if (!result.available) throw new Error('expected a board')
    expect(result.board.hasHeadToHead).toBe(false)
    expect(result.teams.every((t) => t.wins === 0 && t.losses === 0)).toBe(true)
    expect(result.board.teams.map((t) => t.rosterId)).toEqual(['4', '3', '2', '1'])
  })

  it('still refuses a season with nothing scored', async () => {
    db.rows = [...week(1, null), ...week(2, null)]
    const result = await getLeagueStandings(LEAGUE, USER, ctx())
    expect(result.available).toBe(false)
    expect(db.upserts).toEqual([])
  })

  it('reads divisions from the league settings', async () => {
    db.settings = {
      ...db.settings,
      standings_divisions: { source: 'sleeper', names: { '1': 'North', '2': 'South' }, teams: { '1': '1', '2': '1', '3': '2', '4': '2' } },
    }
    const result = await getLeagueStandings(LEAGUE, USER, ctx())
    if (!result.available) throw new Error('expected a board')
    expect(result.board.divisions).toEqual([
      { key: '1', name: 'North' },
      { key: '2', name: 'South' },
    ])
    expect(result.board.teams.find((t) => t.rosterId === '2')).toMatchObject({ division: { name: 'North' }, divisionRank: 2 })
  })
})
