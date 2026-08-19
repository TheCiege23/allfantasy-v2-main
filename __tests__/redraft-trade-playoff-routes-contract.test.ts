import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from './helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const validateRedraftTradeCapMock = vi.fn()
const applyRedraftTradeCapTransfersMock = vi.fn()
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
  // Settlement runs inside a $transaction; execute the callback with the mock client as the tx.
  $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock)),
}

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
  applyRedraftTradeCapTransfers: applyRedraftTradeCapTransfersMock,
}))

vi.mock('@/lib/integrity/enqueueCollusionScan', () => ({
  enqueueCollusionScan: enqueueCollusionScanMock,
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
    applyRedraftTradeCapTransfersMock.mockResolvedValue(undefined)
    enqueueCollusionScanMock.mockResolvedValue(undefined)
  })

  it('accepts a pending proposal by receiver owner', async () => {
    prismaMock.redraftTradeProposal.findFirst.mockResolvedValueOnce({
      id: 'p-1',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      expiresAt: null,
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
    expect(applyRedraftTradeCapTransfersMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.redraftLeagueTrade.create).toHaveBeenCalledTimes(1)
    expect(enqueueCollusionScanMock).toHaveBeenCalledTimes(1)
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
    expect(applyRedraftTradeCapTransfersMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.redraftLeagueTrade.create).toHaveBeenCalledTimes(1)
    expect(enqueueCollusionScanMock).toHaveBeenCalledTimes(1)
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
    expect(applyRedraftTradeCapTransfersMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.redraftLeagueTrade.create).toHaveBeenCalledTimes(1)
    expect(enqueueCollusionScanMock).toHaveBeenCalledTimes(1)
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
