import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * The commissioner's "lock all moves" (`League.lockAllMoves`) on `/api/redraft/trade-votes`.
 *
 * 🛑 This route never read the lock, for ANY sport: a proposal made before the commissioner locked the league
 * could still be accepted, approved or voted through — and settled — while every roster was meant to be
 * frozen. The lock now refuses the receiver's accept and every settlement (no_veto accept, commissioner
 * approval, the league vote's approve) with a 409 `MOVE_LOCKED`, the code the NFL trade runtime already uses.
 *
 * Unlike the deadline, the lock binds at SETTLEMENT too: a trade accepted before the lock may not finish its
 * review while moves are frozen. Vetoes and rejections move nothing and stay allowed.
 *
 * Harness copied from trade-votes-deadline.test.ts; settlement's collaborators are doubles.
 */

const h = vi.hoisted(() => ({
  proposal: null as Record<string, unknown> | null,
  week: 10,
  seasonStatus: 'active',
  lifecycleState: 'in_season',
  settle: vi.fn(),
  claim: vi.fn(),
  acceptClaim: vi.fn(),
  lockAllMoves: false,
  voteCreate: vi.fn(),
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
            { id: 'rC', ownerId: 'uC' },
          ]),
          findFirst: vi.fn(async () => ({ ownerId: 'uA' })),
        }),
        league: model({
          findUnique: vi.fn(async () => ({
            id: 'L',
            tradeDeadlineWeek: 11,
            lifecycleState: h.lifecycleState,
            platform: 'allfantasy',
            lockAllMoves: h.lockAllMoves,
          })),
        }),
        redraftSeason: model({
          findFirst: vi.fn(async () => ({ id: 'S', currentWeek: h.week, status: h.seasonStatus })),
        }),
        redraftTradeVote: model({
          create: h.voteCreate,
          findMany: vi.fn(async () => [{ vote: 'approve' }]),
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
    vetoMode: 'commissioner', vetoThreshold: 1, expiresAt: null, acceptedAt: null, votes: [],
    assets: [{ fromRosterId: 'rA', toRosterId: 'rB', assetType: 'player', playerId: 'a1', playerName: 'a1', pickSeason: null, pickRound: null, pickNumber: null, metadata: {} }],
    ...over,
  }
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('../../app/api/redraft/trade-votes/route')
  return POST(createMockNextRequest('http://localhost/api/redraft/trade-votes', { method: 'POST', body }) as never)
}

const LOCKED = { code: 'MOVE_LOCKED' }

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h, { week: 10, seasonStatus: 'active', lifecycleState: 'in_season', lockAllMoves: false })
  h.claim.mockResolvedValue({ count: 1 })
  h.acceptClaim.mockResolvedValue({ count: 1 })
  h.voteCreate.mockResolvedValue({})
  h.settle.mockResolvedValue({ playersMoved: 1, faabTransferred: 0, picksRecorded: 0 })
})

describe('receiver accept', () => {
  it('🛑 locked: refused with 409 MOVE_LOCKED, and acceptedAt is never written', async () => {
    h.lockAllMoves = true
    pending()
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json).toMatchObject(LOCKED)
    expect(String(json.error)).toMatch(/locked/i)
    expect(h.acceptClaim).not.toHaveBeenCalled()
  })

  it('unlocked: the same accept goes to commissioner review', async () => {
    pending()
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(200)
    expect(h.acceptClaim).toHaveBeenCalledTimes(1)
  })

  it('🛑 locked: a no_veto accept does not settle', async () => {
    h.lockAllMoves = true
    pending({ vetoMode: 'no_veto' })
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject(LOCKED)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('unlocked: a no_veto accept settles', async () => {
    pending({ vetoMode: 'no_veto' })
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(200)
    expect(h.settle).toHaveBeenCalledTimes(1)
  })

  it('locked: the receiver may still reject (a rejection moves nothing)', async () => {
    h.lockAllMoves = true
    pending()
    const res = await post({ proposalId: 'p-1', action: 'reject' })
    expect(res.status).toBe(200)
  })
})

describe('settlement: commissioner approval', () => {
  const accepted = () => pending({ acceptedAt: new Date('2026-10-01T00:00:00Z'), __actor: 'commish' })

  it('🛑 locked: a trade accepted BEFORE the lock is not settled by approval while it holds', async () => {
    h.lockAllMoves = true
    accepted()
    const res = await post({ proposalId: 'p-1', action: 'commissioner_approve' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject(LOCKED)
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.claim).not.toHaveBeenCalled()
  })

  it('unlocked: approval settles', async () => {
    accepted()
    const res = await post({ proposalId: 'p-1', action: 'commissioner_approve' })
    expect(res.status).toBe(200)
    expect(h.settle).toHaveBeenCalledTimes(1)
  })

  it('locked: the commissioner may still veto (a veto moves nothing)', async () => {
    h.lockAllMoves = true
    accepted()
    const res = await post({ proposalId: 'p-1', action: 'commissioner_veto' })
    expect(res.status).toBe(200)
    expect(h.settle).not.toHaveBeenCalled()
  })
})

describe('settlement: league vote', () => {
  const accepted = () => pending({ vetoMode: 'league_vote', acceptedAt: new Date('2026-10-01T00:00:00Z'), __actor: 'uC' })

  it('🛑 locked: an approve vote is refused before it is recorded, and nothing settles', async () => {
    h.lockAllMoves = true
    accepted()
    const res = await post({ proposalId: 'p-1', action: 'vote_approve' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject(LOCKED)
    expect(h.voteCreate).not.toHaveBeenCalled()
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('unlocked: the approve vote that reaches the threshold settles', async () => {
    accepted()
    const res = await post({ proposalId: 'p-1', action: 'vote_approve' })
    expect(res.status).toBe(200)
    expect(h.voteCreate).toHaveBeenCalledTimes(1)
    expect(h.settle).toHaveBeenCalledTimes(1)
  })
})
