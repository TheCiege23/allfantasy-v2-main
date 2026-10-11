/**
 * 🛑 `/api/redraft/roster` priced every projection on the STORED `RedraftRosterPlayer.injuryStatus`, and
 * `applyInjuryStatuses` left any player with no live row carrying that snapshot into the response and the
 * lineup validation (`starter_ineligible_injury`). The snapshot is stale by construction: last week's
 * "Out" zeroed a cleared starter and failed a legal lineup; a stored "Questionable" hid a player the feed
 * now has Out. The live row (or, for NFL, the canonical designation) now wins, and no live row is null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  rosterPlayers: [] as Array<Record<string, unknown>>,
  liveRows: [] as Array<Record<string, unknown>>,
  canonical: new Map<string, Record<string, unknown>>(),
}))

const projectionMock = vi.hoisted(() =>
  vi.fn((input: { injuryStatus?: string | null }) => ({
    weeklyProjection: input.injuryStatus === 'Out' ? 0 : 15,
    restOfSeasonProjection: 100,
    floorProjection: 5,
    ceilingProjection: 20,
    confidenceScore: 70,
    confidenceLevel: 'medium',
    source: 'provider_projection',
  })),
)
const validateMock = vi.hoisted(() => vi.fn(() => ({ ok: true, issues: [], errorCount: 0, warningCount: 0 })))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => {
  const rows = () => []
  return {
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
      league: { findUnique: vi.fn(async () => ({ settings: {} })) },
      playerWeeklyScore: { findMany: vi.fn(async () => rows()) },
      fantasyProjection: { findMany: vi.fn(async () => rows()) },
      aFProjectionSnapshot: { findMany: vi.fn(async () => rows()) },
      playerSeasonStats: { findMany: vi.fn(async () => rows()) },
      allFantasyAdpSnapshot: { findMany: vi.fn(async () => rows()) },
      sportsInjury: { findMany: vi.fn(async () => h.liveRows) },
    },
  }
})
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }))
vi.mock('@/lib/adp/computeAllFantasyAdp', () => ({ buildPlayerKey: vi.fn(() => 'k') }))
vi.mock('@/lib/redraft/projectionEngine', () => ({ buildAllFantasyProjection: projectionMock }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ calculateScoreFromSportConfig: vi.fn() }))
vi.mock('@/lib/redraft/lineupValidation', () => ({ applyRedraftLineupMoves: vi.fn(), validateRedraftLineup: validateMock }))
vi.mock('@/lib/redraft/lineupLock', () => ({
  hydrateRedraftLineupLocks: vi.fn(async (_db: unknown, args: { players: unknown[] }) => ({ players: args.players, warnings: [] })),
}))
vi.mock('@/lib/redraft/rosterConfigResolver', () => ({ resolveRedraftRosterConfig: vi.fn(() => null) }))
vi.mock('@/lib/nfl-data-foundation', () => ({
  getCanonicalNflPlayerContext: vi.fn(async (id: string) => h.canonical.get(id) ?? null),
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

const rp = (playerId: string, playerName: string, injuryStatus: string | null) => ({
  playerId,
  playerName,
  position: 'WR',
  team: 'DAL',
  sport: 'NFL',
  slotType: 'WR',
  isLocked: false,
  injuryStatus,
  byeWeek: null,
})

beforeEach(() => {
  projectionMock.mockClear()
  validateMock.mockClear()
  h.canonical = new Map()
  h.rosterPlayers = [
    rp('p-snap', 'Stale Snapshot', 'Out'),
    rp('p-live', 'Live Out', 'Questionable'),
    rp('p-canon', 'Canonical Questionable', 'Out'),
  ]
  h.liveRows = [
    { sport: 'NFL', playerId: 'p-live', playerName: 'Live Out', status: 'Out', date: new Date(), fetchedAt: new Date() },
  ]
  h.canonical.set('p-canon', { injuryStatus: 'Questionable', projection: null, byeWeek: null })
})

async function read() {
  const res = await GET(createMockNextRequest('http://localhost/api/redraft/roster?rosterId=r1&week=6'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { roster: { players: Array<{ playerId: string; injuryStatus: string | null; weeklyProjection: number | null }> } }
  return Object.fromEntries(body.roster.players.map((p) => [p.playerId, p]))
}

describe('/api/redraft/roster — the live designation wins over the stored snapshot', () => {
  it('🛑 projections are priced on the live / canonical designation, never the stored one', async () => {
    await read()
    const priced = Object.fromEntries(
      projectionMock.mock.calls.map(([input]) => [(input as { playerId: string }).playerId, (input as { injuryStatus: string | null }).injuryStatus]),
    )
    expect(priced).toEqual({ 'p-snap': null, 'p-live': 'Out', 'p-canon': 'Questionable' })
  })

  it('🛑 the response and the lineup validation carry no stored snapshot', async () => {
    const players = await read()
    expect(players['p-snap'].injuryStatus).toBeNull()
    expect(players['p-snap'].weeklyProjection).toBe(15)
    expect(players['p-live'].injuryStatus).toBe('Out')
    const validated = (validateMock.mock.calls.at(-1)?.[0] as { players: Array<{ playerId: string; injuryStatus: string | null }> }).players
    expect(Object.fromEntries(validated.map((p) => [p.playerId, p.injuryStatus]))).toMatchObject({ 'p-snap': null, 'p-live': 'Out' })
  })
})
