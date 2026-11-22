import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * Survivor free-trade tokens on `/api/redraft/trade-votes`: a trade that only passed the Survivor trade
 * rules because of a held token (the hook's `bypassRequired` / `bypassSource`) spends that token once it
 * settles — on a no_veto accept and on the league vote that reaches its threshold — under the trade's own
 * ref (`redraft:<proposalId>`, idempotent per trade). A commissioner approval is the override and never
 * spends it; neither does a trade that did not need the token.
 *
 * Harness copied from trade-votes-move-lock.test.ts; the Survivor hook and the redeemer are doubles, the
 * decision (`survivorBypassSourceToRedeem`) is the real one.
 */

const h = vi.hoisted(() => ({
  survivorCheck: { ok: true, skipped: 'not_survivor' } as Record<string, unknown>,
  redeem: vi.fn(),
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

vi.mock('@/lib/survivor/survivorTradeRuleHook', () => ({ checkSurvivorTradeRules: vi.fn(async () => h.survivorCheck) }))
vi.mock('@/lib/survivor/survivorTradeRuleBypass', async (orig) => ({
  ...(await orig<typeof import('@/lib/survivor/survivorTradeRuleBypass')>()),
  redeemSurvivorTradeBypass: h.redeem,
}))

const NEEDED = { ok: true, bypassed: true, bypassRequired: true, bypassSource: 'free_trade_token:ra', week: 9 }

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h, { week: 10, seasonStatus: 'active', lifecycleState: 'in_season', lockAllMoves: false, survivorCheck: NEEDED })
  h.claim.mockResolvedValue({ count: 1 })
  h.acceptClaim.mockResolvedValue({ count: 1 })
  h.voteCreate.mockResolvedValue({})
  h.redeem.mockResolvedValue(true)
  h.settle.mockResolvedValue({ playersMoved: 1, faabTransferred: 0, picksRecorded: 0 })
})

describe('Survivor free-trade token on the trade-votes path', () => {
  it('a no_veto accept that needed the token settles and spends it once, under the trade ref', async () => {
    pending({ vetoMode: 'no_veto' })
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(200)
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect(h.redeem).toHaveBeenCalledTimes(1)
    expect(h.redeem).toHaveBeenCalledWith({ leagueId: 'L', week: 9, tradeRef: 'redraft:p-1', source: 'free_trade_token:ra', actorUserId: 'uB' })
  })

  it('the league vote that reaches its threshold spends it', async () => {
    pending({ vetoMode: 'league_vote', acceptedAt: new Date('2026-10-01T00:00:00Z'), __actor: 'uC' })
    const res = await post({ proposalId: 'p-1', action: 'vote_approve' })
    expect(res.status).toBe(200)
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect(h.redeem).toHaveBeenCalledWith(expect.objectContaining({ tradeRef: 'redraft:p-1', source: 'free_trade_token:ra' }))
  })

  it('a commissioner approval (the override) never spends it', async () => {
    pending({ acceptedAt: new Date('2026-10-01T00:00:00Z'), __actor: 'commish' })
    const res = await post({ proposalId: 'p-1', action: 'commissioner_approve' })
    expect(res.status).toBe(200)
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect(h.redeem).not.toHaveBeenCalled()
  })

  it('a trade that did not need the token, or did not settle, spends nothing', async () => {
    h.survivorCheck = { ok: true, bypassed: true, bypassRequired: false, bypassSource: null, week: 9 }
    pending({ vetoMode: 'no_veto' })
    expect((await post({ proposalId: 'p-1', action: 'accept' })).status).toBe(200)
    expect(h.redeem).not.toHaveBeenCalled()
    h.survivorCheck = NEEDED
    pending()
    expect((await post({ proposalId: 'p-1', action: 'accept' })).status).toBe(200) // to commissioner review: not settled yet
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect(h.redeem).not.toHaveBeenCalled()
  })
})

