/**
 * Fantasy OS Suite — Phase D Increment 5.
 *
 * Contract test for `/api/decision-os/user-os`: mirrors the existing
 * `/api/decision-os/manager-intelligence` route's contract exactly (session-gated 401, `leagueId`
 * required 400, otherwise call the composition with the SESSION user's own id and return the
 * snapshot as-is). No DB, no network — `resolveUserOsSnapshot` is mocked; this file only proves the
 * route's dispatch contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getServerSessionMock, resolveUserOsSnapshotMock, authorizeLeagueReadMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  resolveUserOsSnapshotMock: vi.fn(),
  authorizeLeagueReadMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/decision-os/userOs', () => ({
  resolveUserOsSnapshot: resolveUserOsSnapshotMock,
}))
vi.mock('@/lib/decision-os/leagueReadAuthorization', () => ({
  authorizeLeagueRead: authorizeLeagueReadMock,
}))

import { GET } from '@/app/api/decision-os/user-os/route'

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}

describe('/api/decision-os/user-os route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'member' })
  })

  it('requires a session (401)', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await GET(req('http://localhost/api/decision-os/user-os?leagueId=L1'))
    expect(res.status).toBe(401)
    expect(resolveUserOsSnapshotMock).not.toHaveBeenCalled()
  })

  it('requires leagueId (400)', async () => {
    const res = await GET(req('http://localhost/api/decision-os/user-os'))
    expect(res.status).toBe(400)
    expect(resolveUserOsSnapshotMock).not.toHaveBeenCalled()
  })

  it('calls the composition with the leagueId and the SESSION user id (never a URL param), returns the snapshot as-is', async () => {
    const fakeSnapshot = { leagueId: 'L1', managerId: 'u1', available: true }
    resolveUserOsSnapshotMock.mockResolvedValue(fakeSnapshot)

    const res = await GET(req('http://localhost/api/decision-os/user-os?leagueId=L1&managerId=someone-else'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(fakeSnapshot)
    expect(resolveUserOsSnapshotMock).toHaveBeenCalledWith('L1', 'u1')
    expect(authorizeLeagueReadMock).toHaveBeenCalledWith('L1', 'u1')
  })

  // Phase OS-C6.1: real per-league membership authorization coverage — closes the `leagueTrend`
  // (league-wide data) leak this route previously had for non-members.
  it('allows a commissioner to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'commissioner' })
    resolveUserOsSnapshotMock.mockResolvedValue({ available: true })
    const res = await GET(req('http://localhost/api/decision-os/user-os?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('allows a league member to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'member' })
    resolveUserOsSnapshotMock.mockResolvedValue({ available: true })
    const res = await GET(req('http://localhost/api/decision-os/user-os?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('denies an authenticated user with no relationship to the league (403), never calling the composition — no cross-league data leakage', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: false, status: 403 })
    const res = await GET(req('http://localhost/api/decision-os/user-os?leagueId=L1'))
    expect(res.status).toBe(403)
    expect(resolveUserOsSnapshotMock).not.toHaveBeenCalled()
  })
})
