/**
 * Contract tests for `requireLegacySleeperIdentity`.
 *
 * This helper is the single gate ~19 legacy routes will depend on, so every branch is
 * covered here rather than re-proved per route. The cases that matter most are the ones
 * where a plausible-looking implementation would silently be a no-op: resolving the
 * username from the request instead of the session, or accepting a guest token on a
 * route that never opted into guests.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const requireAuthMock = vi.fn()
const findUniqueMock = vi.fn()
const verifyGuestMock = vi.fn()
const consumeRateLimitMock = vi.fn()

vi.mock('@/lib/auth-guard', () => ({ requireAuth: () => requireAuthMock() }))
vi.mock('@/lib/prisma', () => ({ prisma: { appUser: { findUnique: (a: unknown) => findUniqueMock(a) } } }))
vi.mock('@/lib/guest-mode/guestSessionToken', () => ({
  GUEST_SESSION_COOKIE_NAME: 'af_guest_session',
  verifyGuestSessionToken: (t: unknown) => verifyGuestMock(t),
}))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: (a: unknown) => consumeRateLimitMock(a),
  buildRateLimit429: () => ({ error: 'rate limited' }),
  getClientIp: () => '203.0.113.7',
}))

const { requireLegacySleeperIdentity } = await import('@/lib/legacy/requireLegacySleeperIdentity')

/** Minimal NextRequest stand-in: only the cookie jar is read. */
function reqWith(cookie?: string): NextRequest {
  return {
    cookies: { get: (name: string) => (cookie && name === 'af_guest_session' ? { value: cookie } : undefined) },
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  consumeRateLimitMock.mockReturnValue({ success: true })
})

describe('requireLegacySleeperIdentity', () => {
  it('401s an anonymous caller and never touches the database', async () => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    const res = await requireLegacySleeperIdentity(reqWith())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(401)
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('resolves the username from the AppUser -> LegacyUser link, not from the request', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'user-1' })
    findUniqueMock.mockResolvedValue({ legacyUser: { sleeperUsername: 'realowner' } })
    // Caller supplies nothing; identity must still resolve from the server-side link.
    const res = await requireLegacySleeperIdentity(reqWith())
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.identity.sleeperUsername).toBe('realowner')
      expect(res.identity.source).toBe('session')
    }
    // Keyed on the account id — the authorization key, not a body value.
    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }))
  })

  it('409s an authenticated account with no linked Sleeper profile', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'user-1' })
    findUniqueMock.mockResolvedValue({ legacyUser: null })
    const res = await requireLegacySleeperIdentity(reqWith())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(409)
  })

  it('403s when the caller names a username other than their own', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'user-1' })
    findUniqueMock.mockResolvedValue({ legacyUser: { sleeperUsername: 'realowner' } })
    const res = await requireLegacySleeperIdentity(reqWith(), { requestedUsername: 'victim' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(403)
  })

  it('allows a caller naming their own username, case-insensitively', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'user-1' })
    findUniqueMock.mockResolvedValue({ legacyUser: { sleeperUsername: 'RealOwner' } })
    const res = await requireLegacySleeperIdentity(reqWith(), { requestedUsername: 'realowner' })
    expect(res.ok).toBe(true)
  })

  it('accepts a signed guest session when the route opts in', async () => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    verifyGuestMock.mockResolvedValue({ legacyUserId: 'legacy-9', sleeperUsername: 'guesty' })
    const res = await requireLegacySleeperIdentity(reqWith('signed-token'), { allowGuest: true })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.identity.sleeperUsername).toBe('guesty')
      expect(res.identity.source).toBe('guest')
    }
  })

  it('IGNORES a guest session on a route that did not opt in', async () => {
    // The dangerous mistake: a commissioner/cross-user route silently accepting guests.
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    verifyGuestMock.mockResolvedValue({ legacyUserId: 'legacy-9', sleeperUsername: 'guesty' })
    const res = await requireLegacySleeperIdentity(reqWith('signed-token'))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(401)
    expect(verifyGuestMock).not.toHaveBeenCalled()
  })

  it('rejects an unsigned or tampered guest token', async () => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    verifyGuestMock.mockResolvedValue(null) // verification failed
    const res = await requireLegacySleeperIdentity(reqWith('forged'), { allowGuest: true })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(401)
  })

  it('still enforces the username match for guests', async () => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    verifyGuestMock.mockResolvedValue({ legacyUserId: 'legacy-9', sleeperUsername: 'guesty' })
    const res = await requireLegacySleeperIdentity(reqWith('signed-token'), {
      allowGuest: true,
      requestedUsername: 'someone-else',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(403)
  })

  it('rate-limits per actor WITH includeIpInKey — without it the key is one global bucket', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'user-1' })
    findUniqueMock.mockResolvedValue({ legacyUser: { sleeperUsername: 'realowner' } })
    await requireLegacySleeperIdentity(reqWith(), {
      rateLimit: { action: 'thing', maxRequests: 5, windowMs: 60_000 },
    })
    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ sleeperUsername: 'user-1', includeIpInKey: true, ip: '203.0.113.7' }),
    )
  })

  it('applies the rate limit AFTER the gate, so anonymous floods cannot drain it', async () => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    await requireLegacySleeperIdentity(reqWith(), {
      rateLimit: { action: 'thing', maxRequests: 5, windowMs: 60_000 },
    })
    expect(consumeRateLimitMock).not.toHaveBeenCalled()
  })

  it('429s when the actor is over the limit', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'user-1' })
    findUniqueMock.mockResolvedValue({ legacyUser: { sleeperUsername: 'realowner' } })
    consumeRateLimitMock.mockReturnValue({ success: false, retryAfterSec: 30 })
    const res = await requireLegacySleeperIdentity(reqWith(), {
      rateLimit: { action: 'thing', maxRequests: 5, windowMs: 60_000 },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(429)
  })
})
