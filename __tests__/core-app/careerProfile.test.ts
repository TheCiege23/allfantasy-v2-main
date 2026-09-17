import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The profile store's contract: a stored profile is served only while the stamp
 * of its sources still matches, and anything else rebuilds — a stale profile is
 * never shown, not even while a rebuild runs.
 */

const db = vi.hoisted(() => ({
  appUser: { findUnique: vi.fn() },
  legacyUser: { findUnique: vi.fn() },
  leagueTeam: { findMany: vi.fn(), },
  league: { aggregate: vi.fn() },
  seasonStandingFact: { aggregate: vi.fn(), findMany: vi.fn() },
  legacyLeague: { aggregate: vi.fn(), findMany: vi.fn() },
  legacyRoster: { aggregate: vi.fn() },
  leagueTrade: { aggregate: vi.fn(), findMany: vi.fn() },
  sportsDataCache: { findUnique: vi.fn(), upsert: vi.fn() },
  $queryRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { readCareerProfile, refreshCareerProfile, careerProfileKey, CAREER_PROFILE_VERSION } = await import(
  '@/lib/core-app/careerProfile'
)

const updated = new Date('2026-09-10T00:00:00Z')

function stubSources({ legacyLeagueCount = 2 } = {}) {
  db.appUser.findUnique.mockResolvedValue({ username: 'guap', displayName: null, avatarUrl: null, legacyUserId: 'LU1' })
  db.$queryRaw.mockResolvedValue([{ xp_total: 1200 }])
  db.legacyUser.findUnique.mockResolvedValue({ sleeperUserId: '591', sleeperUsername: 'guap' })
  db.leagueTeam.findMany.mockResolvedValue([])
  db.league.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: null } })
  db.legacyLeague.aggregate.mockResolvedValue({ _count: { _all: legacyLeagueCount }, _max: { updatedAt: updated } })
  db.legacyRoster.aggregate.mockResolvedValue({ _count: { _all: legacyLeagueCount }, _max: { updatedAt: updated } })
  db.leagueTrade.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { createdAt: null } })
  db.leagueTrade.findMany.mockResolvedValue([])
  // loadCareerRows
  db.legacyLeague.findMany.mockResolvedValue([
    {
      id: 'LL1',
      sleeperLeagueId: 'S1',
      name: 'Dynasty Dragons',
      season: 2023,
      sport: 'nfl',
      leagueType: 'dynasty',
      scoringType: 'ppr',
      teamCount: 12,
      playoffTeams: 6,
      status: 'complete',
      rosters: [{ wins: 10, losses: 4, ties: 0, pointsFor: 1600, pointsAgainst: 1400, isChampion: true, finalStanding: 1, playoffSeed: 1 }],
    },
  ])
}

