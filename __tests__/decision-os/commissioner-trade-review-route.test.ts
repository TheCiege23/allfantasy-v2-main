/**
 * Commissioner Intelligence Platform — Phase 4: Trade Review route test.
 *
 * Verifies the internal A1 route's gate + commissioner-auth contract with the
 * DB/resolver mocked out: default-off flag, session requirement (401),
 * commissioner requirement (403 when assertCommissioner throws), the
 * `{ enabled, data? }` envelope for data / empty, and a graceful 500.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getServerSessionMock, assertCommissionerMock, getReviewMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  assertCommissionerMock: vi.fn(),
  getReviewMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: assertCommissionerMock }))
vi.mock('@/lib/decision-os/commissioner-intelligence/trade-review', () => ({
  createLiveTradeReviewDataProvider: () => ({ getCommissionerTradeReview: getReviewMock }),
}))

import { GET } from '@/app/api/app/leagues/[leagueId]/commissioner/trade-review/route'

function call(leagueId = 'L1') {
  return GET({} as never, { params: Promise.resolve({ leagueId }) })
}

const SAMPLE = {
  version: 'commissioner-trade-review.v1',
  derivedAt: '2026-11-15T00:00:00.000Z',
  pendingTradeCount: 3,
  recentTradeCount: 5,
  reviewWindowCount: 1,
  voteCount: 4,
  tradeActivity: 'active',
  reviewWorkload: 'requires_review',
  summary: '3 trades are currently pending review. There is 1 open review window. Trade activity has been active recently.',
  caveats: [],
}

beforeEach(() => {
  getServerSessionMock.mockResolvedValue({ user: { id: 'commish-1' } })
  assertCommissionerMock.mockResolvedValue(undefined) // commissioner OK by default
  getReviewMock.mockResolvedValue(SAMPLE)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('GET /api/app/leagues/[leagueId]/commissioner/trade-review', () => {
  it('is default-off: returns { enabled:false } and never touches the resolver', async () => {
    vi.stubEnv('COMMISSIONER_TRADE_REVIEW_ENABLED', 'false')
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
    expect(getReviewMock).not.toHaveBeenCalled()
  })

  it('401 when there is no session', async () => {
    vi.stubEnv('COMMISSIONER_TRADE_REVIEW_ENABLED', 'true')
    getServerSessionMock.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('403 when the user is not a commissioner (assertCommissioner throws)', async () => {
    vi.stubEnv('COMMISSIONER_TRADE_REVIEW_ENABLED', 'true')
    assertCommissionerMock.mockRejectedValue(new Error('not commissioner'))
    const res = await call()
    expect(res.status).toBe(403)
    expect(getReviewMock).not.toHaveBeenCalled()
  })

  it('200 { enabled:true, data } for a commissioner when the resolver returns review data', async () => {
    vi.stubEnv('COMMISSIONER_TRADE_REVIEW_ENABLED', 'true')
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.data.reviewWorkload).toBe('requires_review')
    expect(getReviewMock).toHaveBeenCalledWith({ leagueId: 'L1' })
  })

  it('200 { enabled:true } (no data) when the league has no redraft season', async () => {
    vi.stubEnv('COMMISSIONER_TRADE_REVIEW_ENABLED', 'true')
    getReviewMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true })
  })

  it('500 (gracefully) when the resolver throws', async () => {
    vi.stubEnv('COMMISSIONER_TRADE_REVIEW_ENABLED', 'true')
    getReviewMock.mockRejectedValue(new Error('boom'))
    expect((await call()).status).toBe(500)
  })
})
