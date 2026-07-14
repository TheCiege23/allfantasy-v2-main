/**
 * MFL Commissioner Import Certification & Fantrax Product Decision phase.
 *
 * `server/api-route-modules/legacy/fantrax/route.ts` had no authentication
 * at all — any anonymous request could create/overwrite or read any
 * FantraxUser's league data by supplying an arbitrary `username`. This
 * guards the fix: both POST (upload) and GET (read) now require a real,
 * verified AllFantasy session before touching Prisma at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireVerifiedUserMock = vi.hoisted(() => vi.fn())
const fantraxUserFindUniqueMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: requireVerifiedUserMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantraxUser: { findUnique: fantraxUserFindUniqueMock, create: vi.fn() },
    fantraxLeague: { upsert: vi.fn() },
  },
}))

vi.mock('@/lib/fantrax-parser', () => ({
  parseFantraxFiles: vi.fn(() => ({ success: true, leagueName: 'Test League', errors: [] })),
}))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage:
    () =>
    <T extends (...args: any[]) => any>(handler: T) =>
      handler,
}))

function unauthenticatedResponse() {
  return {
    ok: false as const,
    response: new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 }),
  }
}

describe('legacy/fantrax route — authentication (Fantrax product decision phase)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POST rejects an unauthenticated upload before touching Prisma at all', async () => {
    requireVerifiedUserMock.mockResolvedValue(unauthenticatedResponse())
    const { POST } = await import('@/server/api-route-modules/legacy/fantrax/route')

    const formData = new FormData()
    formData.append('username', 'someone-elses-username')
    const req = new Request('http://localhost/api/legacy/fantrax', { method: 'POST', body: formData })

    const res = await POST(req as any)

    expect(res.status).toBe(401)
    expect(fantraxUserFindUniqueMock).not.toHaveBeenCalled()
  })

  it('GET rejects an unauthenticated read before touching Prisma at all', async () => {
    requireVerifiedUserMock.mockResolvedValue(unauthenticatedResponse())
    const { GET } = await import('@/server/api-route-modules/legacy/fantrax/route')

    const req = new Request('http://localhost/api/legacy/fantrax?username=someone-elses-username')
    const res = await GET(req as any)

    expect(res.status).toBe(401)
    expect(fantraxUserFindUniqueMock).not.toHaveBeenCalled()
  })
})
