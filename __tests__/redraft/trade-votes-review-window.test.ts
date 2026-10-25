import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * The trade review window on `/api/redraft/trade-votes` (lib/redraft/tradeReviewWindow.ts).
 *
 * Accepting opens the window: `expiresAt` becomes acceptance + `League.tradeReviewHours`. Once it has
 * ended with no veto, the trade is going through (the hourly sweep executes it): a late veto, vote or
 * cancel is refused, and nothing lazily expires it — only the commissioner's approve still acts.
 *
 * Harness copied from trade-votes-move-lock.test.ts.
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
  reviewHours: null as number | null,
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
            tradeReviewHours: h.reviewHours,
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

const HOUR = 3600_000

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h, { week: 10, seasonStatus: 'active', lifecycleState: 'in_season', lockAllMoves: false, reviewHours: null })
  h.claim.mockResolvedValue({ count: 1 })
  h.acceptClaim.mockResolvedValue({ count: 1 })
  h.voteCreate.mockResolvedValue({})
  h.settle.mockResolvedValue({ playersMoved: 1, faabTransferred: 0, picksRecorded: 0 })
})

describe('accepting opens the review window', () => {
  it("sets the end to acceptance + the league's review hours (48 when unset)", async () => {
    pending({ expiresAt: new Date(Date.now() + 5 * HOUR) })
    const before = Date.now()
    expect((await post({ proposalId: 'p-1', action: 'accept' })).status).toBe(200)
    const data = h.acceptClaim.mock.calls[0][0].data as { acceptedAt: Date; expiresAt: Date }
    expect(data.expiresAt.getTime() - data.acceptedAt.getTime()).toBe(48 * HOUR)
    expect(data.acceptedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('uses the hours the commissioner set', async () => {
    h.reviewHours = 24
    pending()
    await post({ proposalId: 'p-1', action: 'accept' })
    const data = h.acceptClaim.mock.calls[0][0].data as { acceptedAt: Date; expiresAt: Date }
    expect(data.expiresAt.getTime() - data.acceptedAt.getTime()).toBe(24 * HOUR)
  })
})

describe('after the window ends with no veto', () => {
  const ended = (over: Record<string, unknown> = {}) =>
    pending({ acceptedAt: new Date(Date.now() - 50 * HOUR), expiresAt: new Date(Date.now() - 2 * HOUR), ...over })

  it.each([
    ['a commissioner veto', 'commish', 'commissioner_veto', {}],
    ['a league veto vote', 'uC', 'vote_veto', { vetoMode: 'league_vote' }],
    ['a league approve vote', 'uC', 'vote_approve', { vetoMode: 'league_vote' }],
    ['a cancel by the proposer', 'uA', 'cancel', {}],
  ])('refuses %s: the trade is going through', async (_label, actor, action, over) => {
    ended({ __actor: actor, ...over })
    const res = await post({ proposalId: 'p-1', action })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'REVIEW_WINDOW_ENDED' })
    expect(h.claim).not.toHaveBeenCalled()
    expect(h.voteCreate).not.toHaveBeenCalled()
  })

  it('never expires an accepted trade on a click', async () => {
    ended({ __actor: 'uC', vetoMode: 'league_vote' })
    const res = await post({ proposalId: 'p-1', action: 'vote_veto' })
    expect(await res.json()).not.toMatchObject({ resolved: true })
  })

  it('still lets the commissioner approve it, which settles it now', async () => {
    ended({ __actor: 'commish' })
    const res = await post({ proposalId: 'p-1', action: 'commissioner_approve' })
    expect(res.status).toBe(200)
    expect(h.settle).toHaveBeenCalledTimes(1)
  })
})

describe('an offer that lapsed before acceptance', () => {
  it('still expires on the next click, as before', async () => {
    pending({ __actor: 'uB', expiresAt: new Date(Date.now() - HOUR) })
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(await res.json()).toMatchObject({ resolved: true })
    expect(h.acceptClaim).not.toHaveBeenCalled()
  })
})
