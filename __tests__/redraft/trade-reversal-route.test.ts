import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * Route-level wiring for native trade reversal on `/api/redraft/trade-votes`.
 *
 * ⚠ A SEPARATE FILE FROM `redraft-trade-playoff-routes-contract.test.ts` ON PURPOSE. Another open PR
 * edits that suite; a third concurrent edit to the same file is a merge conflict waiting to happen.
 * The reversal engine itself is mocked here — its behaviour is pinned in
 * `native-trade-reversal.test.ts`. What this file pins is the ROUTE: which actions reach it, who may
 * call them, and that a reversal is reachable at all past the route's `pending` check.
 */

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const reverseNativeTradeMock = vi.fn()
const readinessMock = vi.fn()
const refreshCapProjectionsMock = vi.fn()

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
  evaluateNativeTradeReversalReadiness: readinessMock,
}))
vi.mock('@/lib/idp/capEngine', () => ({
  validateRedraftTradeCap: vi.fn(),
  applyRedraftTradeCapTransfersInTransaction: vi.fn(),
  refreshCapProjections: refreshCapProjectionsMock,
}))
vi.mock('@/lib/integrity/enqueueCollusionScan', () => ({ enqueueCollusionScan: vi.fn() }))
vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_ACCEPTED: 'a', TRADE_PROCESSED: 'p' },
  getPlatformEvents: () => ({ emit: vi.fn(), emitInTx: vi.fn() }),
}))

/** An ACCEPTED proposal — the state every other action here refuses before reading its action. */
function acceptedProposal() {
  prismaMock.redraftTradeProposal.findFirst.mockResolvedValue({
    id: 'p-1',
    leagueId: 'l-1',
    seasonId: 's-1',
    status: 'accepted',
    expiresAt: null,
    votes: [],
    assets: [],
  })
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('../../app/api/redraft/trade-votes/route')
  return POST(createMockNextRequest('http://localhost/api/redraft/trade-votes', { method: 'POST', body }) as never)
}

describe('native trade reversal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-commish' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
    // The league owner is a commissioner by `isCommissionerOrCo`'s own rule.
    prismaMock.league.findFirst.mockResolvedValue({ userId: 'u-commish', teams: [] })
    refreshCapProjectionsMock.mockResolvedValue(undefined)
    acceptedProposal()
  })

  it('🛑 reaches the reversal for an ACCEPTED proposal instead of refusing it as "not pending"', async () => {
    // The route refuses any non-pending proposal before dispatching on the action. Placed below that
    // check, reversal could never run — every call would 409 "Proposal is not pending".
    reverseNativeTradeMock.mockResolvedValue({
      ok: true,
      reversalId: 'rev-1',
      eventId: 'e',
      playersRestored: 2,
      capRecordsRestored: 0,
      rosterIds: ['r1', 'r2'],
    })

    const res = await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: 'collusion review' })

    expect(res.status).toBe(200)
    expect(reverseNativeTradeMock).toHaveBeenCalledWith({
      proposalId: 'p-1',
      actorUserId: 'u-commish',
      actorRole: 'commissioner',
      reason: 'collusion review',
    })
  })

  it('answers the preflight without acting', async () => {
    readinessMock.mockResolvedValue({ ok: false, blockers: ['ROSTER_CHANGED_SINCE_EXECUTION'], drift: [] })
    const res = await post({ proposalId: 'p-1', action: 'commissioner_reverse_preflight' })
    expect(res.status).toBe(200)
    expect((await res.json()).readiness.blockers).toEqual(['ROSTER_CHANGED_SINCE_EXECUTION'])
    expect(reverseNativeTradeMock).not.toHaveBeenCalled()
  })

  it('refuses a non-commissioner before touching the engine', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ userId: 'someone-else', teams: [] })
    const res = await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: 'x' })
    expect(res.status).toBe(403)
    expect(reverseNativeTradeMock).not.toHaveBeenCalled()
    expect(readinessMock).not.toHaveBeenCalled()
  })

  it('requires a reason for the destructive action', async () => {
    const res = await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: '   ' })
    expect(res.status).toBe(400)
    expect(reverseNativeTradeMock).not.toHaveBeenCalled()
  })

  it('surfaces a refusal as 409 with the readiness that explains it', async () => {
    reverseNativeTradeMock.mockResolvedValue({
      ok: false,
      readiness: { ok: false, blockers: ['NO_EXECUTION_SNAPSHOT'], drift: [] },
    })
    const res = await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: 'x' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('REVERSAL_BLOCKED')
    expect(body.readiness.blockers).toEqual(['NO_EXECUTION_SNAPSHOT'])
  })

  it('refreshes cap projections only after a reversal that moved cap records', async () => {
    reverseNativeTradeMock.mockResolvedValue({
      ok: true,
      reversalId: 'rev-1',
      eventId: 'e',
      playersRestored: 1,
      capRecordsRestored: 1,
      rosterIds: ['r1', 'r2'],
    })
    await post({ proposalId: 'p-1', action: 'commissioner_reverse', reason: 'x' })
    expect(refreshCapProjectionsMock).toHaveBeenCalledTimes(2)
    expect(refreshCapProjectionsMock).toHaveBeenCalledWith('l-1', 'r1')
    expect(refreshCapProjectionsMock).toHaveBeenCalledWith('l-1', 'r2')
  })

  it('leaves the existing pending check in force for every other action', async () => {
    // Reversal was inserted ABOVE the pending check; the other actions must still be stopped by it.
    const res = await post({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Proposal is not pending')
  })
})
