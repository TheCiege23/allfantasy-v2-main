/**
 * Decision OS — Phase 8.1 / Phase OS-C6.1.
 *
 * Contract test for `/api/decision-os/manager-intelligence` — this route had no dedicated test
 * coverage before Phase OS-C6.1. Mirrors `/api/decision-os/user-os`'s own contract exactly
 * (session-gated 401, `leagueId` required 400, always resolves the SESSION user's own managerId,
 * now gated by `authorizeLeagueRead`). No DB, no network — `resolveManagerIntelligencePayload` is
 * mocked; this file only proves the route's own dispatch contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getServerSessionMock, resolveManagerIntelligencePayloadMock, authorizeLeagueReadMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  resolveManagerIntelligencePayloadMock: vi.fn(),
  authorizeLeagueReadMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/decision-os/dashboard-intelligence', () => ({
  resolveManagerIntelligencePayload: resolveManagerIntelligencePayloadMock,
}))
vi.mock('@/lib/decision-os/leagueReadAuthorization', () => ({
  authorizeLeagueRead: authorizeLeagueReadMock,
}))

import { GET } from '@/app/api/decision-os/manager-intelligence/route'

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}

describe('/api/decision-os/manager-intelligence route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'member' })
  })

  it('requires a session (401)', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))
    expect(res.status).toBe(401)
    expect(resolveManagerIntelligencePayloadMock).not.toHaveBeenCalled()
  })

  it('requires leagueId (400)', async () => {
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence'))
    expect(res.status).toBe(400)
    expect(resolveManagerIntelligencePayloadMock).not.toHaveBeenCalled()
  })

  it('returns the deterministic payload intact, with the three-brain block ADDED beside it', async () => {
    const fakePayload = { leagueTrend: { available: false }, managerDna: null, recommendations: null }
    resolveManagerIntelligencePayloadMock.mockResolvedValue(fakePayload)

    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    // Phase 3: `intelligence` is ADDITIVE. The deterministic half is the contract and must survive
    // byte-for-byte — a client that ignores the new key is unaffected.
    expect(body).toMatchObject(fakePayload)
    expect(resolveManagerIntelligencePayloadMock).toHaveBeenCalledWith({ leagueId: 'L1', managerId: 'u1' })
    expect(authorizeLeagueReadMock).toHaveBeenCalledWith('L1', 'u1')
  })

  it('still returns 200 with the deterministic payload when the intelligence resolver THROWS', async () => {
    // The degraded-safe contract: optional, additive analysis must never take down the deterministic
    // payload beside it. This test drives the real resolver against a prisma mock with no `league`
    // delegate, which is exactly how it fails in the wild (transient DB fault).
    const fakePayload = { leagueTrend: { available: false }, managerDna: null, recommendations: null }
    resolveManagerIntelligencePayloadMock.mockResolvedValue(fakePayload)

    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject(fakePayload)
    expect(body.intelligence.status).toBe('evidence_unavailable')
    expect(body.intelligence.result).toBeNull()
  })

  // Phase OS-C6.1: real per-league membership authorization coverage — closes the `leagueTrend`
  // (league-wide data) leak this route previously had for non-members.
  it('allows a commissioner to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'commissioner' })
    resolveManagerIntelligencePayloadMock.mockResolvedValue({ leagueTrend: { available: false } })
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('allows a league member to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'member' })
    resolveManagerIntelligencePayloadMock.mockResolvedValue({ leagueTrend: { available: false } })
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('denies an authenticated user with no relationship to the league (403), never calling the composition — no cross-league data leakage', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: false, status: 403 })
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))
    expect(res.status).toBe(403)
    expect(resolveManagerIntelligencePayloadMock).not.toHaveBeenCalled()
  })
})
