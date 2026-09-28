/**
 * `loadTrade()` — an existing trade from `AfLeagueTrade`, `RedraftTradeProposal` or the Sleeper
 * `ProviderTradeOffer` ledger, normalized; membership and pending-offer privacy enforced BEFORE any
 * asset is read.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { loadTrade, type LoadTradeDeps } from '@/lib/decision-os/trade/loadTrade'
import type { ResolvedTradePlayer } from '@/lib/decision-os/trade/tradePlayers'

const NOW = new Date('2026-09-27T12:00:00Z')

const LEAGUE = {
  id: 'L1', platform: 'manual', platformLeagueId: '', sport: 'NFL', season: 2026, lastSyncedAt: null, name: 'Native League',
}
const SLEEPER_LEAGUE = {
  ...LEAGUE, platform: 'sleeper', platformLeagueId: '1180', lastSyncedAt: new Date('2026-09-27T11:55:00Z'), name: 'Dynasty',
}

const afRow = (over: Record<string, unknown> = {}) => ({
  id: 'T1', leagueId: 'L1', status: 'pending', proposerRosterId: 'r1', receiverRosterId: 'r2',
  createdAt: new Date('2026-09-26T10:00:00Z'), processedAt: null, expiresAt: new Date('2026-09-30T00:00:00Z'), metadata: {},
  items: [
    { itemType: 'player', itemReference: '4984', fromRosterId: 'r1', toRosterId: 'r2', faabAmount: null, metadata: null },
    { itemType: 'future_pick', itemReference: 'fdp:2027:1:r2', fromRosterId: 'r2', toRosterId: 'r1', faabAmount: null, metadata: {} },
  ],
  ...over,
})

const named = (m: Record<string, string>) => async (ids: readonly string[]) =>
  new Map<string, ResolvedTradePlayer>(ids.map((id) => [id, m[id] ? { ok: true, name: m[id]!, position: null } : { ok: false, why: 'unresolved' }]))

const deps = (over: Partial<LoadTradeDeps> = {}): Partial<LoadTradeDeps> => ({
  now: () => NOW,
  isMember: async () => true,
  isCommissioner: async () => false,
  viewerIdentity: async () => ({ rosterId: 'r1', redraftRosterId: null, externalTeamIds: [] }),
  loadLeague: async () => LEAGUE,
  loadAfTrade: async () => afRow(),
  loadRedraftProposal: async () => null,
  loadProviderOffer: async () => null,
  rostersForRedraft: async () => new Map(),
  resolvePlayers: vi.fn(named({ '4984': 'Josh Allen' })),
  ...over,
})

const AF = { leagueId: 'L1', ref: { kind: 'af' as const, tradeId: 'T1' }, userId: 'u1' }

describe('loadTrade — AfLeagueTrade', () => {
  it('normalizes a native trade: sides, resolved player, pick, status, native freshness', async () => {
    const r = await loadTrade(AF, deps())
    expect(r).toEqual({
      ok: true,
      viewer: { side: 'A', isCommissioner: false },
      trade: {
        id: 'T1', leagueId: 'L1', sport: 'NFL', status: 'proposed',
        origin: { source: 'af', platform: 'native', externalLeagueId: null, externalTradeId: null, deepLink: null, rostersSyncedAt: NOW.toISOString(), rawStatus: 'pending' },
        sideA: { teamId: 'r1', rosterId: 'r1', gives: [{ kind: 'player', playerId: '4984', name: 'Josh Allen', position: null }] },
        sideB: { teamId: 'r2', rosterId: 'r2', gives: [{ kind: 'pick', season: 2027, round: 1, originalTeamId: 'r2', label: '2027 1st' }] },
        proposedAt: '2026-09-26T10:00:00.000Z',
        completedAt: null,
      },
    })
  })

  it('a player who does not resolve to exactly one refuses — naming him', async () => {
    const r = await loadTrade(AF, deps({ resolvePlayers: named({}) }))
    expect(r).toMatchObject({ ok: false, refusal: { code: 'unresolved_player', missingAssets: ['player 4984 (no player found)'] } })
  })

  it('an expired-but-still-pending row loads as expired', async () => {
    const r = await loadTrade(AF, deps({ loadAfTrade: async () => afRow({ expiresAt: new Date('2026-09-26T00:00:00Z') }) }))
    expect(r).toMatchObject({ ok: true, trade: { status: 'expired', origin: { rawStatus: 'pending' } } })
  })
})

describe('loadTrade — membership and privacy', () => {
  it('a non-member is refused before anything is read', async () => {
    const d = deps({ isMember: async () => false, loadLeague: vi.fn(async () => LEAGUE) })
    expect(await loadTrade(AF, d)).toMatchObject({ ok: false, refusal: { code: 'not_member' } })
    expect(d.loadLeague).not.toHaveBeenCalled()
  })

  /*
   * 🛑 THE LEAK THIS GATE EXISTS FOR. Every later refusal names assets; an outsider asking about someone
   * else's pending offer must learn nothing about what was offered — not even through a refusal.
   */
  it('a PENDING offer between other managers is refused before any asset is resolved or named', async () => {
    const resolvePlayers = vi.fn(named({}))
    const r = await loadTrade(AF, deps({ viewerIdentity: async () => ({ rosterId: 'r7', redraftRosterId: null, externalTeamIds: [] }), resolvePlayers }))
    expect(r).toMatchObject({ ok: false, refusal: { code: 'not_party', missingAssets: [] } })
    expect(resolvePlayers).not.toHaveBeenCalled()
    expect(JSON.stringify(r)).not.toContain('4984')
  })

  it('…but the commissioner may load it, and a SETTLED trade is league history anyone in it may read', async () => {
    const outsider = async () => ({ rosterId: 'r7', redraftRosterId: null, externalTeamIds: [] })
    expect(await loadTrade(AF, deps({ viewerIdentity: outsider, isCommissioner: async () => true }))).toMatchObject({ ok: true, viewer: { side: null, isCommissioner: true } })
    expect(await loadTrade(AF, deps({ viewerIdentity: outsider, loadAfTrade: async () => afRow({ status: 'processed', processedAt: new Date() }) }))).toMatchObject({ ok: true, trade: { status: 'completed' }, viewer: { side: null } })
  })

  it('the receiving manager is side B', async () => {
    const r = await loadTrade(AF, deps({ viewerIdentity: async () => ({ rosterId: 'r2', redraftRosterId: null, externalTeamIds: [] }) }))
    expect(r).toMatchObject({ ok: true, viewer: { side: 'B' } })
  })
})

