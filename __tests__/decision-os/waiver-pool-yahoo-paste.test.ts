/**
 * 🛑 A pasted Yahoo league's unmatched rostered player must not be offered as an add.
 *
 * The paste import stores each player it resolved DECLARED (`sleeper:<id>`) and every other one as
 * `yahoo-paste:<name>|<pos>|<team>`. `sleeperReadableRostersWithGaps` keeps the declared ids and drops
 * the rest, so subtracting rosters from the wire left every unmatched player on it. Now (see
 * lib/core-app/declaredAvailability.ts):
 *
 *   - above the 80% coverage bar the wire stands, each unmatched player's own row hidden by name (a
 *     pasted defence by club), and the count travels as `declaredRostered`;
 *   - below it the pool is EMPTY and says it is unverified — Chimmy and the panel then refuse.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rosters: [] as Array<{ id: string; platformUserId: string; playerData: unknown }> }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: vi.fn(async () => h.rosters) },
    league: {
      findUnique: vi.fn(async () => ({
        settings: { roster_positions: ['QB', 'RB', 'WR', 'DEF', 'BN'] },
        leagueType: 'Redraft',
        leagueSize: 2,
        season: 2026,
        platform: 'yahoo',
      })),
    },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    playerProviderIdentity: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForSport: vi.fn(async () => [
    { player_id: '421', external_source_id: null, full_name: 'Matthew Stafford', position: 'QB', team_abbreviation: 'LAR' },
    { player_id: '6794', external_source_id: null, full_name: 'Justin Jefferson', position: 'WR', team_abbreviation: 'MIN' },
    { player_id: '7543', external_source_id: null, full_name: 'Travis Etienne', position: 'RB', team_abbreviation: 'NO' },
    { player_id: 'nfl:def:ARI', external_source_id: 'nfl:def:ARI', full_name: 'Arizona Cardinals', position: 'DEF', team_abbreviation: 'ARI' },
    { player_id: 'nfl:def:KC', external_source_id: 'nfl:def:KC', full_name: 'Kansas City Chiefs', position: 'DEF', team_abbreviation: 'KC' },
  ]),
}))
vi.mock('@/lib/core-app/playerTradeVisual', () => ({
  marketContextFor: () => ({
    teams: 2,
    variant: { superflex: false, dynasty: false, keeper: false, idp: false, bestBall: false },
    scoring: { settings: {}, receptionWeight: 0.5, format: 'half_ppr' },
  }),
}))
vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: vi.fn(async () => null), playerValueForLeague: () => null }))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 4 })) }))
vi.mock('@/lib/core-app/byeWeekMap', () => ({ resolveByeWeekMap: vi.fn(async () => ({})) }))

const { loadWaiverPool } = await import('@/lib/decision-os/waiver/pool')

const declared = (n: number) => Array.from({ length: n }, (_, i) => `sleeper:${100 + i}`)

beforeEach(() => vi.clearAllMocks())

describe('loadWaiverPool — a pasted Yahoo league', () => {
  it('above the bar: the wire stands, and counts the unmatched rostered players', async () => {
    // 8 declared of 10 distinct ids = 80%: clears the bar.
    h.rosters = [
      { id: 'r-them', platformUserId: 'them', playerData: { players: ['sleeper:421', ...declared(6), 'yahoo-paste:justin jefferson|WR|MIN', 'yahoo-paste:arizona|DEF|ARI'] } },
      { id: 'r-me', platformUserId: 'me', playerData: { players: ['sleeper:999'] } },
    ]
    const pool = await loadWaiverPool('Y1', 'NFL', 'r-me')
    expect(pool.declaredRostered).toEqual({ verified: true, unmatched: 2 })
    // Stafford is declared and subtracted; Etienne and the KC defence are genuinely free.
    expect(pool.availablePlayers.map((p) => p.name).sort()).toEqual(['Kansas City Chiefs', 'Travis Etienne'])
  })

  it('🛑 an unmatched pasted player — and a pasted defence — is never offered as available', async () => {
    h.rosters = [
      { id: 'r-them', platformUserId: 'them', playerData: { players: ['sleeper:421', ...declared(6), 'yahoo-paste:justin jefferson|WR|MIN', 'yahoo-paste:arizona|DEF|ARI'] } },
      { id: 'r-me', platformUserId: 'me', playerData: { players: ['sleeper:999'] } },
    ]
    const names = (await loadWaiverPool('Y1', 'NFL', 'r-me')).availablePlayers.map((p) => p.name)
    expect(names).not.toContain('Justin Jefferson')
    expect(names).not.toContain('Arizona Cardinals')
  })

  it('below the bar: nobody is available, and the pool says it could not verify', async () => {
    h.rosters = [
      { id: 'r-them', platformUserId: 'them', playerData: { players: ['yahoo-paste:justin jefferson|WR|MIN', 'yahoo-paste:a|RB|NO', 'yahoo-paste:b|QB|KC'] } },
      { id: 'r-me', platformUserId: 'me', playerData: { players: ['sleeper:421'] } },
    ]
    const pool = await loadWaiverPool('Y1', 'NFL', 'r-me')
    expect(pool.declaredRostered).toEqual({ verified: false, unmatched: 3 })
    expect(pool.availablePlayers).toEqual([])
  })
})
