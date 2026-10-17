// @vitest-environment node
/**
 * 🛑 The last unscoped `SportsPlayer.externalId` reads, burned down (2026-09-30).
 *
 * Every case here is one person's id reaching another person's row, because `externalId` is several
 * id spaces in one column: Sleeper 9228 is Bryce Young; Rolling Insights 9228 is an offensive tackle.
 * The mock database HONOURS the query's `where` (OR, `in`, `not`), so a read that asks the wrong column
 * gets the wrong row back here exactly as it would in production.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  function matches(row: Row, where: Record<string, unknown>): boolean {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'OR') {
        if (!(cond as Array<Record<string, unknown>>).some((w) => matches(row, w))) return false
        continue
      }
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { in?: unknown[]; not?: unknown }
        if (c.in && !c.in.includes(row[key])) return false
        if ('not' in c && row[key] === c.not) return false
      } else if (row[key] !== cond) return false
    }
    return true
  }
  return {
    matches,
    sportsPlayers: [] as Row[],
    identities: [] as Row[],
    identityWheres: [] as Array<Record<string, unknown>>,
    optimizerPlayers: [] as Array<{
      id: string
      name: string
      positions: string[]
    }>,
    sportsPlayerRows(where: Record<string, unknown>): Row[] {
      return this.sportsPlayers.filter((r) => matches(r, where))
    },
  }
})
const matches = h.matches

const BRYCE = {
  id: 'sp-bryce',
  sport: 'NFL',
  source: 'sleeper',
  externalId: 'sleeper:9228',
  sleeperId: '9228',
  name: 'Bryce Young',
  position: 'QB',
  team: 'CAR',
  age: 25,
  status: null,
  updatedAt: new Date('2026-09-01'),
}
const TACKLE = {
  id: 'sp-ot',
  sport: 'NFL',
  source: 'rolling_insights',
  externalId: '9228',
  sleeperId: null,
  name: 'Michael Tarquin',
  position: 'OT',
  team: 'CAR',
  age: 23,
  status: 'IR',
  updatedAt: new Date('2026-09-20'),
}
// Sleeper's NBA ids are bare numbers too, and NBA rows carry no sleeperId.
const NBA_STRANGER = {
  id: 'sp-nba',
  sport: 'NBA',
  source: 'rolling_insights',
  externalId: '4017',
  sleeperId: null,
  name: 'Someone Else',
  position: 'C',
  team: 'BOS',
  age: 30,
  status: null,
  updatedAt: new Date('2026-09-20'),
}
const TSDB = {
  id: 'sp-tsdb',
  sport: 'NFL',
  source: 'thesportsdb',
  externalId: 'tsdb_34415964',
  sleeperId: null,
  name: 'Native Pick',
  position: 'WR',
  team: 'KC',
  age: 24,
  status: null,
  updatedAt: new Date('2026-09-20'),
}

const findManySportsPlayer = async ({ where }: { where: Record<string, unknown> }) => h.sportsPlayerRows(where)

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => h.sportsPlayerRows(where)),
    },
    playerGameStat: {
      findMany: vi.fn(async ({ where }: { where: { playerId: { in: string[] } } }) =>
        where.playerId.in.map((playerId) => ({
          playerId,
          fantasyPoints: 20,
        })),
      ),
    },
    leagueTeam: { findFirst: vi.fn(async () => ({ externalId: '461.l.1.t.4', teamName: 'Mine' })) },
  },
}))
vi.mock('@/lib/league-import/yahoo/YahooLeagueFetchService', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchYahooPendingTrades: vi.fn(async () => ({
    ok: true,
    trades: [
      {
        transactionId: 't1',
        type: 'pending_trade',
        status: 'proposed',
        createdAt: null,
        teamKeys: ['461.l.1.t.4', '461.l.1.t.7'],
        // A bare `player_id` fallback, the one form that could ever have matched a row: RI 9228's.
        adds: { '9228': '461.l.1.t.4' },
        drops: {},
        players: { '9228': { name: 'Bryce Young', position: 'QB', team: 'Car' } },
      },
    ],
  })),
}))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({
  getRosterTemplateForLeague: vi.fn(async () => ({
    slots: [{ slotName: 'QB', starterCount: 1, allowedPositions: ['QB'] }],
  })),
}))
vi.mock('@/lib/lineup-optimizer-engine/LineupOptimizerEngine', () => ({
  optimizeLineupDeterministic: vi.fn((input: { players: typeof h.optimizerPlayers }) => {
    h.optimizerPlayers = input.players
    return { starters: [], unfilledSlots: [], totalProjectedPoints: 0, deterministicNotes: [] }
  }),
}))

import { findSportsPlayersForLeague } from '@/lib/player-identity/findSportsPlayerByLeagueId'
import { selectBestBallLineupForRoster } from '@/lib/scoring/best-ball-engine'
import {
  generateAndPersistCanonicalNflProjections,
  getCanonicalNflPlayerContext,
} from '@/lib/nfl-data-foundation/nflDataFoundationService'
import { parseYahooTransactions } from '@/lib/league-import/yahoo/YahooLeagueFetchService'
import { scanPendingYahooTrades } from '@/lib/provider-trades/scanPendingYahooTrades'

beforeEach(() => {
  h.sportsPlayers = [BRYCE, TACKLE, NBA_STRANGER, TSDB]
  h.identities = []
  h.identityWheres = []
  h.optimizerPlayers = []
})

describe('findSportsPlayersForLeague — the platform decides the space', () => {
  it('a Sleeper league’s 9228 is Bryce Young, never the tackle — even though the tackle’s row is newer', async () => {
    const got = await findSportsPlayersForLeague('NFL', 'sleeper', ['9228'])
    expect(got.get('9228')?.name).toBe('Bryce Young')
  })

  it('a Sleeper NBA league’s bare id is never read as a Rolling Insights id', async () => {
    const got = await findSportsPlayersForLeague('NBA', 'sleeper', ['4017'])
    expect(got.has('4017')).toBe(false)
  })

  it('an untranslated ESPN or Yahoo roster names nobody rather than somebody wrong', async () => {
    expect((await findSportsPlayersForLeague('NFL', 'espn', ['9228'])).size).toBe(0)
    expect((await findSportsPlayersForLeague('NFL', 'yahoo', ['9228'])).size).toBe(0)
  })

  it('a native league resolves a bare NFL number as Sleeper and a self-describing token by its own row', async () => {
    const got = await findSportsPlayersForLeague('NFL', 'native', ['9228', 'tsdb_34415964'])
    expect(got.get('9228')?.name).toBe('Bryce Young')
    expect(got.get('tsdb_34415964')?.name).toBe('Native Pick')
  })
})

describe('best ball — the position that decides slot eligibility is the right player’s', () => {
  it('optimises 9228 as Bryce Young the QB, not an offensive tackle', async () => {
    await selectBestBallLineupForRoster({
      leagueId: 'l1',
      leagueSport: 'NFL' as never,
      season: 2026,
      weekOrRound: 4,
      rosterPlayerIds: ['9228'],
      platform: 'sleeper',
    })
    expect(h.optimizerPlayers).toEqual([
      expect.objectContaining({
        id: '9228',
        name: 'Bryce Young',
        positions: ['QB'],
      }),
    ])
  })
})

/** Every other delegate answers empty, so only the identity reads under test decide anything. */
function fakeDb() {
  const empty = new Proxy(
    {},
    {
      get: (_t, method: string) => async () =>
        String(method).startsWith('findMany') ? [] : String(method) === 'count' ? 0 : null,
    },
  )
  return new Proxy(
    {
      sportsPlayer: {
        findMany: findManySportsPlayer,
        findFirst: async () => null,
      },
      playerIdentityMap: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          h.identityWheres.push(where)
          return h.identities.find((r) => matches(r, where)) ?? null
        },
        findMany: async () => [],
      },
    } as Record<string, unknown>,
    { get: (t, key: string) => (key in t ? t[key] : empty) },
  ) as never
}