describe('loadTrade — RedraftTradeProposal', () => {
  const proposal = {
    id: 'P1', leagueId: 'L1', status: 'pending', proposerRosterId: 'rr1', receiverRosterId: 'rr2',
    createdAt: new Date('2026-09-26T10:00:00Z'), processedAt: null, expiresAt: null,
    assets: [
      { assetType: 'player', playerId: '4984', playerName: 'Josh Allen', pickSeason: null, pickRound: null, fromRosterId: 'rr1', toRosterId: 'rr2', metadata: {} },
      { assetType: 'faab', playerId: null, playerName: null, pickSeason: null, pickRound: null, fromRosterId: 'rr2', toRosterId: 'rr1', metadata: { amount: 15 } },
    ],
  }

  it('maps RedraftRoster ids onto Roster ids where linked, and leaves the rest null (graded by name, no lineup)', async () => {
    const r = await loadTrade(
      { leagueId: 'L1', ref: { kind: 'redraft', proposalId: 'P1' }, userId: 'u1' },
      deps({
        viewerIdentity: async () => ({ rosterId: 'r1', redraftRosterId: 'rr1', externalTeamIds: [] }),
        loadRedraftProposal: async () => proposal,
        rostersForRedraft: async () => new Map([['rr1', 'r1']]),
      }),
    )
    expect(r).toMatchObject({
      ok: true,
      viewer: { side: 'A' },
      trade: {
        origin: { source: 'redraft' },
        sideA: { teamId: 'rr1', rosterId: 'r1', gives: [{ kind: 'player', name: 'Josh Allen' }] },
        sideB: { teamId: 'rr2', rosterId: null, gives: [{ kind: 'faab', amount: 15 }] },
      },
    })
  })
})

describe('loadTrade — the Sleeper ledger', () => {
  const offer = {
    id: 'O1', leagueId: 'L1', provider: 'sleeper', providerTradeId: '99887766', status: 'pending', proposedByRosterId: null,
    rosterIds: ['3', '7'], proposedAt: new Date('2026-09-27T09:00:00Z'), respondedAt: null,
    firstSeenAt: new Date('2026-09-27T09:30:00Z'), lastSeenAt: new Date('2026-09-27T11:40:00Z'),
    assets: [
      { assetType: 'player', playerId: '4984', pickSeason: null, pickRound: null, pickOriginalRosterId: null, faabAmount: null, fromRosterId: '3', toRosterId: '7' },
      { assetType: 'pick', playerId: null, pickSeason: 2027, pickRound: 2, pickOriginalRosterId: '7', faabAmount: null, fromRosterId: '7', toRosterId: '3' },
    ],
  }
  const run = (over: Partial<LoadTradeDeps> = {}) =>
    loadTrade(
      { leagueId: 'L1', ref: { kind: 'provider', provider: 'sleeper', providerTradeId: '99887766' }, userId: 'u1' },
      deps({
        loadLeague: async () => SLEEPER_LEAGUE,
        loadProviderOffer: async () => offer,
        viewerIdentity: async () => ({ rosterId: 'r1', redraftRosterId: null, externalTeamIds: ['03', '3'] }),
        ...over,
      }),
    )

  it('reads the stored offer, links to the platform, and resolves Sleeper ids', async () => {
    const r = await run()
    expect(r).toMatchObject({
      ok: true,
      viewer: { side: 'A' },
      trade: {
        status: 'proposed',
        origin: { source: 'provider', platform: 'sleeper', externalLeagueId: '1180', externalTradeId: '99887766', deepLink: expect.stringContaining('sleeper.com/leagues/1180') },
        sideA: { teamId: '3', rosterId: null, gives: [{ kind: 'player', name: 'Josh Allen' }] },
        sideB: { teamId: '7', gives: [{ kind: 'pick', season: 2027, round: 2, originalTeamId: '7' }] },
      },
    })
  })

  it('freshness is the OLDER of the league sync and the ledger’s last sighting', async () => {
    const r = await run()
    expect(r.ok && r.trade.origin.rostersSyncedAt).toBe('2026-09-27T11:40:00.000Z')
  })

  it('a pending Sleeper offer is private to its two rosters too', async () => {
    const r = await run({ viewerIdentity: async () => ({ rosterId: 'r1', redraftRosterId: null, externalTeamIds: ['9'] }) })
    expect(r).toMatchObject({ ok: false, refusal: { code: 'not_party' } })
  })
})
