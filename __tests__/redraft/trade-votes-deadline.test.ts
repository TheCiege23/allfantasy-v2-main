import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * The trade deadline on `/api/redraft/trade-votes`, the redraft path's accept / approve / vote route.
 *
 * 🛑 Accepting never looked at the deadline: an offer made in week 10 could be accepted — and under
 * `no_veto`, settled — in week 14. Acceptance is now the gate. A trade ACCEPTED before the deadline still
 * finishes its commissioner review or league vote after it (Sleeper / ESPN behaviour).
 *
 * The deadline window is REAL: the week is read from the season row in the prisma double. Settlement's
 * collaborators are doubles — the settlement itself has its own suites; what is pinned here is the gate.
 */

const h = vi.hoisted(() => ({
  proposal: null as Record<string, unknown> | null,
  week: 10,
  seasonStatus: 'active',
  lifecycleState: 'in_season',
  settle: vi.fn(),
  claim: vi.fn(),
  acceptClaim: vi.fn(),
}))

/** Any model method not named below resolves to an empty answer, so settlement's bookkeeping can run. */
function model(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get: (target, key: string) => (key in target ? target[key] : vi.fn(async () => (key.startsWith('findMany') ? [] : null))),
  })
}

vi.mock('@/lib/prisma', () => {
  const tx = {
    redraftTradeProposal: model({
      updateMany: h.claim,
      findUniqueOrThrow: vi.fn(async () => ({ ...h.proposal, status: 'accepted' })),
    }),
  }
  return {
    prisma: new Proxy(
      {
        redraftTradeProposal: model({
          findFirst: vi.fn(async () => h.proposal),
          updateMany: h.acceptClaim,
          findUnique: vi.fn(async () => ({ ...h.proposal, acceptedAt: new Date() })),
        }),
        redraftRoster: model({
          findMany: vi.fn(async () => [
            { id: 'rA', ownerId: 'uA' },
            { id: 'rB', ownerId: 'uB' },
          ]),
          findFirst: vi.fn(async () => ({ ownerId: 'uA' })),
        }),
        league: model({
          findUnique: vi.fn(async () => ({
            id: 'L',
            tradeDeadlineWeek: 11,
            lifecycleState: h.lifecycleState,
            platform: 'allfantasy',
          })),
        }),
        redraftSeason: model({
          findFirst: vi.fn(async () => ({ id: 'S', currentWeek: h.week, status: h.seasonStatus })),
        }),
        $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
      } as Record<string, unknown>,
      { get: (target, key: string) => (key in target ? target[key] : model()) },
    ),
  }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: h.proposal?.__actor ?? 'uB' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true, status: 200 })) }))
vi.mock('@/lib/league/permissions', () => ({ hasLeagueCommissionerRights: vi.fn(async (_l: string, u: string) => u === 'commish') }))
vi.mock('@/lib/idp/capEngine', () => ({
  validateRedraftTradeCap: vi.fn(async () => ({ ok: true })),
  validateRedraftTradeCapInTransaction: vi.fn(async () => ({ ok: true })),
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

function pending(over: Record<string, unknown> = {}) {
  h.proposal = {
    id: 'p-1', leagueId: 'L', seasonId: 'S', proposerRosterId: 'rA', receiverRosterId: 'rB', status: 'pending',
    vetoMode: 'commissioner', vetoThreshold: 4, expiresAt: null, acceptedAt: null, votes: [],
    assets: [{ fromRosterId: 'rA', toRosterId: 'rB', assetType: 'player', playerId: 'a1', playerName: 'a1', pickSeason: null, pickRound: null, pickNumber: null, metadata: {} }],
    ...over,
  }
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('../../app/api/redraft/trade-votes/route')
  return POST(createMockNextRequest('http://localhost/api/redraft/trade-votes', { method: 'POST', body }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h, { week: 10, seasonStatus: 'active', lifecycleState: 'in_season' })
  h.claim.mockResolvedValue({ count: 1 })
  h.acceptClaim.mockResolvedValue({ count: 1 })
  h.settle.mockResolvedValue({ playersMoved: 1, faabTransferred: 0, picksRecorded: 0 })
})

describe('accept', () => {
  it('before the deadline: the receiver accepts and the trade goes to commissioner review', async () => {
    pending()
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ resolved: false, awaitingReview: 'commissioner' })
    expect(h.acceptClaim).toHaveBeenCalledTimes(1)
  })

  it('🛑 after the deadline (week 12, deadline 11): refused, and acceptedAt is never written', async () => {
    h.week = 12
    pending()
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'TRADE_DEADLINE_PASSED', error: 'Trade deadline passed after Week 11.' })
    expect(h.acceptClaim).not.toHaveBeenCalled()
  })

  it('🛑 after the deadline, a no_veto acceptance does not settle', async () => {
    h.week = 12
    pending({ vetoMode: 'no_veto' })
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(409)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('before the deadline, a no_veto acceptance settles', async () => {
    pending({ vetoMode: 'no_veto' })
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(200)
    expect(h.settle).toHaveBeenCalledTimes(1)
  })

  it("offseason: last season's week 17 does not block an acceptance", async () => {
    Object.assign(h, { week: 17, seasonStatus: 'complete' })
    pending()
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(200)
  })
})

describe('a trade accepted before the deadline finishes its review after it', () => {
  it('commissioner approval in week 12 settles a trade accepted earlier', async () => {
    h.week = 12
    pending({ acceptedAt: new Date('2026-10-01T00:00:00Z'), __actor: 'commish' })
    const res = await post({ proposalId: 'p-1', action: 'commissioner_approve' })
    expect(res.status).toBe(200)
    expect(h.settle).toHaveBeenCalledTimes(1)
  })
})
