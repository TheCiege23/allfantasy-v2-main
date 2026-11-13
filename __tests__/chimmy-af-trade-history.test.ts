/**
 * Chimmy's trade history read only Sleeper-ingested `LeagueTrade` rows and answered every other league
 * "Completed-trade history is only synced for Sleeper leagues" — native AllFantasy leagues included,
 * whose trades are real and sit in `AfLeagueTrade`. Found by the dynasty and Fantrax-scale simulations
 * (2026-11-07): five processed trades, and the history tool saw none.
 *
 * An imported league's AllFantasy trades are SHADOW trades (the provider's rosters change only if the
 * managers also make the trade there), so they are listed under their own heading, never as history.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: null as null | { platform: string; platformLeagueId: string | null; sport: string; season: number },
  trades: [] as Array<{ id: string; status: string; processedAt: Date | null; proposerRosterId: string; receiverRosterId: string; items: unknown[] }>,
  rosters: [] as Array<{ id: string; platformUserId: string; redraftRoster: { teamName: string | null; ownerName: string | null } | null }>,
  identities: [] as Array<{ fantraxId: string; canonicalName: string; position: string; sport: string; sleeperId: string | null }>,
  sportsPlayers: [] as Array<{ sleeperId: string; externalId: string; name: string; position: string }>,
  afReads: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => db.league), findMany: vi.fn(async () => []) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    leagueTradeHistory: { findMany: vi.fn(async () => []) },
    leagueTrade: { findMany: vi.fn(async () => []) },
    afLeagueTrade: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string; status: string } }) => {
        db.afReads += 1
        return db.trades.filter((t) => t.status === where.status)
      }),
    },
    roster: { findMany: vi.fn(async () => db.rosters) },
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: { fantraxId?: { in: string[] }; sport: string } }) =>
        db.identities
          .filter((r) => r.sport === where.sport && where.fantraxId?.in.includes(r.fantraxId))
          .map((r) => ({ ...r, currentTeam: null, espnId: null, fleaflickerId: null, mflId: null }))),
    },
    sportsPlayer: { findMany: vi.fn(async () => db.sportsPlayers.map((p) => ({ ...p, imageUrl: null, team: null }))) },
  },
}))

import { buildLeagueTradeHistoryOutcome } from '@/lib/chimmy-trade/leagueTradeHistoryGrounding'

const playerItem = (ref: string, from: string, to: string, metadata: Record<string, unknown> = {}) => ({ itemType: 'player', itemReference: ref, fromRosterId: from, toRosterId: to, faabAmount: null, metadata })

beforeEach(() => {
  db.afReads = 0
  db.rosters = [
    { id: 'r-a', platformUserId: 'u-a', redraftRoster: { teamName: 'Gridiron Gang', ownerName: 'alex' } },
    { id: 'r-b', platformUserId: 'u-b', redraftRoster: { teamName: 'Blitz', ownerName: 'blake' } },
  ]
  db.trades = [
    {
      id: 't1', status: 'processed', processedAt: new Date('2026-10-12T15:00:00Z'), proposerRosterId: 'r-a', receiverRosterId: 'r-b',
      items: [
        playerItem('6794', 'r-b', 'r-a'),
        playerItem('4034', 'r-a', 'r-b'),
        { itemType: 'future_pick', itemReference: 'fdp:2027:1:r-a', fromRosterId: 'r-a', toRosterId: 'r-b', faabAmount: null, metadata: {} },
      ],
    },
    { id: 't2', status: 'rejected', processedAt: null, proposerRosterId: 'r-b', receiverRosterId: 'r-a', items: [playerItem('6794', 'r-a', 'r-b')] },
  ]
  db.identities = []
  db.sportsPlayers = [
    { sleeperId: '6794', externalId: 'sleeper:6794', name: 'Justin Jefferson', position: 'WR' },
    { sleeperId: '4034', externalId: 'sleeper:4034', name: 'Christian McCaffrey', position: 'RB' },
  ]
})

describe('a native league: its AllFantasy trades ARE its history', () => {
  beforeEach(() => {
    db.league = { platform: 'manual', platformLeagueId: null, sport: 'NFL', season: 2026 }
  })

  it('lists each processed trade with both teams, the players and the pick', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u-a')
    expect(out.kind, JSON.stringify(out)).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.uniqueTrades).toBe(1)
    expect(out.text).toContain('COMPLETED TRADE HISTORY for this league')
    expect(out.text).toContain('Gridiron Gang (alex) got [Justin Jefferson] from Blitz (blake) for [Christian McCaffrey, 2027 round 1 pick]')
    expect(out.text).not.toMatch(/shadow/i)
  })

  it('leaves out offers that were never processed, and honours a manager filter', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u-a', { manager: 'nobody-here' })
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') expect(out.text).toContain('No trade matches that filter.')
    const all = await buildLeagueTradeHistoryOutcome('lg', 'u-a', { manager: 'blitz' })
    if (all.kind === 'ok') expect(all.text.match(/^- /gm)?.length).toBe(1)
  })
})

describe('an imported Fantrax league: shadow trades, labelled as such', () => {
  beforeEach(() => {
    db.league = { platform: 'fantrax', platformLeagueId: 'fx-123', sport: 'NFL', season: 2026 }
    db.trades[0]!.items = [
      playerItem('n0006j', 'r-b', 'r-a', { playerName: 'Jefferson, Justin' }),
      playerItem('n00xyz', 'r-a', 'r-b', { playerName: 'Nacua, Puka' }),
    ]
    db.identities = [{ fantraxId: 'n0006j', canonicalName: 'Justin Jefferson', position: 'WR', sport: 'NFL', sleeperId: '6794' }]
  })

  it('names players through the identity map, and never calls them Fantrax trades', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u-a')
    expect(out.kind, JSON.stringify(out)).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.text).toContain('TRADES RECORDED IN ALLFANTASY')
    expect(out.text).toMatch(/shadow trades/i)
    expect(out.text).toContain('NOT its Fantrax trade history')
    // Linked by Fantrax id; the unlinked one keeps the name Fantrax gave it.
    expect(out.text).toContain('got [Justin Jefferson] from Blitz (blake) for [Nacua, Puka]')
    expect(out.text).not.toContain('COMPLETED TRADE HISTORY')
  })

  it('still says history is not synced when nothing was traded here', async () => {
    db.trades = []
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u-a')
    expect(out).toEqual({ kind: 'not-sleeper', platform: 'fantrax' })
  })
})

describe('a Sleeper league is unchanged', () => {
  it('reads only its synced history, never the AllFantasy table', async () => {
    db.league = { platform: 'sleeper', platformLeagueId: '1234567890', sport: 'NFL', season: 2026 }
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u-a')
    expect(out.kind).toBe('no-history-rows')
    expect(db.afReads).toBe(0)
  })
})
