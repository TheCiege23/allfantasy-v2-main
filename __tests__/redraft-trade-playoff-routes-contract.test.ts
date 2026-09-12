import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from './helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const validateRedraftTradeCapMock = vi.fn()
const applyRedraftTradeCapTransfersInTransactionMock = vi.fn()
const refreshCapProjectionsMock = vi.fn()
const emitMock = vi.fn(async () => null)
const emitInTxMock = vi.fn(async () => ({ eventId: 'evt-contract-1' }))
const enqueueCollusionScanMock = vi.fn()

const prismaMock = {
  redraftTradeProposal: {
    findMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    // G15.2b concurrency guard: the settlement $transaction atomically claims the
    // proposal via updateMany(status: 'pending' → 'accepted'), then re-reads it.
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUniqueOrThrow: vi.fn(async () => ({ status: 'accepted' })),
  },
  redraftTradeAsset: {
    createMany: vi.fn(),
  },
  redraftTradeVote: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  redraftTradeDecision: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  redraftLeagueTrade: {
    create: vi.fn(),
  },
  redraftSeason: {
    findFirst: vi.fn(),
    findUnique: vi.fn(async () => null),
  },
  redraftRoster: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(async () => 2),
  },
  redraftRosterPlayer: {
    updateMany: vi.fn(),
    // Read by `captureRedraftRosterState` for the execution snapshot's before/after evidence.
    findMany: vi.fn(async () => []),
  },
  // ⚠ THE EXECUTION SNAPSHOT IS WRITTEN INSIDE THE SETTLEMENT TRANSACTION. Without this delegate
  // the settlement throws and every accept test 409s — the loud half of a double that stopped
  // matching its module.
  tradeExecutionSnapshot: {
    create: vi.fn(async () => ({ id: 'snap-1' })),
  },
  // T2 value snapshot capture (best-effort in the route; defaults keep the contract test focused).
  adpDataRecord: {
    findMany: vi.fn(async () => []),
  },
  redraftTradeValueSnapshot: {
    create: vi.fn(async () => ({})),
    findUnique: vi.fn(async () => null),
  },
  redraftPlayoffBracket: {
    upsert: vi.fn(),
  },
  redraftPlayoffSeed: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  redraftPlayoffRound: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  redraftPlayoffMatchup: {
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  league: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  // Settlement runs inside a $transaction; execute the callback with the tx client below.
  $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock)),
}

/*
 * ⚠ THE TX CLIENT IS A DISTINCT OBJECT FROM `prismaMock`, DELIBERATELY.
 *
 * It used to be `cb(prismaMock)`, which makes "was this called with the transaction client?"
 * unfalsifiable: passing the module-level `prisma` instead of `tx` satisfies it just as well, so the
 * assertion reads as a check and is one. Spreading keeps every delegate the SAME spy object, so
 * calls made through the tx still register on `prismaMock.<model>` and existing assertions are
 * untouched — only the identity of the client handed to the callback changes.
 */
const txMock = { ...prismaMock, __isTransactionClient: true }
prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(txMock))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock('@/lib/idp/capEngine', () => ({
  validateRedraftTradeCap: validateRedraftTradeCapMock,
  applyRedraftTradeCapTransfersInTransaction: applyRedraftTradeCapTransfersInTransactionMock,
  refreshCapProjections: refreshCapProjectionsMock,
}))

vi.mock('@/lib/integrity/enqueueCollusionScan', () => ({
  enqueueCollusionScan: enqueueCollusionScanMock,
}))

/*
 * ⚠ THE EVENTS MODULE HAS TO BE DOUBLED NOW, AND DID NOT BEFORE.
 *
 * The route used to emit TRADE_PROCESSED post-commit through `emit`, which swallows every error by
 * design — so the real module running against a mock prisma was harmless. The execution snapshot
 * moved that emit INSIDE the transaction via `emitInTx`, which PROPAGATES, so the real publisher
 * reaching for an outbox delegate this double does not have turned every accept into a 409.
 */
