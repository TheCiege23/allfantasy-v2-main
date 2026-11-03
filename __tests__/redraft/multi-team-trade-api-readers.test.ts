/**
 * Multi-team (3- and 4-team) native trades, as the trade feed, the one trade engine's loader and
 * trade discovery read them. Each multi-team case is paired with the two-team case it must leave
 * exactly as it was.
 *
 *   - app/api/league/trade-grades/route.ts  (?view=proposals, the Chimmy trades feed)
 *   - lib/decision-os/trade/loadTrade.ts     (refuses `multi_team`; every team is a party)
 *   - lib/trade-discovery/assembleRosters.ts (recent trade activity per team)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn() },
    redraftTradeProposal: { findMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 's1', sport: 'NFL' })) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    fantasyProjection: { findMany: vi.fn(async () => []) },
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: vi.fn() }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn() }))
vi.mock('@/lib/trade-intel/importedTradeLedgerService', () => ({ getImportedTradeLedger: vi.fn() }))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: vi.fn() }))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 6 })) }))
vi.mock('@/lib/idp-projections/leagueIdpVorp', () => ({ loadLeagueIdpVorp: vi.fn(async () => ({ valueBySleeperId: new Map() })) }))

import { GET } from '@/app/api/league/trade-grades/route'
import { loadTrade, type LoadTradeDeps } from '@/lib/decision-os/trade/loadTrade'
import { assembleDiscoveryLeague } from '@/lib/trade-discovery/assembleRosters'
import { MULTI_TEAM_GRADE_WITHHELD } from '@/lib/redraft/tradeParticipants'

const TEAMS = [
  { id: 'rA', teamName: 'Aces', ownerName: 'a', ownerId: 'uA' },
  { id: 'rB', teamName: 'Bees', ownerName: 'b', ownerId: 'uB' },
  { id: 'rC', teamName: 'Cats', ownerName: 'c', ownerId: 'uC' },
]
const roster = (id: string) => {
  const t = TEAMS.find((x) => x.id === id)!
  return { teamName: t.teamName, ownerName: t.ownerName, ownerId: t.ownerId }
}
const asset = (playerName: string, fromRosterId: string, toRosterId: string) =>
  ({ playerName, assetType: 'player', pickSeason: null, pickRound: null, fromRosterId, toRosterId })

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'uC' } })
  m.prisma.league.findFirst.mockResolvedValue({ id: 'L' })
  m.prisma.redraftRoster.findMany.mockImplementation(async (args: { where: { id?: { in: string[] }; ownerId?: string } }) => {
    if (args.where.ownerId) return TEAMS.filter((t) => t.ownerId === args.where.ownerId).map((t) => ({ id: t.id }))
    return TEAMS.filter((t) => args.where.id?.in.includes(t.id))
  })
})

describe('GET /api/league/trade-grades?view=proposals', () => {
  const request = () => new NextRequest('http://localhost/api/league/trade-grades?leagueId=L&view=proposals')

  it('a third team sees its private multi-team offer: every team, what each gives and gets, and not graded', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([{
      id: 'p3', status: 'pending', createdAt: new Date('2026-10-20T00:00:00Z'),
      proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC'],
      proposerRoster: roster('rA'), receiverRoster: roster('rB'),
      assets: [asset('Ann', 'rA', 'rB'), asset('Bo', 'rB', 'rC'), asset('Cy', 'rC', 'rA')],
      valueSnapshot: null,
    }])
    const data = await (await GET(request())).json()
    expect(m.prisma.redraftTradeProposal.findMany.mock.calls[0]![0].where.OR).toContainEqual({ additionalRosterIds: { hasSome: ['rC'] } })
    expect(data.proposals[0]).toEqual({
      id: 'p3', status: 'pending', createdAt: '2026-10-20T00:00:00.000Z',
      title: 'Aces, Bees and Cats (3-team trade)',
      involvesYou: true,
      assets: ['Aces gets Cy', 'Bees gets Ann', 'Cats gets Bo'],
      grade: null,
      explanation: MULTI_TEAM_GRADE_WITHHELD,
      multiTeam: true,
      teams: [
        { rosterId: 'rA', name: 'Aces', gives: ['Ann'], gets: ['Cy'] },
        { rosterId: 'rB', name: 'Bees', gives: ['Bo'], gets: ['Ann'] },
        { rosterId: 'rC', name: 'Cats', gives: ['Cy'], gets: ['Bo'] },
      ],
    })
  })

  it('a multi-team trade with a fairness snapshot on it is still not graded', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([{
      id: 'p3', status: 'accepted', createdAt: new Date('2026-10-20T00:00:00Z'),
      proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC'],
      proposerRoster: roster('rA'), receiverRoster: roster('rB'),
      assets: [asset('Ann', 'rA', 'rB'), asset('Bo', 'rB', 'rC'), asset('Cy', 'rC', 'rA')],
      valueSnapshot: { grade: 'A', confidenceScore: 90, payload: { grade: { insufficientData: false, bullets: ['x'] } } },
    }])
    const data = await (await GET(request())).json()
    expect(data.proposals[0]).toMatchObject({ grade: null, explanation: MULTI_TEAM_GRADE_WITHHELD })
  })

  it('two teams: exactly the old shape and copy, with no multi-team keys', async () => {
    m.session.mockResolvedValue({ user: { id: 'uA' } })
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([{
      id: 'p2', status: 'pending', createdAt: new Date('2026-10-20T00:00:00Z'),
      proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: [],
      proposerRoster: roster('rA'), receiverRoster: roster('rB'),
      assets: [asset('Ann', 'rA', 'rB'), { playerName: null, assetType: 'draft_pick', pickSeason: 2027, pickRound: 2, fromRosterId: 'rB', toRosterId: 'rA' }],
      valueSnapshot: { grade: 'B+', confidenceScore: 80, payload: { grade: { insufficientData: false, bullets: ['Fair.', 'Close.'] } } },
    }])
    const data = await (await GET(request())).json()
    expect(data.proposals[0]).toEqual({
      id: 'p2', status: 'pending', createdAt: '2026-10-20T00:00:00.000Z',
      title: 'Aces → Bees',
      involvesYou: true,
      assets: ['Ann', '2027 round 2 pick'],
      grade: 'B+',
      explanation: 'Fair. Close.',
    })
    // Only multi-team rows need the extra teams' names.
    expect(m.prisma.redraftRoster.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('loadTrade — a native multi-team proposal', () => {
  const LEAGUE = { id: 'L', platform: 'manual', platformLeagueId: '', sport: 'NFL', season: 2026, lastSyncedAt: null, name: 'N' }
  const row = (extra: string[], assets: Array<{ from: string; to: string }>) => ({
    id: 'P', leagueId: 'L', status: 'pending', proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: extra,
    createdAt: new Date('2026-10-20T00:00:00Z'), processedAt: null, expiresAt: new Date('2099-01-01T00:00:00Z'),
    assets: assets.map((a) => ({ assetType: 'faab', playerId: null, playerName: null, pickSeason: null, pickRound: null, fromRosterId: a.from, toRosterId: a.to, metadata: { amount: 5 } })),
  })
  const deps = (r: ReturnType<typeof row>, redraftRosterId: string): Partial<LoadTradeDeps> => ({
    now: () => new Date('2026-10-21T00:00:00Z'),
    isMember: async () => true,
    isCommissioner: async () => false,
    viewerIdentity: async () => ({ rosterId: null, redraftRosterId, externalTeamIds: [] }),
    loadLeague: async () => LEAGUE,
    loadRedraftProposal: async () => r as never,
    rostersForRedraft: async () => new Map(),
    resolvePlayers: async () => new Map(),
  })
  const ref = { leagueId: 'L', ref: { kind: 'redraft' as const, proposalId: 'P' }, userId: 'u' }

  it('is refused as multi-team, from the row itself, and its third team is a party (not "private")', async () => {
    // Every asset moves between A and B; only the row says C is in it.
    const r = await loadTrade(ref, deps(row(['rC'], [{ from: 'rA', to: 'rB' }, { from: 'rB', to: 'rA' }]), 'rC'))
    expect(r).toMatchObject({ ok: false, refusal: { code: 'multi_team', reason: 'This is a 3-team trade; trades are graded between two teams.' } })
  })

  it('two teams: loads as before', async () => {
    const r = await loadTrade(ref, deps(row([], [{ from: 'rA', to: 'rB' }, { from: 'rB', to: 'rA' }]), 'rA'))
    expect(r).toMatchObject({ ok: true, viewer: { side: 'A' }, trade: { sideA: { teamId: 'rA' }, sideB: { teamId: 'rB' } } })
  })
})

describe('assembleDiscoveryLeague — recent trade activity', () => {
  beforeEach(() => {
    m.prisma.league.findUnique.mockResolvedValue({ draftPickTrading: false, settings: {}, leagueType: 'redraft', platform: 'allfantasy' })
    m.prisma.redraftRoster.findMany.mockResolvedValue(
      TEAMS.map((t) => ({ id: t.id, ownerId: t.ownerId, ownerName: t.ownerName, teamName: t.teamName, wins: 0, losses: 0, ties: 0, pointsFor: 0, playoffSeed: null, faabBalance: 100, players: [] })),
    )
  })
  const counts = async () => Object.fromEntries((await assembleDiscoveryLeague('L'))!.rosters.map((r) => [r.rosterId, r.recentTradeCount]))

  it('counts every team of a multi-team trade', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([{ proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC'] }])
    expect(await counts()).toEqual({ rA: 1, rB: 1, rC: 1 })
  })

  it('two teams: proposer and receiver, as before', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([{ proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: [] }])
    expect(await counts()).toEqual({ rA: 1, rB: 1, rC: 0 })
  })
})
