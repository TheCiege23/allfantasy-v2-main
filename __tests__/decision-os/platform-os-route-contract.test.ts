import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  resolvePlatformOsSnapshot: vi.fn(),
  logAdminAudit: vi.fn(),
}))

vi.mock('@/lib/adminAuth', () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock('@/lib/decision-os/platformOs', () => ({
  resolvePlatformOsSnapshot: mocks.resolvePlatformOsSnapshot,
}))

vi.mock('@/lib/admin-audit', () => ({
  logAdminAudit: mocks.logAdminAudit,
}))

function req(url: string) {
  return new Request(url)
}

describe('GET /api/decision-os/platform-os', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.logAdminAudit.mockResolvedValue(undefined)
  })

  it('denies an unauthenticated caller with 401, never resolving a snapshot', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({
      ok: false,
      res: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    const { GET } = await import('@/app/api/decision-os/platform-os/route')
    const res = await GET(req('http://localhost/api/decision-os/platform-os?leagueIds=league-1'))

    expect(res.status).toBe(401)
    expect(mocks.resolvePlatformOsSnapshot).not.toHaveBeenCalled()
  })

  it('denies a signed-in but non-admin caller with 403, never resolving a snapshot', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({
      ok: false,
      res: Response.json({ error: 'Forbidden' }, { status: 403 }),
    })

    const { GET } = await import('@/app/api/decision-os/platform-os/route')
    const res = await GET(req('http://localhost/api/decision-os/platform-os?leagueIds=league-1'))

    expect(res.status).toBe(403)
    expect(mocks.resolvePlatformOsSnapshot).not.toHaveBeenCalled()
  })

  it('refuses an authorized admin with no leagueIds — never auto-discovers', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'admin-1', role: 'admin' } })

    const { GET } = await import('@/app/api/decision-os/platform-os/route')
    const res = await GET(req('http://localhost/api/decision-os/platform-os'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/leagueIds is required/i)
    expect(mocks.resolvePlatformOsSnapshot).not.toHaveBeenCalled()
  })

  it('refuses an authorized admin whose leagueIds param is empty/whitespace-only', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'admin-1', role: 'admin' } })

    const { GET } = await import('@/app/api/decision-os/platform-os/route')
    const res = await GET(req('http://localhost/api/decision-os/platform-os?leagueIds=%20,%20,'))

    expect(res.status).toBe(400)
    expect(mocks.resolvePlatformOsSnapshot).not.toHaveBeenCalled()
  })

  it('aggregates explicit, comma-separated league ids for an authorized admin', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'admin-1', role: 'admin' } })
    mocks.resolvePlatformOsSnapshot.mockResolvedValueOnce({
      totalMonitoredLeagues: 2,
      healthyLeagueCount: 2,
      atRiskLeagueCount: 0,
      unavailableLeagueCount: 0,
    })

    const { GET } = await import('@/app/api/decision-os/platform-os/route')
    const res = await GET(req('http://localhost/api/decision-os/platform-os?leagueIds=league-1, league-2 ,league-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.resolvePlatformOsSnapshot).toHaveBeenCalledWith(['league-1', 'league-2', 'league-1'])
    expect(body.totalMonitoredLeagues).toBe(2)
  })

  it('returns a partially-unavailable snapshot as a normal 200, not an error', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'admin-1', role: 'admin' } })
    mocks.resolvePlatformOsSnapshot.mockResolvedValueOnce({
      totalMonitoredLeagues: 3,
      healthyLeagueCount: 1,
      atRiskLeagueCount: 1,
      unavailableLeagueCount: 1,
    })

    const { GET } = await import('@/app/api/decision-os/platform-os/route')
    const res = await GET(req('http://localhost/api/decision-os/platform-os?leagueIds=league-1,league-2,bad-id'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.unavailableLeagueCount).toBe(1)
    expect(body.healthyLeagueCount).toBe(1)
  })

  it('logs an admin audit entry recording who queried which explicit leagues', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'admin-1', role: 'admin' } })
    mocks.resolvePlatformOsSnapshot.mockResolvedValueOnce({ totalMonitoredLeagues: 1 })

    const { GET } = await import('@/app/api/decision-os/platform-os/route')
    await GET(req('http://localhost/api/decision-os/platform-os?leagueIds=league-1'))

    expect(mocks.logAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        action: 'decision_os.platform_os.query',
        details: expect.objectContaining({ leagueIds: ['league-1'] }),
      }),
    )
  })
})
