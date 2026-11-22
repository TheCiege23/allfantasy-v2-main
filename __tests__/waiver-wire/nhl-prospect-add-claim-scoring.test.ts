// @vitest-environment node
/**
 * A prospect through the real add / drop and claim routes and the real eligibility gate, into the
 * `RedraftRosterPlayer` row native scoring reads — and from there through the #3051 game-log bridge:
 * zero until the weekly link attaches him, his identity's games after.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prospectDb } from './nhl-prospect-fixture'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  league: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  rrpCreate: vi.fn(),
  txnCreate: vi.fn(),
  db: null as null | ReturnType<typeof import('./nhl-prospect-fixture').prospectDb>,
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: async () => null }))
vi.mock('@/lib/prisma', () => {
  const client: Record<string, unknown> = {
    league: { findFirst: h.league, findUnique: h.league },
    roster: { findFirst: h.rosterFindFirst, findMany: h.rosterFindMany, update: vi.fn(async () => ({})) },
    leagueWaiverSettings: { findUnique: async () => ({}) },
    sportsDataCache: { findUnique: (a: never) => h.db!.sportsDataCache.findUnique(a) },
    playerIdentityMap: { findMany: (a: never) => h.db!.playerIdentityMap.findMany(a) },
    sportsPlayer: { findFirst: vi.fn(async () => null) },
    redraftSeason: { findFirst: vi.fn(async () => null) },
    redraftRoster: { findMany: vi.fn(async () => []) },
    redraftRosterPlayer: { findFirst: vi.fn(async () => null), create: h.rrpCreate, updateMany: vi.fn(async () => ({})) },
    waiverTransaction: { create: h.txnCreate },
    waiverClaim: { findFirst: vi.fn(async () => null) },
  }
  client.$transaction = async (cb: (tx: unknown) => unknown) => cb(client)
  return { prisma: client }
})
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: vi.fn(async () => []) }))
vi.mock('@/lib/player-identity/findSportsPlayerByLeagueId', () => ({ findSportsPlayerByLeagueId: vi.fn(async () => null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ waiverType: 'rolling', normalizedWaiverType: 'rolling' }),
}))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({ evaluateLegalityForProjectedRoster: async () => null }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ computePerPlayerKickoffLocks: () => ({ lockedPlayerIds: [] }) }))
vi.mock('@/lib/survivor/survivorStealThreeWaivers', () => ({ assertStealThreeWaiverHoldCleared: async () => undefined }))
// Route gates, all open: the subject here is the player id, not the league's phase or locks.
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({ loadWaiverPhasePolicy: async () => ({ immediateAddsAllowed: true, firstComeAdds: true }) }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: async () => ({ ok: true }) }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: async () => ({ ok: true }) }))
vi.mock('@/server/services/auditService', () => ({ logAction: async () => undefined }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
vi.mock('@/lib/league/write-authority-server', () => ({ resolveWriteAuthorityEnvelope: async () => null }))
vi.mock('@/lib/ai/action-validation', () => ({ validateAiActionExecution: () => ({ ok: true }) }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))
vi.mock('@/lib/league-notifications/realtimeHint', () => ({ publishLeagueRealtimeHint: () => undefined }))
// The claims route's service layer: createClaim runs the REAL eligibility gate, as claim-service does.
vi.mock('@/lib/waiver-wire', async () => {
  const { assertWaiverClaimEligibility } = await import('@/lib/waiver-wire/transaction-eligibility')
  return {
    getEffectiveLeagueWaiverSettings: async () => ({ normalizedWaiverType: 'rolling' }),
    getClaimsByRoster: async () => [],
    getPendingClaims: async () => [],
    getProcessedClaimsAndTransactions: async () => ({ claims: [], transactions: [] }),
    createClaim: async (leagueId: string, rosterId: string, input: { addPlayerId: string; faabBid?: number | null }) => {
      await assertWaiverClaimEligibility({ leagueId, rosterId, addPlayerId: input.addPlayerId, faabBid: input.faabBid ?? null })
      return { id: 'claim-1', addPlayerId: input.addPlayerId, status: 'pending' }
    },
  }
})

import { planRedraftRosterMoveWrites } from '@/lib/league-runtime/redraftRosterMoveSync'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { prisma } from '@/lib/prisma'

const NHL_DYNASTY = {
  id: 'L1', sport: 'NHL', userId: 'u1', isDynasty: true, leagueType: 'dynasty', leagueVariant: null, platform: 'allfantasy',
  rosterSize: 10, lockAllMoves: false, lifecycleState: 'in_season', settings: {}, season: 2026,
}

async function post(kind: 'add-drop' | 'claims', addPlayerId: string) {
  const mod = kind === 'add-drop'
    ? await import('@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route')
    : await import('@/app/api/waiver-wire/leagues/[leagueId]/claims/route')
  const res = await mod.POST({ json: async () => ({ addPlayerId }) } as never, { params: Promise.resolve({ leagueId: 'L1' }) })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.db = prospectDb()
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.league.mockResolvedValue(NHL_DYNASTY)
  h.rosterFindFirst.mockResolvedValue({ id: 'r1', platformUserId: 'u1', playerData: { players: [] }, faabRemaining: 100 })
  h.rosterFindMany.mockImplementation(async (args: { select?: { redraftRosterId?: boolean } }) =>
    args?.select?.redraftRosterId
      ? [{ id: 'r1', redraftRosterId: 'rd1' }]
      : [{ id: 'r1', playerData: { players: [] } }, { id: 'r2', playerData: { players: ['fantrax:04abc'] } }],
  )
  h.rrpCreate.mockImplementation(async (args: unknown) => args)
  h.txnCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 't1', ...data, faabSpent: null, processedAt: new Date() }))
})

describe('add / drop route', () => {
  it('adds a real prospect by fantrax:<id> and writes his scoring row with his Fantrax name, position and club', async () => {
    const { status, body } = await post('add-drop', 'fantrax:04qyh')
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, rosterPlayerIds: ['fantrax:04qyh'] })
    expect(h.rrpCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ rosterId: 'rd1', playerId: 'fantrax:04qyh', playerName: 'Tyler Madden', position: 'RW', team: 'MIN', sport: 'NHL', acquisitionType: 'free_agent' }),
    })
  })

  it.each(['fantrax:made-up', 'fantrax:04lnk'])('refuses %s as PLAYER_UNAVAILABLE and writes nothing', async (id) => {
    const { status, body } = await post('add-drop', id)
    expect(status).toBe(400)
    expect(body.code).toBe('PLAYER_UNAVAILABLE')
    expect(h.txnCreate).not.toHaveBeenCalled()
  })

  it('refuses a prospect id in another sport', async () => {
    h.league.mockResolvedValue({ ...NHL_DYNASTY, sport: 'MLB' })
    const { status, body } = await post('add-drop', 'fantrax:04qyh')
    expect(status).toBe(400)
    expect(body.code).toBe('PLAYER_UNAVAILABLE')
  })
})

describe('claims route', () => {
  it('accepts a claim for a real prospect', async () => {
    const { status, body } = await post('claims', 'fantrax:04qyh')
    expect(status).toBe(200)
    expect(body.claim).toMatchObject({ addPlayerId: 'fantrax:04qyh' })
  })

  it.each([
    ['a made-up id', NHL_DYNASTY, 'fantrax:nope'],
    ['an NHL redraft league', { ...NHL_DYNASTY, isDynasty: false, leagueType: 'redraft' }, 'fantrax:04qyh'],
    ['an NFL dynasty league', { ...NHL_DYNASTY, sport: 'NFL' }, 'fantrax:04qyh'],
  ])('refuses %s with a 400, never a 500', async (_label, league, id) => {
    h.league.mockResolvedValue(league)
    const { status, body } = await post('claims', id)
    expect(status).toBe(400)
    expect(body.code).toBe('PLAYER_UNAVAILABLE')
  })
})

describe('scoring through the claim award', () => {
  it('an awarded prospect scores zero until bridged, then his identity\'s games', async () => {
    // The award: the same write the waiver processor plans for a won claim.
    await planRedraftRosterMoveWrites(prisma as never, {
      leagueId: 'L1',
      acquisitionType: 'waiver',
      moves: [{ playerId: 'fantrax:04qyh', fromRosterId: null, toRosterId: 'r1' }],
    })
    expect(h.rrpCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ playerId: 'fantrax:04qyh', acquisitionType: 'waiver', playerName: 'Tyler Madden' }) })
    const rosterId = (h.rrpCreate.mock.calls[0][0] as { data: { playerId: string } }).data.playerId

    // Before the weekly link: no identity carries his Fantrax id, so he is looked up under his own
    // `fantrax:` id — and NHL game logs are keyed on PlayerIdentityMap.id, so no row has it: zero.
    const unlinked = { playerIdentityMap: { findMany: vi.fn(async () => []) } }
    const before = await bridgeRosterIdsToGameLogIds(unlinked as never, ['NHL'], [rosterId])
    expect(before.bridgedByFantrax).toBe(0)
    expect(before.gameLogIds).toEqual(['fantrax:04qyh'])

    // After it: his identity's game logs are credited to the roster id the claim wrote.
    const linked = {
      playerIdentityMap: {
        findMany: vi.fn(async (args: { where: { fantraxId?: unknown } }) =>
          args.where.fantraxId ? [{ id: 'idm-madden', rollingInsightsId: '9001', sleeperId: null, fantraxId: '04qyh' }] : []),
      },
    }
    const after = await bridgeRosterIdsToGameLogIds(linked as never, ['NHL'], [rosterId])
    expect(after.gameLogIds).toContain('idm-madden')
    expect(after.bridgedByFantrax).toBe(1)
    expect(after.rosterIdFor('idm-madden')).toBe('fantrax:04qyh')
  })
})
