import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * The native reversal route sends the league notice — only after a reversal that actually happened.
 *
 * Mirrors `trade-reversal-route.test.ts`'s mocks; kept separate so neither suite has to grow to cover the
 * other. The engine and the notice helper are both mocked: what is pinned is the ROUTE's sequencing.
 */

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const reverseNativeTradeMock = vi.fn()
const noticeMock = vi.fn()

const prismaMock = {
  redraftTradeProposal: { findFirst: vi.fn() },
  league: { findFirst: vi.fn() },
}

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: assertLeagueMemberMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redraft/tradeReversal', () => ({
  reverseNativeTrade: reverseNativeTradeMock,
  evaluateNativeTradeReversalReadiness: vi.fn(),
}))
vi.mock('@/lib/trade-reversal/notice', () => ({ publishTradeReversalNotice: noticeMock }))
vi.mock('@/lib/idp/capEngine', () => ({
  validateRedraftTradeCap: vi.fn(),
  validateRedraftTradeCapInTransaction: vi.fn(),
  applyRedraftTradeCapTransfersInTransaction: vi.fn(),
  refreshCapProjections: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/integrity/enqueueCollusionScan', () => ({ enqueueCollusionScan: vi.fn() }))
vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_ACCEPTED: 'a', TRADE_PROCESSED: 'p' },
  getPlatformEvents: () => ({ emit: vi.fn(), emitInTx: vi.fn() }),
}))

const SUCCESS = {
  ok: true,
  reversalId: 'rev-1',
  eventId: 'e-1',
  playersRestored: 2,
  capRecordsRestored: 0,
  rosterIds: ['r1', 'r2'],
  noticeKey: 'redraft_trade:p-1:reversed',
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('../../app/api/redraft/trade-votes/route')
  return POST(createMockNextRequest('http://localhost/api/redraft/trade-votes', { method: 'POST', body }) as never)
}

describe('native reversal route — league notice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-commish' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
    prismaMock.league.findFirst.mockResolvedValue({ userId: 'u-commish', teams: [] })
    prismaMock.redraftTradeProposal.findFirst.mockResolvedValue({
      id: 'p-1', leagueId: 'l-1', seasonId: 's-1', status: 'accepted', expiresAt: null, votes: [], assets: [],
    })
    noticeMock.mockResolvedValue(undefined)
  })

  it('sends the notice once, with the key the reversal returned', async () => {
    reverseNativeTradeMock.mockResolvedValue(SUCCESS)
    const res = await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: 'collusion review' })

    expect(res.status).toBe(200)
    expect(noticeMock).toHaveBeenCalledTimes(1)
    expect(noticeMock).toHaveBeenCalledWith({
      leagueId: 'l-1',
      tradeId: 'p-1',
      noticeKey: 'redraft_trade:p-1:reversed',
      engine: 'native',
      actorUserId: 'u-commish',
    })
  })

  it('🛑 sends NO notice when the reversal was refused', async () => {
    reverseNativeTradeMock.mockResolvedValue({ ok: false, readiness: { ok: false, blockers: ['ALREADY_REVERSED'], drift: [] } })
    const res = await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: 'x' })
    expect(res.status).toBe(409)
    expect(noticeMock).not.toHaveBeenCalled()
  })

  it('sends no notice for a preflight, a missing reason, or a non-commissioner', async () => {
    await post({ proposalId: 'p-1', action: 'commissioner_reverse_preflight' })
    await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: ' ' })
    prismaMock.league.findFirst.mockResolvedValue({ userId: 'someone-else', teams: [] })
    await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: 'x' })
    expect(noticeMock).not.toHaveBeenCalled()
  })

  it('⚠ a notice that fails does not turn a committed reversal into an error', async () => {
    // If this returned an error the commissioner would retry, be refused ALREADY_REVERSED, and have no
    // way to tell that the first attempt had in fact worked.
    reverseNativeTradeMock.mockResolvedValue(SUCCESS)
    noticeMock.mockRejectedValue(new Error('fanout down'))
    const res = await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: 'x' })
    expect(res.status).toBe(200)
    expect((await res.json()).reversalId).toBe('rev-1')
  })
})