describe('careerProfile', () => {
  beforeEach(() => {
    for (const model of Object.values(db)) {
      if (typeof model === 'function') (model as ReturnType<typeof vi.fn>).mockReset()
      else for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset()
    }
    db.sportsDataCache.upsert.mockResolvedValue({})
    // `$queryRaw` is a tagged template; the import-row query returns nothing here.
    delete process.env.CORE_CAREER_PROFILE_DISABLED
  })

  it('rebuilds and stores when nothing is stored', async () => {
    stubSources()
    db.sportsDataCache.findUnique.mockResolvedValue(null)
    db.$queryRaw.mockResolvedValueOnce([{ xp_total: 1200 }]).mockResolvedValue([])

    const p = await readCareerProfile('u1')
    expect(p.origin).toBe('built')
    expect(p.source.rows).toHaveLength(1)
    expect(p.source.rows[0]).toMatchObject({ isChampion: true, counted: true, sport: 'NFL' })
    await vi.waitFor(() => expect(db.sportsDataCache.upsert).toHaveBeenCalledTimes(1))
    expect(db.sportsDataCache.upsert.mock.calls[0][0].where.cacheKey).toBe(careerProfileKey('u1'))
  })

  it('serves the stored profile without re-reading the history when the stamp matches', async () => {
    stubSources()
    db.$queryRaw.mockResolvedValueOnce([{ xp_total: 1200 }]).mockResolvedValue([])
    db.sportsDataCache.findUnique.mockResolvedValue(null)
    await readCareerProfile('u1')
    await vi.waitFor(() => expect(db.sportsDataCache.upsert).toHaveBeenCalled())
    const stored = db.sportsDataCache.upsert.mock.calls[0][0].create.data

    db.legacyLeague.findMany.mockClear()
    db.$queryRaw.mockResolvedValue([{ xp_total: 1300 }])
    db.sportsDataCache.findUnique.mockResolvedValue({ data: stored, expiresAt: new Date(Date.now() + 60_000) })

    const p = await readCareerProfile('u1')
    expect(p.origin).toBe('stored')
    expect(db.legacyLeague.findMany).not.toHaveBeenCalled()
    // Identity is live, never stored.
    expect(p.source.identity.xpTotal).toBe(1300)
  })

  it('never serves a stored profile whose sources moved', async () => {
    stubSources()
    const stale = {
      version: CAREER_PROFILE_VERSION,
      builtAt: '2026-09-01T00:00:00Z',
      stamp: 'i0@0|c0@0#x|f0|l1@0|r1@0|t0|uLU1',
      rows: [],
      platforms: [],
      rosterless: 0,
      trades: [],
    }
    db.sportsDataCache.findUnique.mockResolvedValue({ data: stale, expiresAt: new Date(Date.now() + 60_000) })
    db.$queryRaw.mockResolvedValueOnce([{ xp_total: 1200 }]).mockResolvedValue([])

    const p = await readCareerProfile('u1')
    expect(p.origin).toBe('built')
    expect(p.source.rows).toHaveLength(1)
  })

  it('treats a document of another version as a miss', async () => {
    stubSources()
    db.sportsDataCache.findUnique.mockResolvedValue({
      data: { version: CAREER_PROFILE_VERSION + 1, stamp: 'x', builtAt: 'x', rows: [], platforms: [], trades: [], rosterless: 0 },
      expiresAt: new Date(Date.now() + 60_000),
    })
    db.$queryRaw.mockResolvedValueOnce([{ xp_total: 1200 }]).mockResolvedValue([])
    expect((await readCareerProfile('u1')).origin).toBe('built')
  })

  /*
   * Finals: the loader reads stored Sleeper title games, and the stamp digests them. The raw
   * queries are told apart by their SQL, since `$queryRaw` is a tagged template.
   */
  function routeRawQueries(state: { digest: string; titleRows: unknown[] }) {
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join('?') : String(strings)
      if (sql.includes('xp_total')) return [{ xp_total: 1200 }]
      if (sql.includes('md5(')) return [{ n: state.titleRows.length, digest: state.digest }]
      if (sql.includes('jsonb_build_object')) return state.titleRows
      return []
    })
  }

  const LOST_FINAL = {
    leagueId: 'L-S1',
    season: 2023,
    platformLeagueId: 'S1',
    ps: { bracketPlacementVersion: 2, championRosterId: 7, runnerUpRosterId: 3 },
  }

  it('carries a lost final from the stored bracket into the rows and the tile', async () => {
    stubSources()
    db.legacyLeague.findMany.mockResolvedValue([
      {
        id: 'LL1',
        sleeperLeagueId: 'S1',
        name: 'Dynasty Dragons',
        season: 2023,
        sport: 'nfl',
        leagueType: 'dynasty',
        scoringType: 'ppr',
        teamCount: 12,
        playoffTeams: 6,
        status: 'complete',
        rosters: [{ rosterId: 3, wins: 10, losses: 4, ties: 0, pointsFor: 1600, pointsAgainst: 1400, isChampion: false, finalStanding: 2, playoffSeed: 1 }],
      },
    ])
    routeRawQueries({ digest: 'aaa', titleRows: [LOST_FINAL] })
    db.sportsDataCache.findUnique.mockResolvedValue(null)

    const p = await readCareerProfile('u1')
    expect(p.source.rows[0]).toMatchObject({ finalResult: 'lost', isChampion: false })
    const { buildCareerData, NO_CAREER_FILTER } = await import('@/lib/core-app/careerModel')
    expect(buildCareerData(p.source, NO_CAREER_FILTER).accomplishments).toMatchObject({ finals: 1, finalsLost: 1, championships: 0 })
  })

  it('rebuilds when a stored title game changes, and not otherwise', async () => {
    stubSources()
    const state = { digest: 'aaa', titleRows: [LOST_FINAL] as unknown[] }
    routeRawQueries(state)
    db.sportsDataCache.findUnique.mockResolvedValue(null)
    await readCareerProfile('u1')
    await vi.waitFor(() => expect(db.sportsDataCache.upsert).toHaveBeenCalled())
    const stored = db.sportsDataCache.upsert.mock.calls[0][0].create.data
    expect(stored.stamp).toMatch(/\|d1#aaa/)
    db.sportsDataCache.findUnique.mockResolvedValue({ data: stored, expiresAt: new Date(Date.now() + 60_000) })

    expect((await readCareerProfile('u1')).origin).toBe('stored')
    state.digest = 'bbb'
    expect((await readCareerProfile('u1')).origin).toBe('built')
  })

  it('treats a version-1 document — rows without finals — as a miss', async () => {
    stubSources()
    routeRawQueries({ digest: '', titleRows: [] })
    db.sportsDataCache.findUnique.mockResolvedValue(null)
    await readCareerProfile('u1')
    await vi.waitFor(() => expect(db.sportsDataCache.upsert).toHaveBeenCalled())
    const current = db.sportsDataCache.upsert.mock.calls[0][0].create.data
    expect(CAREER_PROFILE_VERSION).toBeGreaterThanOrEqual(2)

    db.sportsDataCache.findUnique.mockResolvedValue({ data: { ...current, version: 1 }, expiresAt: new Date(Date.now() + 60_000) })
    expect((await readCareerProfile('u1')).origin).toBe('built')
  })

  it('refresh never throws and honours the kill switch', async () => {
    process.env.CORE_CAREER_PROFILE_DISABLED = '1'
    expect(await refreshCareerProfile('u1')).toEqual({ ok: false, rows: 0 })
    expect(db.sportsDataCache.upsert).not.toHaveBeenCalled()
    delete process.env.CORE_CAREER_PROFILE_DISABLED

    db.appUser.findUnique.mockRejectedValue(new Error('down'))
    db.$queryRaw.mockRejectedValue(new Error('down'))
    db.leagueTeam.findMany.mockRejectedValue(new Error('down'))
    await expect(refreshCareerProfile('u1')).resolves.toEqual({ ok: false, rows: 0 })
  })
})