vi.mock('@/lib/events', () => ({
  EVENT: {
    TRADE_ACCEPTED: 'transaction.trade.accepted',
    TRADE_PROCESSED: 'transaction.trade.processed',
  },
  getPlatformEvents: () => ({
    emit: emitMock,
    emitInTx: emitInTxMock,
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

describe('Redraft trade proposals route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
  })

  it('lists normalized trade proposals', async () => {
    prismaMock.redraftTradeProposal.findMany.mockResolvedValueOnce([{ id: 'p-1', status: 'pending' }])

    const { GET } = await import('../app/api/redraft/trade-proposals/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trade-proposals?leagueId=l-1&seasonId=s-1')
    const res = await GET(req as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.proposals).toEqual([{ id: 'p-1', status: 'pending' }])
  })

  it('creates a normalized proposal with assets', async () => {
    prismaMock.redraftSeason.findFirst.mockResolvedValueOnce({ id: 's-1', leagueId: 'l-1' })
    prismaMock.redraftRoster.findFirst
      .mockResolvedValueOnce({ id: 'r-1', ownerId: 'u-1' })
      .mockResolvedValueOnce({ id: 'r-2', ownerId: 'u-2' })

    prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        redraftTradeProposal: {
          create: vi.fn().mockResolvedValue({ id: 'p-1' }),
          findUnique: vi.fn().mockResolvedValue({ id: 'p-1', status: 'pending', assets: [], votes: [], decision: null }),
        },
        redraftTradeAsset: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }
      return cb(tx)
    })

    const { POST } = await import('../app/api/redraft/trade-proposals/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trade-proposals', {
      method: 'POST',
      body: {
        leagueId: 'l-1',
        seasonId: 's-1',
        proposerRosterId: 'r-1',
        receiverRosterId: 'r-2',
        reason: 'Need RB depth',
        assets: [{ fromRosterId: 'r-1', toRosterId: 'r-2', assetType: 'future_consideration' }],
      },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.proposal.id).toBe('p-1')
  })
})

