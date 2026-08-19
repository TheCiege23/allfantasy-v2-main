import { SignJWT, jwtVerify } from 'jose'
import { resolveAuthSecret } from '@/lib/auth/resolve-auth-secret'

/**
 * Signed, HttpOnly guest-session cookie for the no-login Legacy import path.
 * Deliberately a SEPARATE cookie/key from NextAuth's own session -- this
 * never grants real AppUser access, it only remembers which LegacyUser a
 * guest imported so /dashboard/universal and the profile view can find it
 * again across page loads, and so Phase 3's guest->account claim step knows
 * which record to attach on signup.
 *
 * No new env var: derives its HMAC key from the same NEXTAUTH_SECRET/
 * AUTH_SECRET already configured, salted with a distinct purpose string so
 * it can never be confused with (or replayed as) a real auth token.
 */

export const GUEST_SESSION_COOKIE_NAME = 'af_guest_session'
export const GUEST_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

export interface GuestSessionPayload {
  legacyUserId: string
  sleeperUsername: string
}

function getSigningKey(): Uint8Array | null {
  const secret = resolveAuthSecret()
  if (!secret) return null
  return new TextEncoder().encode(`${secret}:guest-session:v1`)
}

export async function signGuestSessionToken(payload: GuestSessionPayload): Promise<string | null> {
  const key = getSigningKey()
  if (!key) return null
  return new SignJWT({ legacyUserId: payload.legacyUserId, sleeperUsername: payload.sleeperUsername })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${GUEST_SESSION_MAX_AGE_SECONDS}s`)
    .sign(key)
}

export async function verifyGuestSessionToken(token: string | null | undefined): Promise<GuestSessionPayload | null> {
  if (!token) return null
  const key = getSigningKey()
  if (!key) return null
  try {
    const { payload } = await jwtVerify(token, key)
    const legacyUserId = typeof payload.legacyUserId === 'string' ? payload.legacyUserId : null
    const sleeperUsername = typeof payload.sleeperUsername === 'string' ? payload.sleeperUsername : null
    if (!legacyUserId || !sleeperUsername) return null
    return { legacyUserId, sleeperUsername }
  } catch {
    return null
  }
}
