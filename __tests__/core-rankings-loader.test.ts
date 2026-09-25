import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/core/rankings` loader and its daily snapshot writer, against an in-memory
 * Prisma double that honours the `where` clauses the loader actually sends.
 *
 * ⚠ THE DOUBLE FILTERS BY ID ON PURPOSE. A mock that returned every row for every
 * query would let `loadCareerLedger([you])` hand back the whole community, and a
 * test of "your XP" would pass while summing strangers' seasons.
 */

type LegacyRow = {
  id: string
  userId: string
  name: string
  sleeperLeagueId: string
  season: number
  sport: string
  leagueType: string
  scoringType: string
  specialtyFormat: string
  isSF: boolean
  isTEP: boolean
  teamCount: number
  playoffTeams: number
  status: string
  winnerRosterId: number | null
  updatedAt: Date
  rosters: Array<{
    wins: number
    losses: number
    ties: number
    pointsFor: number
    isChampion: boolean
    finalStanding: number | null
    playoffSeed: number | null
    updatedAt: Date
  }>
}

const state = {
  profiles: [] as Array<Record<string, unknown>>,
  links: [] as Array<{ id: string; legacyUserId: string | null }>,
  legacy: [] as LegacyRow[],
  cache: new Map<string, unknown>(),
  failProfiles: false,
  upserts: [] as Array<{ key: string; data: unknown }>,
}

function inList(where: unknown, path: string[]): string[] | null {
  let cur: unknown = where
  for (const p of path) cur = (cur as Record<string, unknown> | undefined)?.[p]
  return Array.isArray(cur) ? (cur as string[]) : null
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => {
      if (state.failProfiles) throw new Error('db down')
      return state.profiles
    }),
    league: { findMany: vi.fn(async () => []) },
    appUser: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        const ids = inList(args.where, ['id', 'in']) ?? []
        return state.links.filter((l) => ids.includes(l.id))
      }),
    },
    legacyLeague: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        const ids = inList(args.where, ['userId', 'in']) ?? []
        return state.legacy.filter((l) => ids.includes(l.userId))
      }),
    },
    franchiseSeason: { findMany: vi.fn(async () => []) },
    // The ledger's claimed-team source (see __tests__/career-ledger-claimed-teams.test.ts).
    // Without these the loader silently takes that source's degrade path on every test.
    leagueTeam: { findMany: vi.fn(async () => []) },
    leagueSeason: { findMany: vi.fn(async () => []) },
    sportsDataCache: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        const keys = inList(args.where, ['cacheKey', 'in']) ?? []
        return keys.filter((k) => state.cache.has(k)).map((k) => ({ cacheKey: k, data: state.cache.get(k) }))
      }),
      findFirst: vi.fn(async () => {
        const keys = [...state.cache.keys()].filter((k) => k.startsWith('core-rankings:daily:v1:')).sort()
        return keys.length ? { cacheKey: keys[0] } : null
      }),
      findUnique: vi.fn(async (args: { where: { cacheKey: string } }) =>
        state.cache.has(args.where.cacheKey) ? { cacheKey: args.where.cacheKey } : null,
      ),
      upsert: vi.fn(async (args: { where: { cacheKey: string }; create: { data: unknown } }) => {
        state.upserts.push({ key: args.where.cacheKey, data: args.create.data })
        state.cache.set(args.where.cacheKey, args.create.data)
        return {}
      }),
    },
  },
}))

vi.mock('@/lib/core-app/leagueStandings', () => ({ getLeagueStandings: vi.fn(async () => null) }))
vi.mock('@/lib/core-app/playerFinder', () => ({ searchPlayers: vi.fn(async () => []) }))

let n = 0
function league(userId: string, over: Partial<LegacyRow> & { wins: number; losses: number; champ?: boolean; seed?: number | null }): LegacyRow {
  n += 1
  const { wins, losses, champ = false, seed = null, ...rest } = over
  return {
    id: `LL${n}`,
    userId,
    name: `League ${n}`,
    sleeperLeagueId: `S${n}`,
    season: 2024,
    sport: 'nfl',
    leagueType: 'Redraft',
    scoringType: 'PPR',
    specialtyFormat: 'standard',
    isSF: false,
    isTEP: false,
    teamCount: 12,
    playoffTeams: 6,
    status: 'complete',
    winnerRosterId: champ ? 1 : 2,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    rosters: [
      {
        wins,
        losses,
        ties: 0,
        pointsFor: 100 * wins + 1200,
        isChampion: champ,
        finalStanding: null,
        playoffSeed: seed,
        updatedAt: new Date('2026-09-02T00:00:00Z'),
      },
    ],
    ...rest,
  }
}

const NOW = new Date('2026-09-16T16:00:00Z') // Wednesday, Eastern

beforeEach(() => {
  vi.resetModules()
  n = 0
  state.failProfiles = false
  state.upserts = []
  state.cache = new Map()
  state.profiles = [
    { userId: 'u1', username: 'alice', displayName: null, avatarUrl: null, xp_total: BigInt(0), rank_calculated_at: new Date('2026-09-10T00:00:00Z') },
    { userId: 'u2', username: 'bob', displayName: null, avatarUrl: null, xp_total: null, rank_calculated_at: new Date('2026-09-10T00:00:00Z') },
    { userId: 'u3', username: 'cara', displayName: null, avatarUrl: null, xp_total: null, rank_calculated_at: new Date('2026-09-10T00:00:00Z') },
  ]
  state.links = [
    { id: 'u1', legacyUserId: 'L1' },
    { id: 'u2', legacyUserId: 'L2' },
    { id: 'u3', legacyUserId: 'L3' },
  ]
  state.legacy = [
    ...Array.from({ length: 5 }, (_, i) => league('L1', { wins: 11, losses: 3, champ: i < 2, seed: 1, season: 2020 + i })),
    ...Array.from({ length: 5 }, (_, i) => league('L2', { wins: 5, losses: 9, seed: null, season: 2020 + i })),
    league('L3', { wins: 14, losses: 0, champ: true, seed: 1 }),
  ]
})

describe('getRankingsData — community scope', () => {
  it('ranks on the ledger, states who is left off, and reads movement from the stored snapshot', async () => {
    // Seven Eastern days before 2026-09-16 is 2026-09-09: bob was #1, alice #2.
    state.cache.set('core-rankings:daily:v1:2026-09-09', {
      date: '2026-09-09',
      population: 3,
      rows: [
        { u: 'u2', r: 1, s: 60 },
        { u: 'u1', r: 2, s: 55 },
      ],
    })
    const { getRankingsData } = await import('@/lib/core-app/rankings')
    const data = await getRankingsData('u1', null, {}, NOW)

    expect(data.scope).toBe('global')
    expect(data.population).toBe(3)
    const g = data.global!
    expect(g.rows.map((r) => [r.handle, r.rank, r.movement])).toEqual([
      ['alice', 1, 1],
      ['bob', 2, -1],
    ])
    expect(g.belowSample).toBe(1) // cara: one league-season under the default floor of 3
    expect(g.you).toMatchObject({ rank: 1, of: 2 })
    expect(g.you?.movement.sevenDay).toBe(1)
    expect(g.movementTracked).toBe(true)
    expect(g.trackingSince).toBe('2026-09-09')
    expect(g.rows[0].isYou).toBe(true)
    expect(g.rows[1].compareHref).toContain('user=bob')
    expect(g.freshness.ledgerRows).toBe(11)
    expect(data.shareUrl).toBe('/api/share/career-card?design=rank')
  })

  it('computes YOUR XP from your own ledger only', async () => {
    const { getRankingsData } = await import('@/lib/core-app/rankings')
    const data = await getRankingsData('u1', null, {}, NOW)
    // alice: 55 wins, 2 titles, 5 berths, 5 years, 12-team leagues (+4 each).
    expect(data.you?.xp).toBe(55 * 10 + 2 * 200 + 5 * 30 + 5 * 10 + 5 * 4)
    // The stored total is 0, so the screen must say the two disagree.
    expect(data.reconciliation).toMatchObject({ stored: 0, matches: false })
  })

  it('does not track movement on a filtered board', async () => {
    const { getRankingsData } = await import('@/lib/core-app/rankings')
    const data = await getRankingsData('u1', null, { season: '2024', min: '1' }, NOW)
    const g = data.global!
    expect(g.movementTracked).toBe(false)
    expect(g.rows.every((r) => r.movement == null)).toBe(true)
    expect(data.filtersLabel).toBe('2024')
    // Cara now qualifies: min 1 and her only season is 2024.
    expect(g.rows.map((r) => r.handle)).toContain('cara')
  })

  it('opens the explain panel only for a manager on the board', async () => {
    const { getRankingsData } = await import('@/lib/core-app/rankings')
    const hit = await getRankingsData('u1', null, { explain: 'u2' }, NOW)
    expect(hit.global?.explain?.handle).toBe('bob')
    const miss = await getRankingsData('u1', null, { explain: 'u3' }, NOW)
    expect(miss.global?.explain).toBeNull()
  })

  it('renders an unavailable board without rows', async () => {
    const { getRankingsData } = await import('@/lib/core-app/rankings')
    const data = await getRankingsData('u1', null, { board: 'drafters' }, NOW)
    expect(data.global?.unavailable).toMatch(/no link back/)
    expect(data.global?.rows).toEqual([])
  })
})

describe('getRankingsData — portfolio scope', () => {
  it('lists every league-season you have, sorted newest first, with your season line', async () => {
    const { getRankingsData } = await import('@/lib/core-app/rankings')
    const data = await getRankingsData('u1', null, { scope: 'portfolio' }, NOW)
    const p = data.portfolio!
    expect(data.global).toBeNull()
    expect(p.rows.map((r) => r.season)).toEqual([2024, 2023, 2022, 2021, 2020])
    expect(p.seasons.map((s) => s.season)).toEqual([2020, 2021, 2022, 2023, 2024])
    expect(p.globalRank).toEqual({ rank: 1, of: 2 })
    // No snapshots at all: the 7-day line is empty, not a row of nulls.
    expect(p.daily).toEqual([])
  })
})

describe('runRankingsDailySnapshot', () => {
  it('writes today’s Overall board once, keyed on the Eastern date', async () => {
    const { runRankingsDailySnapshot } = await import('@/lib/core-app/rankingsCommunity')
    const first = await runRankingsDailySnapshot(new Date('2026-09-17T02:30:00Z')) // still the 16th in New York
    expect(first).toMatchObject({ date: '2026-09-16', written: 1, alreadyWritten: 0, failed: 0, population: 2 })
    expect(state.upserts).toHaveLength(1)
    expect(state.upserts[0].key).toBe('core-rankings:daily:v1:2026-09-16')
    expect((state.upserts[0].data as { rows: Array<{ u: string; r: number }> }).rows.map((r) => [r.u, r.r])).toEqual([
      ['u1', 1],
      ['u2', 2],
    ])

    const second = await runRankingsDailySnapshot(new Date('2026-09-17T03:00:00Z'))
    expect(second).toMatchObject({ written: 0, alreadyWritten: 1 })
    expect(state.upserts).toHaveLength(1)
  })

  it('counts a failure instead of throwing', async () => {
    state.failProfiles = true
    const { runRankingsDailySnapshot } = await import('@/lib/core-app/rankingsCommunity')
    const out = await runRankingsDailySnapshot(NOW)
    expect(out.failed).toBe(1)
    expect(out.errors[0]).toMatch(/rankings_snapshot: db down/)
    expect(state.upserts).toHaveLength(0)
  })

  it('does nothing when switched off', async () => {
    vi.stubEnv('CORE_RANKINGS_SNAPSHOT_DISABLED', 'true')
    try {
      const { runRankingsDailySnapshot } = await import('@/lib/core-app/rankingsCommunity')
      const out = await runRankingsDailySnapshot(NOW)
      expect(out).toMatchObject({ date: null, written: 0, alreadyWritten: 0, failed: 0 })
      expect(state.upserts).toHaveLength(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
