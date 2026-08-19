import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const sportsPlayerFindManyMock = vi.fn()
const fetchRIPlayersMock = vi.fn()
const fetchRITeamsMock = vi.fn()
const revalidateTagMock = vi.fn()
const requireAdminOrBearerMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsPlayer: { findMany: sportsPlayerFindManyMock } },
}))

vi.mock('next/cache', () => ({ revalidateTag: revalidateTagMock }))

vi.mock('@/lib/adminAuth', () => ({
  requireAdminOrBearer: requireAdminOrBearerMock,
}))

vi.mock('@/lib/players/ri-players-server', () => ({
  fetchRIPlayers: fetchRIPlayersMock,
  fetchRITeams: fetchRITeamsMock,
  normalizeRIRouteSport: (s: string) => String(s).toUpperCase(),
}))

/** Each test uses a unique IP so the in-process bucket map can't bleed between them. */
function searchReq(ip: string, query = 'q=Mahomes') {
  return new Request(`http://localhost/api/players/search?${query}`, {
    headers: { 'x-forwarded-for': ip },
  })
}

describe('GET /api/players/search — rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sportsPlayerFindManyMock.mockResolvedValue([])
  })

  it('caps `limit` so one request cannot drain the catalog', async () => {
    const { GET } = await import('@/app/api/players/search/route')

    // Above the cap -> rejected outright rather than silently returning 95k rows.
    const res = await GET(searchReq('10.0.0.1', 'q=Mahomes&limit=100000'))
    expect(res.status).toBe(400)

    const ok = await GET(searchReq('10.0.0.2', 'q=Mahomes&limit=50'))
    expect(ok.status).toBe(200)
    expect(sportsPlayerFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    )
  })

  it('returns 429 with Retry-After once one IP exhausts its window', async () => {
    const { GET } = await import('@/app/api/players/search/route')
    const ip = '10.0.1.1'

    for (let i = 0; i < 30; i++) {
      expect((await GET(searchReq(ip))).status).toBe(200)
    }

    const blocked = await GET(searchReq(ip))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()
  })

  // The load-bearing case. A degenerate bucket key (dropping `includeIpInKey`)
  // still produces a 429 in the test above, so exhaustion alone proves nothing —
  // only an independent second caller distinguishes a per-IP limit from one
  // global window shared by the whole deployment.
  it('gives a second IP an independent budget after the first is exhausted', async () => {
    const { GET } = await import('@/app/api/players/search/route')
    const noisy = '10.0.2.1'

    for (let i = 0; i < 30; i++) await GET(searchReq(noisy))
    expect((await GET(searchReq(noisy))).status).toBe(429)

    const bystander = await GET(searchReq('10.0.2.2'))
    expect(bystander.status).toBe(200)
  })
})

describe('POST /api/players/sync — admin gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchRIPlayersMock.mockResolvedValue([])
    fetchRITeamsMock.mockResolvedValue([])
  })

  // Must be a real NextRequest: the route reads `req.nextUrl`, which a plain
  // Request does not have.
  function syncReq(ip: string) {
    return new NextRequest('http://localhost/api/players/sync?sport=NFL', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
    })
  }

  it('rejects unauthenticated callers WITHOUT doing the expensive work', async () => {
    const { NextResponse } = await import('next/server')
    requireAdminOrBearerMock.mockResolvedValue({
      ok: false,
      res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    const { POST } = await import('@/app/api/players/sync/route')
    const res = await POST(syncReq('10.0.3.1'))

    expect(res.status).toBe(401)
    // The point of the gate: no upstream Rolling Insights fetch, no cache bust.
    expect(fetchRIPlayersMock).not.toHaveBeenCalled()
    expect(fetchRITeamsMock).not.toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('allows an admin through', async () => {
    requireAdminOrBearerMock.mockResolvedValue({ ok: true, user: { role: 'admin' } })

    const { POST } = await import('@/app/api/players/sync/route')
    const res = await POST(syncReq('10.0.4.1'))

    expect(res.status).toBe(200)
    expect(fetchRIPlayersMock).toHaveBeenCalled()
    expect(revalidateTagMock).toHaveBeenCalledWith('ri-players-nfl')
  })
})
