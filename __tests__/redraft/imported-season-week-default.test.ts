/**
 * 🛑 Imported redraft leagues were stuck on week 1 on every surface that defaults a week.
 *
 * Measured 2026-10-12: all 534 imported 2026 NFL seasons stored `currentWeek = 1` while the NFL was on
 * week 5-6. `/api/redraft/season` returned it verbatim (RedraftTab then asked for week-1 roster, matchups
 * and live scoring), the roster GET defaulted a missing `?week=` to 1 — which also filtered the injury
 * read to `week IN (1, null)` — and the live-scoring runtime defaulted to `currentWeek || 1`.
 *
 * Each surface now goes through `resolveEffectiveRedraftWeek`. The schedule resolver is stubbed to the
 * week the NFL is on (6); a native season stored at 5 must keep 5.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  platform: 'sleeper' as string,
  storedWeek: 1,
  season: () => ({
    id: 's1',
    leagueId: 'L',
    sport: 'NFL',
    season: 2026,
    currentWeek: h.storedWeek,
    totalWeeks: 14,
    playoffStartWeek: 15,
    status: 'in_season',
    rosters: [],
  }),
  resolveWeek: vi.fn(async () => ({ ok: true, fantasyWeek: 6, sportWeek: 6, phase: 'regular', state: 'live', sportWeekComplete: false, slate: null, source: 'schedule' })),
}))

const prismaMock = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  redraftRoster: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
  redraftRosterPlayer: { findMany: vi.fn(async () => []) },
  redraftMatchup: { findMany: vi.fn(async () => []) },
  league: { findUnique: vi.fn() },
  playerIdentityMap: { findMany: vi.fn(async () => []) },
  playerWeeklyScore: { findMany: vi.fn(async () => []) },
  fantasyProjection: { findMany: vi.fn(async () => []) },
  aFProjectionSnapshot: { findMany: vi.fn(async () => []) },
  playerSeasonStats: { findMany: vi.fn(async () => []) },
  allFantasyAdpSnapshot: { findMany: vi.fn(async () => []) },
  sportsInjury: { findMany: vi.fn(async () => []) },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/season-week/seasonWeekService', () => ({
  resolveSeasonWeekForRedraftSeason: h.resolveWeek,
  resolveSportWeek: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }))
vi.mock('@/lib/post-draft', () => ({ ensurePostDraftFinalized: vi.fn() }))
vi.mock('@/lib/redraft/fantraxNativePresentation', () => ({ loadFantraxNativePresentation: vi.fn(async () => null) }))
vi.mock('@/lib/adp/computeAllFantasyAdp', () => ({ buildPlayerKey: vi.fn(() => 'k') }))
vi.mock('@/lib/redraft/projectionEngine', () => ({
  buildAllFantasyProjection: vi.fn(() => ({ weeklyProjection: 10, confidenceLevel: 'medium', source: 'provider_projection' })),
}))
vi.mock('@/lib/redraft/scoringEngine', () => ({ calculateScoreFromSportConfig: vi.fn() }))
vi.mock('@/lib/redraft/lineupValidation', () => ({
  applyRedraftLineupMoves: vi.fn(),
  validateRedraftLineup: vi.fn(() => ({ ok: true, issues: [], errorCount: 0, warningCount: 0 })),
}))
vi.mock('@/lib/redraft/lineupLock', () => ({
  hydrateRedraftLineupLocks: vi.fn(async (_db: unknown, args: { players: unknown[] }) => ({ players: args.players, warnings: [] })),
  hydrateRedraftLineupLocksForRosters: vi.fn(async (_db: unknown, args: { players: unknown[] }) => ({ players: args.players })),
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
vi.mock('@/lib/league-runtime', () => ({
  resolveCanonicalLeagueRules: vi.fn(async () => ({ general: { sport: 'NFL', format: 'redraft' } })),
}))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn() }))
vi.mock('@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime', () => ({
  applyNflRedraftStatCorrection: vi.fn(),
  buildNflRedraftLiveScoringRuntimeState: vi.fn((args: { week: number }) => ({ week: args.week })),
  buildScoringRuntimeEvent: vi.fn(),
  buildScoringRuntimeEvents: vi.fn(() => []),
  calculateNflRedraftFantasyPoints: vi.fn(),
  normalizeNflRedraftPlayerStats: vi.fn(),
  resolveNflRedraftScoringSettings: vi.fn(),
}))

import { GET as seasonGET } from '@/app/api/redraft/season/route'
import { GET as rosterGET } from '@/app/api/redraft/roster/route'
import { resolveNflRedraftLiveScoringRuntime } from '@/lib/scoring-runtime/resolveNflRedraftLiveScoringRuntime'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.redraftSeason.findFirst.mockImplementation(async () => h.season())
  prismaMock.league.findUnique.mockImplementation(async () => ({ settings: {}, platform: h.platform }))
  prismaMock.redraftRoster.findFirst.mockImplementation(async () => ({
    id: 'r1',
    leagueId: 'L',
    ownerId: 'user-1',
    players: [{ playerId: 'p1', playerName: 'Player One', position: 'WR', team: 'DAL', sport: 'NFL', slotType: 'WR', isLocked: false, injuryStatus: null, byeWeek: null }],
    season: h.season(),
  }))
})

const CASES = [
  { name: '🛑 imported Sleeper season stored at 1', platform: 'sleeper', storedWeek: 1, expected: 6 },
  { name: 'native season keeps its engine week', platform: 'manual', storedWeek: 5, expected: 5 },
]

describe.each(CASES)('$name', ({ platform, storedWeek, expected }) => {
  beforeEach(() => {
    h.platform = platform
    h.storedWeek = storedWeek
  })

  it('/api/redraft/season returns the effective currentWeek', async () => {
    const res = await seasonGET(createMockNextRequest('http://localhost/api/redraft/season?leagueId=L'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { season: { currentWeek: number } }
    expect(body.season.currentWeek).toBe(expected)
  })

  it('/api/redraft/roster without ?week= reads scores and injuries at the effective week', async () => {
    const res = await rosterGET(createMockNextRequest('http://localhost/api/redraft/roster?rosterId=r1'))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { week: number }).week).toBe(expected)
    expect(prismaMock.playerWeeklyScore.findMany.mock.calls[0][0]).toMatchObject({ where: { week: expected } })
    const injuryWhere = JSON.stringify(prismaMock.sportsInjury.findMany.mock.calls[0][0])
    expect(injuryWhere).toContain(`{"week":${expected}}`)
  })

  it('an explicit ?week= still wins on the roster route', async () => {
    const res = await rosterGET(createMockNextRequest('http://localhost/api/redraft/roster?rosterId=r1&week=3'))
    expect(((await res.json()) as { week: number }).week).toBe(3)
  })

  it('the live-scoring runtime with no week (undefined or the route\'s null) scores the effective week', async () => {
    for (const week of [undefined, null]) {
      prismaMock.redraftMatchup.findMany.mockClear()
      const resolved = await resolveNflRedraftLiveScoringRuntime({ seasonId: 's1', week })
      expect(resolved.ok).toBe(true)
      expect(resolved.ok && resolved.state.week).toBe(expected)
      expect(prismaMock.redraftMatchup.findMany.mock.calls[0][0]).toMatchObject({ where: { week: expected } })
    }
  })

  it('the live-scoring runtime honours an explicit week', async () => {
    const resolved = await resolveNflRedraftLiveScoringRuntime({ seasonId: 's1', week: 2 })
    expect(resolved.ok && resolved.state.week).toBe(2)
  })
})