describe('NFL data foundation — each id asked only of its own column', () => {
  beforeEach(() => {
    h.identities = [
      {
        sport: 'NFL',
        sleeperId: '9228',
        rollingInsightsId: '55501',
        canonicalName: 'Bryce Young',
      },
      {
        sport: 'NFL',
        sleeperId: null,
        rollingInsightsId: '9228',
        canonicalName: 'Michael Tarquin',
      },
    ]
  })

  it('a league’s 9228 finds Bryce Young’s identity and row, not the tackle’s', async () => {
    const player = await getCanonicalNflPlayerContext('9228', {
      season: 2026,
      week: 4,
      prismaClient: fakeDb(),
    })
    expect(player?.playerName).toBe('Bryce Young')
    expect(h.identityWheres[0]).toEqual({ sport: 'NFL', sleeperId: '9228' })
  })

  it('the projection generator asks a Rolling Insights row’s identity by rollingInsightsId, never sleeperId', async () => {
    h.sportsPlayers = [TACKLE]
    await generateAndPersistCanonicalNflProjections({
      season: 2026,
      week: 4,
      write: false,
      prismaClient: fakeDb(),
    })
    expect(h.identityWheres).toContainEqual({
      sport: 'NFL',
      rollingInsightsId: '9228',
    })
    expect(h.identityWheres.some((w) => 'sleeperId' in w || 'OR' in w)).toBe(false)
  })
})

describe('Yahoo — a pending offer’s players are named by Yahoo’s own payload', () => {
  it('carries each moved player’s name, position and team through the parse', () => {
    const payload = {
      fantasy_content: {
        league: [
          { league_key: '461.l.1' },
          {
            transactions: {
              '0': {
                transaction: [
                  {
                    transaction_key: '461.l.1.pt.3',
                    type: 'pending_trade',
                    status: 'proposed',
                  },
                  {
                    players: {
                      '0': {
                        player: [
                          [
                            { player_key: '461.p.40001' },
                            { name: { full: 'Bryce Young' } },
                            { display_position: 'QB' },
                            { editorial_team_abbr: 'Car' },
                            {
                              transaction_data: {
                                type: 'pending_trade',
                                source_team_key: '461.l.1.t.4',
                                destination_team_key: '461.l.1.t.7',
                              },
                            },
                          ],
                        ],
                      },
                      count: 1,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
    }
    const [trade] = parseYahooTransactions(payload)
    expect(trade.adds).toEqual({ '461.p.40001': '461.l.1.t.7' })
    expect(trade.players).toEqual({
      '461.p.40001': { name: 'Bryce Young', position: 'QB', team: 'Car' },
    })
  })
})

describe('Yahoo scan — names come from the offer, never from SportsPlayer.externalId', () => {
  it('a bare Yahoo player_id is shown as the player Yahoo named, not RI’s player of that number', async () => {
    const scan = await scanPendingYahooTrades({ leagueId: 'l1', platformLeagueId: '461.l.1', userId: 'u1' })
    expect(scan.trades[0]?.assetsReceived).toEqual([
      { playerId: '9228', playerName: 'Bryce Young', position: 'QB', team: 'Car' },
    ])
  })
})
