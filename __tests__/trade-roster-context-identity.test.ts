import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  teams: [
    { externalId: '1', platformUserId: 'sleeper-me', claimedByUserId: 'account-me', teamName: 'Me', ownerName: 'Me' },
    { externalId: '2', platformUserId: 'sleeper-other', claimedByUserId: null, teamName: 'Other', ownerName: 'Other' },
  ],
  mine: ['p1'] as string[],
  claimed: true,
  rosterOwner: 'sleeper-me',
  picks: [] as Array<{ season: number; round: number; originalTeamId: string; ownerTeamId: string; source: 'stored' }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findFirst: async () => ({ id: 'L', sport: 'NFL', starters: ['QB', 'RB'] }) },
  leagueTeam: { findMany: async () => h.teams, findFirst: async ({ where }: { where: { platformUserId?: string } }) =>
    where.platformUserId ? h.teams.find(t => t.platformUserId === where.platformUserId) : h.claimed ? h.teams[0] : null },
  userProfile: { findUnique: async () => ({ sleeperUserId: 'sleeper-me' }) },
  roster: { findMany: async () => [
    { id: 'my-roster', platformUserId: h.rosterOwner, playerData: { players: h.mine, draftPicks: [{ year: 2026, round: 1, playerId: 'drafted-player' }] }, faabRemaining: 20 },
    { platformUserId: 'sleeper-other', playerData: { players: ['p2'] }, faabRemaining: 20 },
  ], findFirst: async ({ where, orderBy }: { where: { platformUserId: { in: string[] } }; orderBy: unknown }) => {
    expect(orderBy).toEqual({ updatedAt: 'desc' })
    return where.platformUserId.in.includes(h.rosterOwner) ? { id: 'my-roster', playerData: { players: h.mine } } : null
  } },
} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: async () => ({ ok: true }) }))
vi.mock('@/lib/data/players', () => ({ getPlayer: async () => null }))
vi.mock('@/lib/sleeper-client', () => ({ getAllPlayers: async () => Object.fromEntries(
  [...h.mine, 'p2'].map(id => [id, { full_name: `Player ${id}` }]),
) }))
vi.mock('@/lib/league-trade-engine/importedFuturePicks', () => ({ loadImportedFuturePicks: async () => ({
  picksByRosterId: new Map([['my-roster', h.picks]]), readFailed: false,
}) }))
vi.mock('@/lib/league-trade-engine/nativeFuturePicks', () => ({ isNativeFuturePickLeague: () => false, loadNativeFuturePicks: vi.fn() }))
vi.mock('@/lib/hybrid-valuation', () => ({ pricePick: async () => ({ name: '2027 Round 2', assetValue: { marketValue: 700 } }), pricePlayer: async (name: string) => ({
  name, type: 'player', value: 100, source: 'fantasycalc', position: 'QB',
  assetValue: { marketValue: 100, impactValue: 80, vorpValue: 20, volatility: 0.1 },
}) }))

import { loadTradeEngineRosterContext } from '@/lib/trade-value-console/roster-context-loader'
const load = (opponentTeamExternalId?: string) => loadTradeEngineRosterContext({ leagueId: 'L', userId: 'account-me',
  opponentTeamExternalId, effectiveSport: 'NFL', nflCtx: { asOfDate: new Date(), isSuperFlex: false }, dataGaps: [] })
beforeEach(() => { h.mine = ['p1']; h.picks = []; h.claimed = true; h.rosterOwner = 'sleeper-me' })

it('resolves an unclaimed linked team whose bootstrap roster carries the app ID', async () => {
  h.claimed = false
  h.rosterOwner = 'account-me'
  const context = await load('2')
  expect(context.rosterCtx?.yourRoster[0].rosterPlayerId).toBe('p1')
  expect(context.rosterCtx?.theirRoster[0].rosterPlayerId).toBe('p2')
})

it('resolves app identity to provider identity and preserves the actual player IDs', async () => {
  const context = await load('2')
  expect(context.rosterCtx?.yourRoster[0]).toMatchObject({ id: 'Player p1', rosterPlayerId: 'p1' })
  expect(context.rosterCtx?.theirRoster[0]).toMatchObject({ rosterPlayerId: 'p2' })
})
it('does not substitute another manager when a counterparty is missing, stale, or your own team', async () => {
  for (const selection of [undefined, 'stale', '1']) {
    expect((await load(selection)).rosterCtx?.theirRoster).toEqual([])
  }
})
it('includes deep IDP rosters beyond 45 players', async () => {
  h.mine = Array.from({ length: 60 }, (_, i) => `p${i + 10}`)
  expect((await load('2')).yourAssetCount).toBe(60)
})
it('uses owned future-pick inventory and never treats drafted players as future picks', async () => {
  expect((await load('2')).availablePicks).toEqual([])
  h.picks = [{ season: 2027, round: 2, originalTeamId: '2', ownerTeamId: '1', source: 'stored' }]
  expect((await load('2')).availablePicks).toEqual([{ id: 'fdp:2027:2:2', displayName: '2027 Round 2', round: 2, season: 2027, value: 700 }])
})
