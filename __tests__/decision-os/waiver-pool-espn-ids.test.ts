/**
 * 🛑 The waiver pool in an ESPN league: who is really rostered.
 *
 * ESPN 12483 is Matthew Stafford; Sleeper 12483 is Jack Bech (Sleeper's Stafford is 421). On
 * 2026-09-29 Stafford sat on 8 production ESPN rosters under 12483. The pool read those rosters raw,
 * so in Sleeper's space it subtracted JACK BECH (a real free agent there) and never subtracted
 * Stafford — recommending a rostered quarterback as a waiver add, with a FAAB bid attached.
 *
 * Read through `sleeperReadableRosters`, 12483 on an ESPN roster becomes 421 via the identity map.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const IDENTITY: Array<{ espnId: string; sleeperId: string }> = [{ espnId: '12483', sleeperId: '421' }]

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: vi.fn(async () => [
        // Another manager's ESPN roster, holding Stafford under his ESPN id.
        { id: 'r-them', platformUserId: 'them', playerData: { players: ['12483'], starters: ['12483'] } },
        { id: 'r-me', platformUserId: 'me', playerData: { players: [], starters: [] } },
      ]),
    },
    league: {
      findUnique: vi.fn(async () => ({
        settings: { roster_positions: ['QB', 'RB', 'WR', 'BN'] },
        leagueType: 'Redraft',
        leagueSize: 2,
        season: 2026,
        platform: 'espn',
      })),
    },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: { espnId: { in: string[] } } }) =>
        IDENTITY.filter((r) => where.espnId.in.includes(r.espnId)),
      ),
    },
  },
}))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForSport: vi.fn(async () => [
    { player_id: '421', external_source_id: null, full_name: 'Matthew Stafford', position: 'QB' },
    { player_id: '12483', external_source_id: null, full_name: 'Jack Bech', position: 'WR' },
  ]),
}))
vi.mock('@/lib/core-app/playerTradeVisual', () => ({
  marketContextFor: () => ({
    teams: 2,
    variant: { superflex: false, dynasty: false, keeper: false, idp: false, bestBall: false },
    scoring: { settings: {}, receptionWeight: 0.5, format: 'half_ppr' },
  }),
}))
vi.mock('@/lib/trade-intel/marketValueService', () => ({
  getMarketValues: vi.fn(async () => null),
  playerValueForLeague: () => null,
}))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 4 })) }))
vi.mock('@/lib/core-app/byeWeekMap', () => ({ resolveByeWeekMap: vi.fn(async () => ({})) }))

const { loadWaiverPool } = await import('@/lib/decision-os/waiver/pool')

beforeEach(() => vi.clearAllMocks())

describe('loadWaiverPool — an ESPN league', () => {
  it('never offers the rostered Stafford (ESPN 12483 → Sleeper 421); Jack Bech (Sleeper 12483) IS available', async () => {
    const pool = await loadWaiverPool('L1', 'NFL', 'r-me')
    const names = pool.availablePlayers.map((p) => p.name)
    expect(names).not.toContain('Matthew Stafford')
    expect(names).toContain('Jack Bech')
  })
})
