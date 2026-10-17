/**
 * 🛑 `/api/redraft/roster` read `playerSeasonStats.playerId IN <roster ids>` with no source filter. An NFL
 * roster holds SLEEPER ids; Rolling Insights / API-Sports season rows are keyed on the PROVIDER's own
 * number — so Justin Jefferson (Sleeper 6794) was priced on DaRon Bland's line (RI 6794). The stranger's
 * games fed projection confidence and, with no other projection, his PPG became the weekly projection.
 *
 * And `fantasy_projections` carries the AF engine's mirror row (`source: 'allfantasy'`) beside the
 * provider's (`source: 'sleeper'`) under one Sleeper id; whichever came last went to the engine as the
 * PROVIDER projection, labelled `provider_projection`.
 *
 * The prisma fake below EVALUATES the `where` it is given, so a query that drops the source filter or
 * asks the stats table with roster ids gets the stranger's row back — exactly as production did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  platform: 'sleeper' as string,
  rosterPlayers: [] as Row[],
  identity: [] as Row[],
  seasonStats: [] as Row[],
  projections: [] as Row[],
}))

const fake = vi.hoisted(() => {
  type R = Record<string, unknown>
  /** Minimal Prisma `where` evaluator: equality, `{ in }`, `{ not }`, and `OR` / `AND`. */
  function matches(row: R, where: R | undefined): boolean {
    if (!where) return true
    return Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as R[]).some((w) => matches(row, w))
      if (key === 'AND') return (cond as R[]).every((w) => matches(row, w))
      const value = row[key]
      if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
        const c = cond as R
        if ('in' in c && !(c.in as unknown[]).includes(value)) return false
        if ('not' in c && value === c.not) return false
        if ('equals' in c && value !== c.equals) return false
        return true
      }
      return value === cond
    })
  }
  return {
    findManyOver: (rows: () => R[]) => async (args: { where?: R } = {}) => rows().filter((r) => matches(r, args.where)),
  }
})

const projectionSpy = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRoster: {
      findFirst: vi.fn(async () => ({
        id: 'r1',
        leagueId: 'L',
        ownerId: 'user-1',
        players: h.rosterPlayers.map((p) => ({ ...p })),
        season: { season: 2026, sport: 'NFL', currentWeek: 6, totalWeeks: 17 },
      })),
    },
    league: { findUnique: vi.fn(async () => ({ settings: {}, platform: h.platform })) },
    playerIdentityMap: { findMany: fake.findManyOver(() => h.identity) },
    playerWeeklyScore: { findMany: vi.fn(async () => []) },
    fantasyProjection: { findMany: fake.findManyOver(() => h.projections) },
    aFProjectionSnapshot: { findMany: vi.fn(async () => []) },
    playerSeasonStats: { findMany: fake.findManyOver(() => h.seasonStats) },
    allFantasyAdpSnapshot: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }))
vi.mock('@/lib/redraft/projectionEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/redraft/projectionEngine')>()
  return {
    ...actual,
    buildAllFantasyProjection: (input: Parameters<typeof actual.buildAllFantasyProjection>[0]) => {
      projectionSpy(input)
      return actual.buildAllFantasyProjection(input)
    },
  }
})
vi.mock('@/lib/redraft/scoringEngine', () => ({ calculateScoreFromSportConfig: vi.fn() }))
vi.mock('@/lib/redraft/lineupValidation', () => ({
  applyRedraftLineupMoves: vi.fn(),
  validateRedraftLineup: vi.fn(() => ({ ok: true, issues: [], errorCount: 0, warningCount: 0 })),
}))
vi.mock('@/lib/redraft/lineupLock', () => ({
  hydrateRedraftLineupLocks: vi.fn(async (_db: unknown, args: { players: unknown[] }) => ({ players: args.players, warnings: [] })),
}))
vi.mock('@/lib/redraft/rosterConfigResolver', () => ({ resolveRedraftRosterConfig: vi.fn(() => null) }))
vi.mock('@/lib/nfl-data-foundation', () => ({
  getCanonicalNflPlayerContext: vi.fn(async () => null),
  getCanonicalNflPlayerByNameTeam: vi.fn(async () => null),
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: vi.fn(async () => []) }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: vi.fn((r: unknown) => r) }))
vi.mock('@/lib/players/getTeamLogo', () => ({ getTeamLogo: vi.fn(() => null) }))
vi.mock('@/lib/redraft/redraftRosterIdentity', () => ({
  resolveRedraftRosterLookup: vi.fn(async () => ({ season: { id: 's1', leagueId: 'L' }, roster: { id: 'r1', ownerId: 'user-1' } })),
}))
vi.mock('@/lib/redraft/rosterMoveHistory', () => ({ recordRedraftRosterMoveHistory: vi.fn() }))

