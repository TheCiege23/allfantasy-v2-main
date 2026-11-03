import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * Accepting and rejecting a MULTI-TEAM trade on `/api/redraft/trade-votes`.
 *
 * Every team but the proposer has to accept. Until the last one does, the acceptance is recorded per
 * team (`acceptedRosterIds`), `acceptedAt` stays unset and nothing settles or opens a review window.
 * The last acceptance runs exactly the two-team accept flow. Any one team rejecting ends the trade.
 *
 * Two-team behaviour is pinned by the existing trade-votes suites, which run unchanged.
 * Harness modelled on trade-votes-review-window.test.ts, with a STATEFUL proposal row so a recorded
 * acceptance is visible to the next request.
 */

const h = vi.hoisted(() => ({
  proposal: null as Record<string, unknown> | null,
  actor: 'uB',
  settle: vi.fn(),
  settlementClaim: vi.fn(),
  acceptedAtClaim: vi.fn(),
  update: vi.fn(),
  capCheck: vi.fn(async () => ({ ok: true })),
  notify: vi.fn(async () => undefined),
}))

function model(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get: (target, key: string) => (key in target ? target[key] : vi.fn(async () => (key.startsWith('findMany') ? [] : null))),
  })
}

/** The route's conditional writes, applied to the in-memory row. */
async function proposalUpdateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
  const p = h.proposal!
  const data = args.data
  if (data.acceptedRosterIds && typeof data.acceptedRosterIds === 'object') {
    const roster = (data.acceptedRosterIds as { push: string }).push
    const list = (p.acceptedRosterIds as string[]) ?? []
    if (p.status !== 'pending' || p.acceptedAt || list.includes(roster)) return { count: 0 }
    p.acceptedRosterIds = [...list, roster]
    return { count: 1 }
  }
  if ('acceptedAt' in data && 'expiresAt' in data) return h.acceptedAtClaim(args)
  return { count: 1 }
}

vi.mock('@/lib/prisma', () => {
  const tx = {
    redraftTradeProposal: model({
      updateMany: h.settlementClaim,
      findUniqueOrThrow: vi.fn(async () => ({ ...h.proposal, status: 'accepted' })),
    }),
    // No IDP salary cap in this league (a cap league refuses a multi-team trade).
    iDPCapConfig: model(),
  }
  return {
    prisma: new Proxy(
      {
        redraftTradeProposal: model({
          findFirst: vi.fn(async () => (h.proposal ? { ...h.proposal } : null)),
          updateMany: vi.fn(proposalUpdateMany),
          update: h.update,
          findUnique: vi.fn(async () => (h.proposal ? { ...h.proposal } : null)),
        }),
        redraftRoster: model({
          findMany: vi.fn(async () => [
            { id: 'rA', ownerId: 'uA' },
            { id: 'rB', ownerId: 'uB' },
            { id: 'rC', ownerId: 'uC' },
            { id: 'rD', ownerId: 'uD' },
          ]),
          findFirst: vi.fn(async () => ({ ownerId: 'uA' })),
        }),
        league: model({
          findUnique: vi.fn(async () => ({ id: 'L', tradeDeadlineWeek: null, lifecycleState: 'in_season', platform: 'allfantasy', lockAllMoves: false, tradeReviewHours: null })),
        }),
        redraftSeason: model({ findFirst: vi.fn(async () => ({ id: 'S', currentWeek: 3, status: 'active' })) }),
        $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
      } as Record<string, unknown>,
      { get: (target, key: string) => (key in target ? target[key] : model()) },
    ),
  }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: h.actor } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true, status: 200 })) }))
vi.mock('@/lib/league/permissions', () => ({ hasLeagueCommissionerRights: vi.fn(async (_l: string, u: string) => u === 'commish') }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: vi.fn(async () => null) }))
vi.mock('@/lib/trade-deadline/tradeDeadlineWindow', () => ({
  evaluateRedraftTradeDeadline: vi.fn(async () => ({ passed: false })),
  tradeDeadlinePassedMessage: () => 'passed',
}))
vi.mock('@/server/services/postDraftRosterLockService', () => ({ postDraftRosterMoveRefusal: vi.fn(async () => null) }))
vi.mock('@/lib/idp/capEngine', () => ({
  validateRedraftTradeCap: h.capCheck,
  validateRedraftTradeCapInTransaction: h.capCheck,
  applyRedraftTradeCapTransfersInTransaction: vi.fn(async () => ({ moved: 0, transactionIds: [] })),
  refreshCapProjections: vi.fn(async () => undefined),
}))
vi.mock('@/lib/redraft/tradeSettlement', () => ({ settleRedraftTradeAssets: h.settle }))
vi.mock('@/lib/redraft/tradeExecutionSnapshot', () => ({
  captureRedraftRosterState: vi.fn(async () => ({})),
  writeRedraftTradeExecutionSnapshot: vi.fn(async () => undefined),
}))
vi.mock('@/lib/redraft/tradeReversal', () => ({ evaluateNativeTradeReversalReadiness: vi.fn(), reverseNativeTrade: vi.fn() }))
vi.mock('@/lib/trade-reversal/notice', () => ({ publishTradeReversalNotice: vi.fn() }))
vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_ACCEPTED: 'a', TRADE_PROCESSED: 'p' },
  getPlatformEvents: () => ({ emit: vi.fn(async () => undefined), emitInTx: vi.fn(async () => undefined) }),
}))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/integrity/enqueueCollusionScan', () => ({ enqueueCollusionScan: vi.fn() }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai-learning-system/recordTradeParticipants', () => ({ recordTradeOutcomeForBothManagers: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: vi.fn(async () => 'NFL') }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: vi.fn() }))
vi.mock('@/lib/integrity/holdFlaggedTrades', () => ({ shouldHoldAcceptedTrade: vi.fn(async () => false) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.notify }))

