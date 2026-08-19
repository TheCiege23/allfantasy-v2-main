// @vitest-environment node
/**
 * AF_GATE0 §3.2 / §6 — the anonymous trial session is a signed, tamper-evident token
 * (create/read). This is the substrate the dashboard reads when there's no authenticated
 * user, and the pointer the signup-migration claim resolves.
 */
import { describe, it, expect } from 'vitest'
import {
  signGuestSessionToken,
  verifyGuestSessionToken,
  GUEST_SESSION_COOKIE_NAME,
  GUEST_SESSION_MAX_AGE_SECONDS,
} from '@/lib/guest-mode/guestSessionToken'

describe('guest trial session token (create/read)', () => {
  it('round-trips a signed payload', async () => {
    const token = await signGuestSessionToken({ legacyUserId: 'legacy-123', sleeperUsername: 'theghost' })
    expect(typeof token).toBe('string')
    const verified = await verifyGuestSessionToken(token)
    expect(verified).toEqual({ legacyUserId: 'legacy-123', sleeperUsername: 'theghost' })
  })

  it('rejects a tampered / garbage token', async () => {
    const token = await signGuestSessionToken({ legacyUserId: 'legacy-123', sleeperUsername: 'theghost' })
    expect(token).toBeTruthy()
    const tampered = `${token!.slice(0, -2)}xy`
    expect(await verifyGuestSessionToken(tampered)).toBeNull()
    expect(await verifyGuestSessionToken('not-a-jwt')).toBeNull()
  })

  it('returns null for empty/undefined input', async () => {
    expect(await verifyGuestSessionToken(undefined)).toBeNull()
    expect(await verifyGuestSessionToken(null)).toBeNull()
    expect(await verifyGuestSessionToken('')).toBeNull()
  })

  it('is a distinct, HttpOnly-intended cookie with a bounded TTL (no PII beyond the pointer)', () => {
    expect(GUEST_SESSION_COOKIE_NAME).toBe('af_guest_session')
    // Bounded TTL per §3.2 (short-lived trial window, not a permanent grant).
    expect(GUEST_SESSION_MAX_AGE_SECONDS).toBeGreaterThan(0)
    expect(GUEST_SESSION_MAX_AGE_SECONDS).toBeLessThanOrEqual(60 * 60 * 24 * 30)
  })
})