import { GET } from '@/app/api/redraft/roster/route'

const rp = (playerId: string, playerName: string, position = 'WR') => ({
  playerId,
  playerName,
  position,
  team: 'MIN',
  sport: 'NFL',
  slotType: position,
  isLocked: false,
  injuryStatus: null,
  byeWeek: null,
})

const ri = (playerId: string, playerName: string, fantasyPointsPerGame: number, gamesPlayed: number, source = 'rolling_insights') => ({
  sport: 'NFL',
  playerId,
  playerName,
  season: '2026',
  seasonType: 'regular',
  source,
  fantasyPointsPerGame,
  gamesPlayed,
  stats: { name: playerName },
  fetchedAt: new Date('2026-10-10T00:00:00Z'),
})

type EngineInput = {
  playerId: string
  providerWeeklyProjection: number | null
  allFantasyWeeklyProjection: number | null
  rollingInsightsFantasyPointsPerGame: number | null
  rollingInsightsGamesPlayed: number | null
  rollingInsightsStats: unknown
}

async function read() {
  const res = await GET(createMockNextRequest('http://localhost/api/redraft/roster?rosterId=r1&week=6'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { roster: { players: Array<{ playerId: string; projectionSource: string }> } }
  const inputs = Object.fromEntries(
    projectionSpy.mock.calls.map(([input]) => [(input as EngineInput).playerId, input as EngineInput]),
  )
  const out = Object.fromEntries(body.roster.players.map((p) => [p.playerId, p]))
  return { inputs, out }
}

beforeEach(() => {
  projectionSpy.mockClear()
  h.platform = 'sleeper'
  h.rosterPlayers = []
  h.identity = []
  h.seasonStats = []
  h.projections = []
})

describe('/api/redraft/roster — season stats are the rostered player\'s OWN Rolling Insights line', () => {
  it('🛑 Jefferson (Sleeper 6794) gets HIS RI row through the identity map, never RI-id 6794 (DaRon Bland)', async () => {
    h.rosterPlayers = [rp('6794', 'Justin Jefferson')]
    h.identity = [{ sport: 'NFL', sleeperId: '6794', rollingInsightsId: '5904', canonicalName: 'Justin Jefferson' }]
    h.seasonStats = [ri('6794', 'DaRon Bland', 2.1, 5), ri('5904', 'Justin Jefferson', 14.97, 3)]

    const { inputs, out } = await read()
    expect(inputs['6794']!.rollingInsightsFantasyPointsPerGame).toBe(14.97)
    expect(inputs['6794']!.rollingInsightsGamesPlayed).toBe(3)
    expect(inputs['6794']!.rollingInsightsStats).toEqual({ name: 'Justin Jefferson' })
    // No other projection exists, so the RI FPPG IS the weekly projection — his, not Bland's.
    expect(out['6794']!.projectionSource).toBe('rolling_insights')
  })

  it('🛑 an id with no identity row gets no stats, even when an RI row carries the same number', async () => {
    h.rosterPlayers = [rp('9999', 'Unmapped Rookie')]
    h.seasonStats = [ri('9999', 'Somebody Else', 11, 5)]

    const { inputs } = await read()
    expect(inputs['9999']!.rollingInsightsFantasyPointsPerGame).toBeNull()
    expect(inputs['9999']!.rollingInsightsGamesPlayed).toBeNull()
    expect(inputs['9999']!.rollingInsightsStats).toBeNull()
  })

  it('🛑 api_sports rows are never attached — not by the roster id, not by the RI id (no apiSportsId crosswalk exists)', async () => {
    h.rosterPlayers = [rp('4866', 'Saquon Barkley', 'RB'), rp('7777', 'No Identity', 'RB')]
    h.identity = [{ sport: 'NFL', sleeperId: '4866', rollingInsightsId: '3853', canonicalName: 'Saquon Barkley' }]
    h.seasonStats = [
      ri('4866', 'Anthony Nelson', 3.3, 4, 'api_sports'),
      ri('3853', 'Api Sports 3853', 9.9, 6, 'api_sports'),
      ri('7777', 'Api Sports 7777', 8.8, 6, 'api_sports'),
    ]

    const { inputs } = await read()
    expect(inputs['4866']!.rollingInsightsFantasyPointsPerGame).toBeNull()
    expect(inputs['4866']!.rollingInsightsGamesPlayed).toBeNull()
    expect(inputs['7777']!.rollingInsightsFantasyPointsPerGame).toBeNull()
  })

  it('an ESPN league asks espnId, never sleeperId, even when the ESPN id is somebody\'s Sleeper id', async () => {
    h.platform = 'espn'
    h.rosterPlayers = [rp('3054211', 'Espn Guy')]
    h.identity = [
      { sport: 'NFL', espnId: '3054211', sleeperId: '1111', rollingInsightsId: '2001', canonicalName: 'Espn Guy' },
      { sport: 'NFL', sleeperId: '3054211', rollingInsightsId: '2002', canonicalName: 'Sleeper Namesake' },
    ]
    h.seasonStats = [ri('2001', 'Espn Guy', 7.5, 4), ri('2002', 'Sleeper Namesake', 19, 4)]

    const { inputs } = await read()
    expect(inputs['3054211']!.rollingInsightsFantasyPointsPerGame).toBe(7.5)
  })
})

describe('/api/redraft/roster — the AF mirror row is never the "provider" projection', () => {
  it('🛑 sleeper row → provider input; allfantasy mirror row → AF input, labelled as AF', async () => {
    h.rosterPlayers = [rp('6794', 'Justin Jefferson'), rp('9509', 'Bijan Robinson', 'RB')]
    const proj = (playerId: string, source: string, projectedPoints: number, fetchedAt: string) => ({
      playerId,
      sport: 'NFL',
      season: '2026',
      week: 6,
      source,
      projectedPoints,
      stats: source === 'allfantasy' ? { confidenceLevel: 'high' } : {},
      fetchedAt: new Date(fetchedAt),
    })
    h.projections = [
      // The AF row is newest for 6794, so a last-wins / newest-wins read would hand it over as the provider's.
      proj('6794', 'sleeper', 12.4, '2026-10-09T00:00:00Z'),
      proj('6794', 'allfantasy', 20.2, '2026-10-10T00:00:00Z'),
      proj('9509', 'allfantasy', 18.1, '2026-10-10T00:00:00Z'),
    ]

    const { inputs, out } = await read()
    expect(inputs['6794']!.providerWeeklyProjection).toBe(12.4)
    expect(inputs['6794']!.allFantasyWeeklyProjection).toBe(20.2)
    expect(inputs['9509']!.providerWeeklyProjection).toBeNull()
    expect(inputs['9509']!.allFantasyWeeklyProjection).toBe(18.1)
    expect(out['9509']!.projectionSource).toBe('allfantasy_snapshot')
    expect(out['9509']!.projectionSource).not.toBe('provider_projection')
  })
})
