// @vitest-environment node
/**
 * Import Certification Phase A — `app/api/auth/mfl/route.ts` safety gate.
 *
 * Before this phase the route had NO session check at all: an anonymous caller could POST a
 * username/password, cause this server to authenticate against myfantasyleague.com, and write
 * a plaintext token to `MFLConnection` — a table the league importer never reads.
 *
 * These are behavioral tests against the real route module (only its collaborators are
 * mocked), so they fail if the guard is removed or the endpoint starts accepting credentials
 * again. They deliberately assert on OBSERVABLE EFFECTS — no outbound fetch, no Prisma write,
 * no secret echoed — rather than on the source text of the handler.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, requireVerifiedUserMock, fetchMock } = vi.hoisted(() => ({
  prismaMock: {
    mFLConnection: {
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  requireVerifiedUserMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: requireVerifiedUserMock }))

import { POST, MFL_CONNECTION_DISABLED_CODE } from '@/app/api/auth/mfl/route'

const ROUTE_URL = 'http://localhost/api/auth/mfl'
/**
 * Deliberately fake, obviously-not-a-credential literal. Its only job is to be a
 * recognizable needle we can assert never appears in the response body.
 */
const SECRET_PASSWORD = 'dummy-value-for-echo-assertion-only'

function postRequest(body: unknown) {
  return new NextRequest(ROUTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Every Prisma mutation the old handler could reach. */
function totalPrismaWrites(): number {
  const c = prismaMock.mFLConnection
  return (
    c.upsert.mock.calls.length +
    c.create.mock.calls.length +
    c.update.mock.calls.length +
    c.delete.mock.calls.length +
    c.deleteMany.mock.calls.length
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'app-user-1' })
})

describe('POST /api/auth/mfl — Phase A safety gate', () => {
  it('rejects an anonymous caller with 401 and never reaches the disabled-path response', async () => {
    requireVerifiedUserMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 }),
    })

    const res = await POST(postRequest({ username: 'someone', password: SECRET_PASSWORD }))

    expect(res.status).toBe(401)
    // The regression that mattered: an unauthenticated request must not cause a write.
    expect(totalPrismaWrites()).toBe(0)
  })

  it('never contacts myfantasyleague.com, even with a well-formed credential payload', async () => {
    await POST(postRequest({ username: 'someone', password: SECRET_PASSWORD, year: 2026 }))

    const contactedMfl = fetchMock.mock.calls.some(([input]) =>
      String(input).includes('myfantasyleague.com'),
    )
    expect(contactedMfl).toBe(false)
  })

  it('returns 503 unavailable for an authenticated caller and stores no credential', async () => {
    const res = await POST(postRequest({ username: 'someone', password: SECRET_PASSWORD }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe(MFL_CONNECTION_DISABLED_CODE)
    expect(body.connected).toBe(false)
    expect(totalPrismaWrites()).toBe(0)
  })

  it('never echoes the submitted password back to the caller', async () => {
    const res = await POST(postRequest({ username: 'someone', password: SECRET_PASSWORD }))
    const raw = await res.text()

    expect(raw).not.toContain(SECRET_PASSWORD)
  })

  it('does not imply the credentials were wrong — it reports unavailability, not a 401 login failure', async () => {
    const res = await POST(postRequest({ username: 'someone', password: SECRET_PASSWORD }))
    const body = await res.json()

    // A 401 here would tell the user to go fix their MFL password, which is misleading:
    // no credential is evaluated at all.
    expect(res.status).not.toBe(401)
    expect(String(body.error).toLowerCase()).not.toContain('invalid credentials')
    expect(String(body.error).toLowerCase()).toContain('unavailable')
  })

  it('does not promise that an API key can be saved somewhere, since no such screen exists', async () => {
    const res = await POST(postRequest({ username: 'someone', password: SECRET_PASSWORD }))
    const message = String((await res.json()).error).toLowerCase()

    // It may state that an API key is REQUIRED; it must not instruct the user to go save one.
    expect(message).not.toMatch(/save your .*api key|save an? .*api key in/)
  })
})
