/**
 * Commissioner OS Demo Breadth — Phase C Increment 4.
 *
 * Contract test for `/api/decision-os/league-analytics`: mirrors the existing
 * `/api/decision-os/mission-control` route's contract exactly (session-gated 401, `leagueId`
 * required 400, otherwise call the composition and return it as-is). No DB, no network —
 * `resolveLeagueAnalyticsSnapshot` is mocked; this file only proves the route's dispatch contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getServerSessionMock, resolveLeagueAnalyticsSnapshotMock, authorizeLeagueReadMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  resolveLeagueAnalyticsSnapshotMock: vi.fn(),
  authorizeLeagueReadMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/decision-os/leagueAnalytics', () => ({
  resolveLeagueAnalyticsSnapshot: resolveLeagueAnalyticsSnapshotMock,
}))
vi.mock('@/lib/decision-os/leagueReadAuthorization', () => ({
  authorizeLeagueRead: authorizeLeagueReadMock,
}))

import { GET } from '@/app/api/decision-os/league-analytics/route'

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}

describe('/api/decision-os/league-analytics route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'commissioner' })
  })

  it('requires a session (401)', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await GET(req('http://localhost/api/decision-os/league-analytics?leagueId=L1'))
    expect(res.status).toBe(401)
    expect(resolveLeagueAnalyticsSnapshotMock).not.toHaveBeenCalled()
  })

  it('requires leagueId (400)', async () => {
    const res = await GET(req('http://localhost/api/decision-os/league-analytics'))
    expect(res.status).toBe(400)
    expect(resolveLeagueAnalyticsSnapshotMock).not.toHaveBeenCalled()
  })

  it('calls the composition with the given leagueId and returns its snapshot as-is', async () => {
    const fakeSnapshot = { leagueId: 'L1', available: true, retentionRiskCount: 0 }
    resolveLeagueAnalyticsSnapshotMock.mockResolvedValue(fakeSnapshot)

    const res = await GET(req('http://localhost/api/decision-os/league-analytics?leagueId=L1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(fakeSnapshot)
    expect(resolveLeagueAnalyticsSnapshotMock).toHaveBeenCalledWith('L1')
    expect(authorizeLeagueReadMock).toHaveBeenCalledWith('L1', 'u1')
  })

  // Phase OS-C6.1: real per-league membership authorization coverage.
  it('allows a commissioner to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'commissioner' })
    resolveLeagueAnalyticsSnapshotMock.mockResolvedValue({ available: true })
    const res = await GET(req('http://localhost/api/decision-os/league-analytics?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('allows a league member to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'member' })
    resolveLeagueAnalyticsSnapshotMock.mockResolvedValue({ available: true })
    const res = await GET(req('http://localhost/api/decision-os/league-analytics?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('denies an authenticated user with no relationship to the league (403), never calling the composition — no cross-league data leakage', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: false, status: 403 })
    const res = await GET(req('http://localhost/api/decision-os/league-analytics?leagueId=L1'))
    expect(res.status).toBe(403)
    expect(resolveLeagueAnalyticsSnapshotMock).not.toHaveBeenCalled()
  })
})