function threeTeam(over: Record<string, unknown> = {}) {
  h.proposal = {
    id: 'p-3', leagueId: 'L', seasonId: 'S', proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC'],
    acceptedRosterIds: [], status: 'pending', vetoMode: 'no_veto', vetoThreshold: 1, expiresAt: null, acceptedAt: null, votes: [],
    assets: [
      { fromRosterId: 'rA', toRosterId: 'rB', assetType: 'player', playerId: 'a1', playerName: 'a1', pickSeason: null, pickRound: null, pickNumber: null, metadata: {} },
      { fromRosterId: 'rB', toRosterId: 'rC', assetType: 'player', playerId: 'b1', playerName: 'b1', pickSeason: null, pickRound: null, pickNumber: null, metadata: {} },
      { fromRosterId: 'rC', toRosterId: 'rA', assetType: 'faab', playerId: null, playerName: null, pickSeason: null, pickRound: null, pickNumber: null, metadata: { amount: 5 } },
    ],
    ...over,
  }
}

async function post(actor: string, body: Record<string, unknown>) {
  h.actor = actor
  const { POST } = await import('../../app/api/redraft/trade-votes/route')
  const res = await POST(createMockNextRequest('http://localhost/api/redraft/trade-votes', { method: 'POST', body }) as never)
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.settlementClaim.mockResolvedValue({ count: 1 })
  h.acceptedAtClaim.mockResolvedValue({ count: 1 })
  h.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...h.proposal, ...data }))
  h.settle.mockResolvedValue({ playersMoved: 2, faabTransferred: 5, picksRecorded: 0 })
})

describe('multi-team accept', () => {
  it('the first of two teams to accept is recorded, and the trade waits on the other', async () => {
    threeTeam()
    const r = await post('uB', { proposalId: 'p-3', action: 'accept' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ resolved: false, awaitingAcceptance: ['rC'], acceptedRosterIds: ['rB'] })
    expect(h.proposal!.acceptedRosterIds).toEqual(['rB'])
    expect(h.proposal!.acceptedAt).toBeNull()
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.acceptedAtClaim).not.toHaveBeenCalled()
  })

  it('the additional team can be the first to accept too', async () => {
    threeTeam()
    const r = await post('uC', { proposalId: 'p-3', action: 'accept' })
    expect(r.json).toMatchObject({ resolved: false, awaitingAcceptance: ['rB'] })
  })

  it('the last acceptance settles the trade under no_veto, with every team in the settlement', async () => {
    threeTeam({ acceptedRosterIds: ['rB'] })
    const r = await post('uC', { proposalId: 'p-3', action: 'accept' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ resolved: true })
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect(h.settle.mock.calls[0]![1]).toMatchObject({ proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC'] })
    // The pairwise IDP cap check is never run on a multi-team trade.
    expect(h.capCheck).not.toHaveBeenCalled()
  })

  it('the last acceptance opens the review window instead when the league reviews trades', async () => {
    threeTeam({ acceptedRosterIds: ['rB'], vetoMode: 'commissioner' })
    const r = await post('uC', { proposalId: 'p-3', action: 'accept' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ resolved: false, awaitingReview: 'commissioner' })
    expect(h.acceptedAtClaim).toHaveBeenCalledTimes(1)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('a team cannot accept twice', async () => {
    threeTeam({ acceptedRosterIds: ['rB'] })
    const r = await post('uB', { proposalId: 'p-3', action: 'accept' })
    expect(r.status).toBe(409)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('a manager outside the trade cannot accept, and neither can the proposer', async () => {
    threeTeam()
    expect((await post('uD', { proposalId: 'p-3', action: 'accept' })).status).toBe(403)
    expect((await post('uA', { proposalId: 'p-3', action: 'accept' })).status).toBe(403)
    expect(h.proposal!.acceptedRosterIds).toEqual([])
  })
})

describe('multi-team reject', () => {
  it.each(['uB', 'uC'])('%s rejecting ends the trade for every team', async (actor) => {
    threeTeam({ acceptedRosterIds: actor === 'uC' ? ['rB'] : [] })
    const r = await post(actor, { proposalId: 'p-3', action: 'reject' })
    expect(r.status).toBe(200)
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }))
    expect(h.settle).not.toHaveBeenCalled()
  })
})

describe('review of a multi-team trade', () => {
  it('a commissioner cannot approve it before every team has accepted', async () => {
    threeTeam({ acceptedRosterIds: ['rB'], vetoMode: 'commissioner' })
    const r = await post('commish', { proposalId: 'p-3', action: 'commissioner_approve' })
    expect(r.status).toBe(409)
    expect(String(r.json.error)).toMatch(/Not every team/)
  })

  it('the third team is a party and cannot vote on it', async () => {
    threeTeam({ acceptedRosterIds: ['rB', 'rC'], vetoMode: 'league_vote', acceptedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) })
    expect((await post('uC', { proposalId: 'p-3', action: 'vote_approve' })).status).toBe(403)
  })
})
