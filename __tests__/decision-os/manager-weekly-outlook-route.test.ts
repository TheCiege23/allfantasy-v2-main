/**
 * Decision OS Manager Intelligence Platform — Phase 3: Weekly Outlook route.
 *
 * Verifies the internal A1 route's gate + auth contract with the DB/resolver
 * mocked out: default-off flag, session requirement (401), league membership
 * (403), the `{ enabled, data? }` envelope for data / empty, and graceful 500.
 * No DB, no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getServerSessionMock, getLeagueRoleMock, getOutlookMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getLeagueRoleMock: vi.fn(),
  getOutlookMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: getLeagueRoleMock }))
vi.mock('@/lib/decision-os/manager-intelligence/weekly-outlook', () => ({
  createLiveWeeklyOutlookDataProvider: () => ({ getManagerWeeklyOutlook: getOutlookMock }),
}))

import { GET } from '@/app/api/app/leagues/[leagueId]/weekly-outlook/route'

function call(leagueId = 'L1') {
  return GET({} as never, { params: Promise.resolve({ leagueId }) })
}

const SAMPLE = {
  version: 'manager-weekly-outlook.v1',
  derivedAt: '2026-10-01T00:00:00.000Z',
  week: 5,
  matchupState: 'scheduled',
  opponentName: 'The Rivals',
  projectedPointsFor: 110,
  projectedPointsAgainst: 100,
  projectedMargin: 'favored',
  lineupReadiness: 'ready',
  schedulePressure: 'normal',
  summary: 'Your Week 5 matchup against The Rivals projects as favored. Your lineup appears ready.',
  caveats: [],
}

beforeEach(() => {
  getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
  getLeagueRoleMock.mockResolvedValue('member')
  getOutlookMock.mockResolvedValue(SAMPLE)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('GET /api/app/leagues/[leagueId]/weekly-outlook', () => {
  it('is default-off: returns { enabled:false } and never touches the resolver', async () => {
    vi.stubEnv('MANAGER_WEEKLY_OUTLOOK_ENABLED', 'false')
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
    expect(getOutlookMock).not.toHaveBeenCalled()
  })

  it('401 when there is no session', async () => {
    vi.stubEnv('MANAGER_WEEKLY_OUTLOOK_ENABLED', 'true')
    getServerSessionMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
  })

  it('403 when the user is not a league member', async () => {
    vi.stubEnv('MANAGER_WEEKLY_OUTLOOK_ENABLED', 'true')
    getLeagueRoleMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(403)
    expect(getOutlookMock).not.toHaveBeenCalled()
  })

  it('200 { enabled:true, data } when the resolver returns an outlook', async () => {
    vi.stubEnv('MANAGER_WEEKLY_OUTLOOK_ENABLED', 'true')
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.data.matchupState).toBe('scheduled')
    expect(getOutlookMock).toHaveBeenCalledWith({ userId: 'user-1', leagueId: 'L1' })
  })

  it('200 { enabled:true } (no data) when the user has no roster', async () => {
    vi.stubEnv('MANAGER_WEEKLY_OUTLOOK_ENABLED', 'true')
    getOutlookMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true })
  })

  it('500 (gracefully) when the resolver throws', async () => {
    vi.stubEnv('MANAGER_WEEKLY_OUTLOOK_ENABLED', 'true')
    getOutlookMock.mockRejectedValue(new Error('boom'))
    const res = await call()
    expect(res.status).toBe(500)
  })
})
