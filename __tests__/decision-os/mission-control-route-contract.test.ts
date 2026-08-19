/**
 * Commissioner OS Surface Alignment — Phase B Increment 5.
 *
 * Contract test for `/api/decision-os/mission-control`: mirrors the existing
 * `/api/decision-os/manager-intelligence` route's contract exactly (session-gated 401,
 * `leagueId` required 400, otherwise call the composition and return it as-is). No DB, no
 * network — `resolveMissionControlSnapshot` is mocked; this file only proves the route's own
 * dispatch contract.
 *
 * Phase OS-C6.1: added real per-league membership authorization coverage — `authorizeLeagueRead`
 * is mocked so this file can prove the route's own dispatch of allow/deny decisions without a real
 * Prisma call; `authorizeLeagueRead`'s own logic is covered separately by
 * `league-read-authorization.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getServerSessionMock, resolveMissionControlSnapshotMock, authorizeLeagueReadMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  resolveMissionControlSnapshotMock: vi.fn(),
  authorizeLeagueReadMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/decision-os/missionControl', () => ({
  resolveMissionControlSnapshot: resolveMissionControlSnapshotMock,
}))
vi.mock('@/lib/decision-os/leagueReadAuthorization', () => ({
  authorizeLeagueRead: authorizeLeagueReadMock,
}))

import { GET } from '@/app/api/decision-os/mission-control/route'

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}

describe('/api/decision-os/mission-control route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'commissioner' })
  })

  it('requires a session (401)', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await GET(req('http://localhost/api/decision-os/mission-control?leagueId=L1'))
    expect(res.status).toBe(401)
    expect(resolveMissionControlSnapshotMock).not.toHaveBeenCalled()
  })

  it('requires leagueId (400)', async () => {
    const res = await GET(req('http://localhost/api/decision-os/mission-control'))
    expect(res.status).toBe(400)
    expect(resolveMissionControlSnapshotMock).not.toHaveBeenCalled()
  })

  it('calls the composition with the given leagueId and returns its snapshot as-is', async () => {
    const fakeSnapshot = { leagueId: 'L1', leagueHealth: { available: true }, recommendedActions: [] }
    resolveMissionControlSnapshotMock.mockResolvedValue(fakeSnapshot)

    const res = await GET(req('http://localhost/api/decision-os/mission-control?leagueId=L1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(fakeSnapshot)
    expect(resolveMissionControlSnapshotMock).toHaveBeenCalledWith('L1')
    expect(authorizeLeagueReadMock).toHaveBeenCalledWith('L1', 'u1')
  })

  // Phase OS-C6.1: real per-league membership authorization coverage.
  it('allows a commissioner to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'commissioner' })
    resolveMissionControlSnapshotMock.mockResolvedValue({ leagueHealth: { available: true } })
    const res = await GET(req('http://localhost/api/decision-os/mission-control?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('allows a league member to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'member' })
    resolveMissionControlSnapshotMock.mockResolvedValue({ leagueHealth: { available: true } })
    const res = await GET(req('http://localhost/api/decision-os/mission-control?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('denies an authenticated user with no relationship to the league (403), never calling the composition — no cross-league data leakage', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: false, status: 403 })
    const res = await GET(req('http://localhost/api/decision-os/mission-control?leagueId=L1'))
    expect(res.status).toBe(403)
    expect(resolveMissionControlSnapshotMock).not.toHaveBeenCalled()
  })
})
