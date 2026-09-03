import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Covers the exact bug this file's route used to have: every commissioner-gate
 * rejection answered HTTP 403, regardless of WHY the gate rejected it. A league
 * that does not exist (404), a league Sleeper is rate-limiting us on right now
 * (429), and a genuine "you are not this league's commissioner" (403) all produced
 * the identical response shape — so a bulk import loop could not tell "this will
 * never work" from "retry in a second" from "wrong person."
 *
 * Mirrors the mocking convention already established in
 * leagues-import-routes.sleeper-preview.test.ts: mock auth-guard and the
 * commissioner gate directly, then exercise the real route handler end to end,
 * rather than unit-testing `mapGateFailureStatus` in isolation. The pipeline/
 * persistence modules downstream of a gate PASS are never reached by these
 * cases, so they need no mocks here.
 */

const requireVerifiedUserMock = vi.fn()
const assertImportCommissionerMock = vi.fn()

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: requireVerifiedUserMock,
}))

vi.mock('@/lib/league-import/commissionerGate', () => ({
  assertImportCommissioner: assertImportCommissionerMock,
  recordImportAttestation: vi.fn(),
}))

function commitRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/leagues/import/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/leagues/import/commit — gate failure status mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'u1' })
  })

  it('maps a not-found gate result to 404, not 403', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      notFound: true,
      status: 404,
      reason: 'Sleeper league 999 does not exist.',
    })
    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(commitRequest({ provider: 'sleeper', sourceId: '999' }) as any)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'LEAGUE_NOT_FOUND' })
  })

  it('maps a 429 (rate-limited) gate result to 429, not 403 or 404 — the exact distinction that used to be lost', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      notFound: false,
      status: 429,
      reason: 'Sleeper is rate-limiting us right now — this league is fine. Wait about a minute and retry.',
    })
    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(commitRequest({ provider: 'sleeper', sourceId: '12345' }) as any)
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('maps a 5xx gate result to 503, bucketed with 429 as "the provider\'s problem, retry later"', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      notFound: false,
      status: 502,
      reason: "Sleeper's API is having trouble (HTTP 502). That is on their side — retry shortly.",
    })
    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(commitRequest({ provider: 'sleeper', sourceId: '12345' }) as any)
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('still maps a plain "not the commissioner" rejection to 403 — unchanged, not swept up by the new statuses', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      notFound: false,
      reason: 'You are not a member of that Sleeper league.',
    })
    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(commitRequest({ provider: 'sleeper', sourceId: '12345' }) as any)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: 'NOT_COMMISSIONER' })
  })

  it('still maps requiresAttestation to 403 with ATTESTATION_REQUIRED — unchanged by this fix', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      requiresAttestation: true,
      reason: 'Confirm you are authorized to import this league.',
    })
    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(commitRequest({ provider: 'sleeper', sourceId: '12345' }) as any)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: 'ATTESTATION_REQUIRED', requiresAttestation: true })
  })
})
