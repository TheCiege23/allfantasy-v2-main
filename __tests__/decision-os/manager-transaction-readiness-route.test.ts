/**
 * Decision OS Manager Intelligence Platform — Phase 4: Transaction Readiness route.
 *
 * Verifies the internal A1 route's gate + auth contract with the DB/resolver
 * mocked out: default-off flag, session requirement (401), league membership
 * (403), the `{ enabled, data? }` envelope for data / empty, and graceful 500.
 * No DB, no network, no recommendation source.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getServerSessionMock, getLeagueRoleMock, getReadinessMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getLeagueRoleMock: vi.fn(),
  getReadinessMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: getLeagueRoleMock }))
vi.mock('@/lib/decision-os/manager-intelligence/transaction-readiness', () => ({
  createLiveTransactionReadinessDataProvider: () => ({ getManagerTransactionReadiness: getReadinessMock }),
}))

import { GET } from '@/app/api/app/leagues/[leagueId]/transaction-readiness/route'

function call(leagueId = 'L1') {
  return GET({} as never, { params: Promise.resolve({ leagueId }) })
}

const SAMPLE = {
  version: 'manager-transaction-readiness.v1',
  derivedAt: '2026-10-08T00:00:00.000Z',
  rosterPressure: 'moderate',
  benchFlexibility: 'limited',
  injuryPressure: 'moderate',
  byePressure: 'low',
  rosterOpenings: 1,
  reserveCount: 4,
  injuredReserveCount: 0,
  benchCount: 4,
  summary: 'Your roster has moderate transaction pressure this week. Bench flexibility appears limited.',
  caveats: [],
}

beforeEach(() => {
  getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
  getLeagueRoleMock.mockResolvedValue('member')
  getReadinessMock.mockResolvedValue(SAMPLE)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('GET /api/app/leagues/[leagueId]/transaction-readiness', () => {
  it('is default-off: returns { enabled:false } and never touches the resolver', async () => {
    vi.stubEnv('MANAGER_TRANSACTION_READINESS_ENABLED', 'false')
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
    expect(getReadinessMock).not.toHaveBeenCalled()
  })

  it('401 when there is no session', async () => {
    vi.stubEnv('MANAGER_TRANSACTION_READINESS_ENABLED', 'true')
    getServerSessionMock.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('403 when the user is not a league member', async () => {
    vi.stubEnv('MANAGER_TRANSACTION_READINESS_ENABLED', 'true')
    getLeagueRoleMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(403)
    expect(getReadinessMock).not.toHaveBeenCalled()
  })

  it('200 { enabled:true, data } when the resolver returns readiness', async () => {
    vi.stubEnv('MANAGER_TRANSACTION_READINESS_ENABLED', 'true')
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.data.rosterPressure).toBe('moderate')
    expect(getReadinessMock).toHaveBeenCalledWith({ userId: 'user-1', leagueId: 'L1' })
  })

  it('200 { enabled:true } (no data) when the user has no roster', async () => {
    vi.stubEnv('MANAGER_TRANSACTION_READINESS_ENABLED', 'true')
    getReadinessMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true })
  })

  it('500 (gracefully) when the resolver throws', async () => {
    vi.stubEnv('MANAGER_TRANSACTION_READINESS_ENABLED', 'true')
    getReadinessMock.mockRejectedValue(new Error('boom'))
    expect((await call()).status).toBe(500)
  })
})