describe('Redraft trade votes route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-2' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
    validateRedraftTradeCapMock.mockResolvedValue({ ok: true })
    // `moved: 1` so the post-commit projection refresh is exercised rather than skipped —
    // a fixture of 0 would make the refresh assertions vacuous.
    applyRedraftTradeCapTransfersInTransactionMock.mockResolvedValue({ moved: 1, transactionIds: ['tx-out', 'tx-in'] })
    refreshCapProjectionsMock.mockResolvedValue(undefined)
    enqueueCollusionScanMock.mockResolvedValue(undefined)
  })

  /*
   * 🛑 THIS TEST USED `vetoMode: 'commissioner'` AND ASSERTED THE TRADE SETTLED ON ACCEPT.
   *
   * That is the defect, written down as a contract: a league that configured commissioner review
   * got none, because the receiver's accept called settlement directly. The fixture is now
   * `no_veto` — the ONE mode where settling on accept is correct — so this still proves the
   * settlement path works end to end. The review modes are covered by the two tests below, which
   * assert they do NOT settle.
   */
  it('accepts a pending proposal by receiver owner when no review is configured', async () => {
    prismaMock.redraftTradeProposal.findFirst.mockResolvedValueOnce({
      id: 'p-1',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      expiresAt: null,
      acceptedAt: null,
      vetoMode: 'no_veto',
      vetoThreshold: 4,
      votes: [],
      assets: [],
    })
    prismaMock.redraftRoster.findMany.mockResolvedValueOnce([
      { id: 'r-1', ownerId: 'u-1' },
      { id: 'r-2', ownerId: 'u-2' },
    ])
    prismaMock.league.findFirst.mockResolvedValueOnce({ userId: 'u-1', teams: [] })
    prismaMock.redraftTradeProposal.update.mockResolvedValueOnce({ id: 'p-1', status: 'accepted' })
    prismaMock.redraftTradeDecision.findFirst.mockResolvedValueOnce(null)
    prismaMock.redraftTradeDecision.create.mockResolvedValueOnce({ id: 'd-1' })
    prismaMock.redraftLeagueTrade.create.mockResolvedValueOnce({
      id: 'legacy-trade-1',
      leagueId: 'l-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
    })

    const { POST } = await import('../app/api/redraft/trade-votes/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trade-votes', {
      method: 'POST',
      body: { proposalId: 'p-1', action: 'accept' },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.proposal.status).toBe('accepted')
    expect(body.resolved).toBe(true)
    expect(validateRedraftTradeCapMock).toHaveBeenCalledTimes(1)
    expect(applyRedraftTradeCapTransfersInTransactionMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.redraftLeagueTrade.create).toHaveBeenCalledTimes(1)
    expect(enqueueCollusionScanMock).toHaveBeenCalledTimes(1)
    // Execution evidence is written WITH the trade. `TradeExecutionSnapshot` had no writer at all
    // before this, so a settled trade left nothing for a reversal to restore to.
    expect(prismaMock.tradeExecutionSnapshot.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.tradeExecutionSnapshot.create.mock.calls[0][0].data.executedByActorRole).toBe('user')
    expect(emitInTxMock).toHaveBeenCalledTimes(1)
  })

  /*
   * 🛑 THE IDP CAP TRANSFER USED TO RUN OUTSIDE THE SETTLEMENT TRANSACTION, AND BEFORE THE CLAIM.
   *
   * These three tests pin the boundary. Deleting any one of them hides a different half of the bug,
   * so they assert the mechanism (which client, in what order, under which outcome) rather than
   * "settlement succeeded" — a trade that settles correctly proves nothing about what happens when
   * it does not.
   */
  function acceptFixture(id: string) {
    prismaMock.redraftTradeProposal.findFirst.mockResolvedValueOnce({
      id,
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      expiresAt: null,
      acceptedAt: null,
      vetoMode: 'no_veto',
      vetoThreshold: 4,
      votes: [],
      assets: [],
    })
    prismaMock.redraftRoster.findMany.mockResolvedValueOnce([
      { id: 'r-1', ownerId: 'u-1' },
      { id: 'r-2', ownerId: 'u-2' },
    ])
    prismaMock.league.findFirst.mockResolvedValueOnce({ userId: 'u-1', teams: [] })
    prismaMock.redraftTradeDecision.findFirst.mockResolvedValueOnce(null)
    prismaMock.redraftTradeDecision.create.mockResolvedValueOnce({ id: 'd-1' })
    prismaMock.redraftLeagueTrade.create.mockResolvedValueOnce({
      id: 'legacy-1',
      leagueId: 'l-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
    })
  }

  async function postAccept(id: string) {
    const { POST } = await import('../app/api/redraft/trade-votes/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trade-votes', {
      method: 'POST',
      body: { proposalId: id, action: 'accept' },
    })
    return POST(req as any)
  }

  it('moves IDP salary on the settlement transaction client, after the proposal is claimed', async () => {
    acceptFixture('p-cap')

    const res = await postAccept('p-cap')
    expect(res.status).toBe(200)

    // Inside the transaction: the route must hand it the `tx`, not the module-level prisma client.
    // `txMock` is a DIFFERENT object from `prismaMock` precisely so this can fail — passing `prisma`
    // here is the pre-fix behaviour and must not satisfy the assertion.
    expect(applyRedraftTradeCapTransfersInTransactionMock).toHaveBeenCalledTimes(1)
    expect(applyRedraftTradeCapTransfersInTransactionMock.mock.calls[0][0]).toBe(txMock)
    expect(applyRedraftTradeCapTransfersInTransactionMock.mock.calls[0][0]).not.toBe(prismaMock)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)

    // After the claim: the conditional `updateMany(status: 'pending')` is what decides which of two
    // racing finalizers may write. A cap transfer sequenced before it writes on behalf of the loser.
    const claimOrder = prismaMock.redraftTradeProposal.updateMany.mock.invocationCallOrder[0]
    const capOrder = applyRedraftTradeCapTransfersInTransactionMock.mock.invocationCallOrder[0]
    expect(claimOrder).toBeLessThan(capOrder)
  })

  it('does NOT move IDP salary when the proposal claim loses the race', async () => {
    // 🛑 THIS IS THE DOUBLE-APPLY BUG. Two finalizers (double-click, or vote-threshold against
    // commissioner-approve) both ran the cap transfer BEFORE either tried to claim, so the loser had
    // already moved salary a second time by the time it returned 409. Salary moved twice, roster once.
    acceptFixture('p-race')
    prismaMock.redraftTradeProposal.updateMany.mockResolvedValueOnce({ count: 0 })

    const res = await postAccept('p-race')

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Proposal already resolved')
    expect(applyRedraftTradeCapTransfersInTransactionMock).not.toHaveBeenCalled()
    expect(prismaMock.redraftLeagueTrade.create).not.toHaveBeenCalled()
    expect(refreshCapProjectionsMock).not.toHaveBeenCalled()
  })

  it('refreshes cap projections for both rosters after the transaction commits', async () => {
    // `IDPCapProjection` is derived and is refreshed post-commit, never inside the transaction —
    // otherwise a settlement that rolls back leaves published projections for a trade that did not
    // happen. The non-transactional `applyRedraftTradeCapTransfers` this path used to call refreshed
    // post-commit too, so dropping it here would have been a silent staleness regression.
    acceptFixture('p-proj')

    const res = await postAccept('p-proj')
    expect(res.status).toBe(200)

    expect(refreshCapProjectionsMock).toHaveBeenCalledTimes(2)
    expect(refreshCapProjectionsMock).toHaveBeenCalledWith('l-1', 'r-1')
    expect(refreshCapProjectionsMock).toHaveBeenCalledWith('l-1', 'r-2')

    const capOrder = applyRedraftTradeCapTransfersInTransactionMock.mock.invocationCallOrder[0]
    const refreshOrder = refreshCapProjectionsMock.mock.invocationCallOrder[0]
    expect(capOrder).toBeLessThan(refreshOrder)
  })

  /**
   * 🛑 THE REGRESSION GUARD FOR THE GOVERNANCE BYPASS.
   *
   * Accepting a trade in a review league must record the acceptance and STOP. If this ever goes
   * green on `resolved: true`, commissioner review is decoration again and trades execute before
   * anyone can look at them.
   */
  it('does NOT settle on accept when the league requires commissioner review', async () => {
    prismaMock.redraftTradeProposal.findFirst.mockResolvedValueOnce({
      id: 'p-rev',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      expiresAt: null,
      acceptedAt: null,
      vetoMode: 'commissioner',
      vetoThreshold: 4,
      votes: [],
      assets: [],
    })
    prismaMock.redraftRoster.findMany.mockResolvedValueOnce([
      { id: 'r-1', ownerId: 'u-1' },
      { id: 'r-2', ownerId: 'u-2' },
    ])
    prismaMock.league.findFirst.mockResolvedValueOnce({ userId: 'u-1', teams: [] })
    prismaMock.redraftTradeProposal.findUnique.mockResolvedValueOnce({
      id: 'p-rev',
      status: 'pending',
      acceptedAt: new Date(),
    })
    prismaMock.redraftTradeDecision.findFirst.mockResolvedValueOnce(null)
    prismaMock.redraftTradeDecision.create.mockResolvedValueOnce({ id: 'd-rev' })

    const { POST } = await import('../app/api/redraft/trade-votes/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trade-votes', {
      method: 'POST',
      body: { proposalId: 'p-rev', action: 'accept' },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resolved).toBe(false)
    expect(body.awaitingReview).toBe('commissioner')
    // Nothing moved: no cap transfer, no legacy mirror, no collusion scan.
    expect(applyRedraftTradeCapTransfersInTransactionMock).not.toHaveBeenCalled()
    expect(prismaMock.redraftLeagueTrade.create).not.toHaveBeenCalled()
    expect(enqueueCollusionScanMock).not.toHaveBeenCalled()
  })

  it('accepts when commissioner approves', async () => {
    prismaMock.redraftTradeProposal.findFirst.mockResolvedValueOnce({
      id: 'p-2',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      expiresAt: null,
      // The receiver has accepted; the trade is awaiting the commissioner. Approving a proposal
      // with `acceptedAt: null` is now refused — see the guard test below.
      acceptedAt: new Date('2026-09-01T00:00:00Z'),
      vetoMode: 'commissioner',
      vetoThreshold: 4,
      votes: [],
      assets: [],
    })
    prismaMock.redraftRoster.findMany.mockResolvedValueOnce([
      { id: 'r-1', ownerId: 'u-1' },
      { id: 'r-2', ownerId: 'u-2' },
    ])
    prismaMock.league.findFirst.mockResolvedValueOnce({
      userId: 'u-1',
      teams: [{ isCommissioner: true, isCoCommissioner: false }],
    })
    prismaMock.redraftTradeProposal.update.mockResolvedValueOnce({ id: 'p-2', status: 'accepted' })
    prismaMock.redraftTradeDecision.findFirst.mockResolvedValueOnce(null)
    prismaMock.redraftTradeDecision.create.mockResolvedValueOnce({ id: 'd-2' })
    prismaMock.redraftLeagueTrade.create.mockResolvedValueOnce({
      id: 'legacy-trade-2',
      leagueId: 'l-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
    })

    const { POST } = await import('../app/api/redraft/trade-votes/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trade-votes', {
      method: 'POST',
      body: { proposalId: 'p-2', action: 'commissioner_approve' },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.proposal.status).toBe('accepted')
    expect(body.resolved).toBe(true)
    expect(validateRedraftTradeCapMock).toHaveBeenCalledTimes(1)
    expect(applyRedraftTradeCapTransfersInTransactionMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.redraftLeagueTrade.create).toHaveBeenCalledTimes(1)
    expect(enqueueCollusionScanMock).toHaveBeenCalledTimes(1)
    // ⚠ The role is PASSED, not derived: there is no `vote_passed` market event and the vote path
    // sends no terminal type, so a derived role would record a league vote as an ordinary user
    // accept — the exact governance blurring this evidence exists to prevent.
    expect(prismaMock.tradeExecutionSnapshot.create.mock.calls[0][0].data.executedByActorRole).toBe('commissioner')
  })

  it('accepts when league vote approval threshold is reached', async () => {
    prismaMock.redraftTradeProposal.findFirst.mockResolvedValueOnce({
      id: 'p-3',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      expiresAt: null,
      // Voting opens only after the receiver accepts — a league cannot vote through a trade
      // nobody agreed to.
      acceptedAt: new Date('2026-09-01T00:00:00Z'),
      vetoMode: 'league_vote',
      vetoThreshold: 1,
      votes: [],
      assets: [],
    })
    prismaMock.redraftRoster.findMany.mockResolvedValueOnce([
      { id: 'r-1', ownerId: 'u-1' },
      { id: 'r-2', ownerId: 'u-3' },
      { id: 'r-4', ownerId: 'u-2' },
    ])
    prismaMock.league.findFirst.mockResolvedValueOnce({ userId: 'u-1', teams: [] })
    prismaMock.redraftTradeVote.findFirst.mockResolvedValueOnce(null)
    prismaMock.redraftTradeVote.create.mockResolvedValueOnce({ id: 'v-1', vote: 'approve' })
    prismaMock.redraftTradeVote.findMany.mockResolvedValueOnce([{ id: 'v-1', vote: 'approve' }])
    prismaMock.redraftTradeProposal.update.mockResolvedValueOnce({ id: 'p-3', status: 'accepted' })
    prismaMock.redraftTradeDecision.findFirst.mockResolvedValueOnce(null)
    prismaMock.redraftTradeDecision.create.mockResolvedValueOnce({ id: 'd-3' })
    prismaMock.redraftLeagueTrade.create.mockResolvedValueOnce({
      id: 'legacy-trade-3',
      leagueId: 'l-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
    })

    const { POST } = await import('../app/api/redraft/trade-votes/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trade-votes', {
      method: 'POST',
      body: { proposalId: 'p-3', action: 'vote_approve' },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.proposal.status).toBe('accepted')
    expect(body.resolved).toBe(true)
    expect(body.approveCount).toBe(1)
    expect(validateRedraftTradeCapMock).toHaveBeenCalledTimes(1)
    expect(applyRedraftTradeCapTransfersInTransactionMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.redraftLeagueTrade.create).toHaveBeenCalledTimes(1)
    expect(enqueueCollusionScanMock).toHaveBeenCalledTimes(1)
    // ⚠ The role is PASSED, not derived: there is no `vote_passed` market event and the vote path
    // sends no terminal type, so a derived role would record a league vote as an ordinary user
    // accept — the exact governance blurring this evidence exists to prevent.
    expect(prismaMock.tradeExecutionSnapshot.create.mock.calls[0][0].data.executedByActorRole).toBe('league_vote')
  })
})

describe('Redraft playoff generate route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1' } })
  })

  it('generates seeds, rounds, and matchups', async () => {
    prismaMock.redraftSeason.findFirst.mockResolvedValueOnce({
      id: 's-1',
      leagueId: 'l-1',
      rosters: [
        { id: 'r-1', wins: 10, pointsFor: 1200, pointsAgainst: 900 },
        { id: 'r-2', wins: 9, pointsFor: 1100, pointsAgainst: 980 },
        { id: 'r-3', wins: 8, pointsFor: 1050, pointsAgainst: 1000 },
        { id: 'r-4', wins: 7, pointsFor: 1020, pointsAgainst: 1010 },
      ],
      playoffBracket: null,
    })

    prismaMock.league.findFirst.mockResolvedValueOnce({
      userId: 'u-1',
      teams: [],
    })

    prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        redraftPlayoffMatchup: {
          deleteMany: vi.fn(),
          create: vi
            .fn()
            .mockResolvedValueOnce({ id: 'm-1' })
            .mockResolvedValueOnce({ id: 'm-2' })
            .mockResolvedValueOnce({ id: 'm-3' }),
          update: vi.fn().mockResolvedValue({ id: 'm-1' }),
        },
        redraftPlayoffRound: {
          deleteMany: vi.fn(),
          create: vi
            .fn()
            .mockResolvedValueOnce({ id: 'round-1', roundNumber: 1 })
            .mockResolvedValueOnce({ id: 'round-2', roundNumber: 2 }),
          findMany: vi.fn().mockResolvedValue([{ id: 'round-1', matchups: [] }, { id: 'round-2', matchups: [] }]),
        },
        redraftPlayoffSeed: {
          deleteMany: vi.fn(),
          createMany: vi.fn().mockResolvedValue({ count: 4 }),
        },
        redraftPlayoffBracket: {
          upsert: vi.fn().mockResolvedValue({ id: 'b-1', seasonId: 's-1' }),
        },
      }
      return cb(tx)
    })

    const { POST } = await import('../app/api/redraft/playoffs/generate/route')
    const req = createMockNextRequest('http://localhost/api/redraft/playoffs/generate', {
      method: 'POST',
      body: { seasonId: 's-1', playoffTeams: 4, regenerate: true },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary.playoffTeams).toBe(4)
    expect(body.summary.rounds).toBe(2)
  })
})
