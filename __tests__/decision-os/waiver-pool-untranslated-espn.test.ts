/**
 * 🛑 An ESPN rostered player the identity map cannot translate must not be offered as an add.
 *
 * `sleeperReadableRosters` DROPS an untranslatable ESPN id — right for naming (read raw it is somebody
 * else's Sleeper id), wrong for a pool that subtracts rostered players: dropped, he stays on the wire.
 * Measured 2026-09-29: 83 of 271 ESPN roster ids do not translate, and beside ~25 team defenses they
 * include Justin Jefferson (ESPN 4262921), Josh Allen, A.J. Brown and Kyler Murray.
 *
 * The pool now hides them by their ESPN identity row's name — a defense by team, anyone else by a
 * suffix-stripped name — and reports what it could not even name. The mock database honours `where`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

function matches(row: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (cond && typeof cond === 'object') {
      const c = cond as { in?: unknown[]; not?: unknown }
      if (c.in && !c.in.includes(row[key])) return false
      if ('not' in c && row[key] === c.not) return false
    } else if (row[key] !== cond) return false
  }
  return true
}

const IDENTITY_MAP: Row[] = [{ espnId: '12483', sleeperId: '421' }] // Stafford translates
const ESPN_IDENTITIES: Row[] = [
  { provider: 'espn', providerPlayerId: '4262921', displayName: 'Justin Jefferson' },
  { provider: 'espn', providerPlayerId: '-16022', displayName: 'ARI D/ST' },
  { provider: 'espn', providerPlayerId: '4239996', displayName: 'Travis Etienne Jr.' },
  // '999999' has no identity row at all.
]

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: vi.fn(async () => [
        {
          id: 'r-them',
          platformUserId: 'them',
          playerData: { players: ['12483', '4262921', '-16022', '4239996', '999999'], starters: ['4262921'] },
        },
        { id: 'r-me', platformUserId: 'me', playerData: { players: [], starters: [] } },
      ]),
    },
    league: {
      findUnique: vi.fn(async () => ({
        settings: { roster_positions: ['QB', 'RB', 'WR', 'DEF', 'BN'] },
        leagueType: 'Redraft',
        leagueSize: 2,
        season: 2026,
        platform: 'espn',
      })),
    },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: Where }) => IDENTITY_MAP.filter((r) => matches(r, where))),
    },
    playerProviderIdentity: {
      findMany: vi.fn(async ({ where }: { where: Where }) => ESPN_IDENTITIES.filter((r) => matches(r, where))),
    },
  },
}))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForSport: vi.fn(async () => [
    { player_id: '421', external_source_id: null, full_name: 'Matthew Stafford', position: 'QB', team_abbreviation: 'LAR' },
    { player_id: '6794', external_source_id: null, full_name: 'Justin Jefferson', position: 'WR', team_abbreviation: 'MIN' },
    { player_id: '7543', external_source_id: null, full_name: 'Travis Etienne', position: 'RB', team_abbreviation: 'NO' },
    { player_id: 'nfl:def:ARI', external_source_id: 'nfl:def:ARI', full_name: 'Arizona Cardinals', position: 'DEF', team_abbreviation: 'ARI' },
    { player_id: 'nfl:def:KC', external_source_id: 'nfl:def:KC', full_name: 'Kansas City Chiefs', position: 'DEF', team_abbreviation: 'KC' },
    { player_id: '12483', external_source_id: null, full_name: 'Jack Bech', position: 'WR', team_abbreviation: 'LV' },
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

describe('loadWaiverPool — an ESPN league’s untranslated rostered players', () => {
  it('never offers a rostered player the identity map could not translate — Jefferson, a Jr. suffix, a D/ST', async () => {
    const pool = await loadWaiverPool('L1', 'NFL', 'r-me')
    const names = pool.availablePlayers.map((p) => p.name).sort()
    // Stafford: translated and subtracted. Jefferson, Etienne and the ARI defense: untranslated, hidden by name.
    // Jack Bech (Sleeper 12483) and the KC defense are genuinely available.
    expect(names).toEqual(['Jack Bech', 'Kansas City Chiefs'])
  })

  it('reports what it did — and the one id it could not even name', async () => {
    const pool = await loadWaiverPool('L1', 'NFL', 'r-me')
    expect(pool.untranslatedRostered).toEqual({ ids: 4, excludedFromWire: 3, unnamed: 1 })
  })
})
