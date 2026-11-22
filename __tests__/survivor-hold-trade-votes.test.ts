import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from './helpers/createMockNextRequest'

/**
 * Survivor "if the trade check can't run: hold it for the commissioner", at the redraft route
 * `/api/redraft/trade-votes` (the accept and the approve-vote branches). The route, the review-mode
 * switch and the DM are real; the Survivor check is pinned to "could not run, hold", and the hold writer
 * and league language are doubles so what they were asked to do is visible. Built on the harness of
 * trade-votes-deadline.test.ts.
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


const sv = vi.hoisted(() => ({
  check: vi.fn(),
  hold: vi.fn(async () => undefined),
  language: vi.fn(async () => 'es' as string | null),
}))
vi.mock('@/lib/survivor/survivorTradeRuleHook', () => ({ checkSurvivorTradeRules: sv.check }))
vi.mock('@/lib/survivor/survivorTradeCheckHold', () => ({ holdRedraftProposalForCommissioner: sv.hold, survivorLeagueLanguage: sv.language }))

function pending(over: Record<string, unknown> = {}) {
  h.proposal = {
    id: 'p-1', leagueId: 'L', seasonId: 'S', proposerRosterId: 'rA', receiverRosterId: 'rB', status: 'pending',
    vetoMode: 'commissioner', vetoThreshold: 4, expiresAt: null, acceptedAt: null, votes: [],
    assets: [{ fromRosterId: 'rA', toRosterId: 'rB', assetType: 'player', playerId: 'a1', playerName: 'a1', pickSeason: null, pickRound: null, pickNumber: null, metadata: {} }],
    ...over,
  }
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('../app/api/redraft/trade-votes/route')
  return POST(createMockNextRequest('http://localhost/api/redraft/trade-votes', { method: 'POST', body }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h, { week: 10, seasonStatus: 'active', lifecycleState: 'in_season' })
  h.claim.mockResolvedValue({ count: 1 })
  h.acceptClaim.mockResolvedValue({ count: 1 })
  h.settle.mockResolvedValue({ playersMoved: 1, faabTransferred: 0, picksRecorded: 0 })
})

beforeEach(() => {
  sv.check.mockResolvedValue({ ok: true, skipped: 'error', holdForCommissioner: true })
  sv.language.mockResolvedValue('es')
})

describe('accept, when the Survivor check could not run and the league holds', () => {
  it('a no_veto trade is NOT settled: it goes to commissioner review, marked, with the DM in the league language', async () => {
    pending({ vetoMode: 'no_veto' })
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ resolved: false, awaitingReview: 'commissioner' })
    expect(h.settle).not.toHaveBeenCalled()
    expect(sv.hold).toHaveBeenCalledWith({ leagueId: 'L', proposalId: 'p-1', actorUserId: 'uB' })
    const { queueTradeStatusInDm } = await import('@/lib/chat-notifications/tradeOfferDm')
    expect(queueTradeStatusInDm).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted', detail: expect.stringContaining('queda retenido hasta que el comisionado') }))
  })

  it('English league: the English hold line', async () => {
    sv.language.mockResolvedValue(null)
    pending({ vetoMode: 'no_veto' })
    await post({ proposalId: 'p-1', action: 'accept' })
    const { queueTradeStatusInDm } = await import('@/lib/chat-notifications/tradeOfferDm')
    expect(queueTradeStatusInDm).toHaveBeenCalledWith(expect.objectContaining({ detail: 'The Survivor trade check could not run, so this trade is held for the commissioner to approve or veto.' }))
  })

  it('a check that ran clean settles a no_veto trade as before (control)', async () => {
    sv.check.mockResolvedValue({ ok: true, bypassed: false })
    pending({ vetoMode: 'no_veto' })
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(200)
    expect(sv.hold).not.toHaveBeenCalled()
  })
})

describe('approve vote, when the Survivor check could not run and the league holds', () => {
  it('the vote cannot settle it: 409, held for the commissioner, message in the league language', async () => {
    pending({ vetoMode: 'league_vote', acceptedAt: new Date(), __actor: 'uC' })
    const res = await post({ proposalId: 'p-1', action: 'vote_approve' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('SURVIVOR_TRADE_CHECK_HELD')
    expect(body.error).toContain('comisionado')
    expect(sv.hold).toHaveBeenCalledWith(expect.objectContaining({ proposalId: 'p-1' }))
    expect(h.settle).not.toHaveBeenCalled()
  })
})
