import crypto from "crypto"

import { hasAppleSigningKey } from "@/lib/auth/appleSignInEnv"

/**
 * Sign in with Apple's "client secret" is not a secret string — it is an ES256
 * JWT we sign with the .p8 key from the Apple Developer portal, and Apple
 * rejects one whose lifetime exceeds 6 months (15,777,000 s). Generating it
 * here means nobody pastes a token that silently expires half a year later.
 *
 * Synchronous on purpose: NextAuth reads `clientSecret` off the provider
 * options while it builds each request's provider list, so it is exposed as a
 * getter in lib/auth.ts and must not return a Promise.
 */

const APPLE_AUDIENCE = "https://appleid.apple.com"
/** Well inside Apple's 15,777,000 s ceiling. */
export const APPLE_SECRET_LIFETIME_S = 150 * 24 * 60 * 60
/** Re-sign long before expiry, so a long-lived process never serves a stale one. */
const REFRESH_AFTER_S = 30 * 24 * 60 * 60

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

/** Env vars hold the .p8 as one line with literal "\n" more often than not. */
export function normalizeApplePrivateKey(raw: string): string {
  return raw.trim().replace(/\\n/g, "\n")
}

export function buildAppleClientSecret(input: {
  clientId: string
  teamId: string
  keyId: string
  privateKey: string
  nowS?: number
}): string {
  const iat = input.nowS ?? Math.floor(Date.now() / 1000)
  const header = { alg: "ES256", kid: input.keyId.trim(), typ: "JWT" }
  const payload = {
    iss: input.teamId.trim(),
    iat,
    exp: iat + APPLE_SECRET_LIFETIME_S,
    aud: APPLE_AUDIENCE,
    sub: input.clientId.trim(),
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const key = crypto.createPrivateKey(normalizeApplePrivateKey(input.privateKey))
  // JWS ES256 wants the raw r||s form, not Node's default DER.
  const signature = crypto.sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" })
  return `${signingInput}.${base64url(signature)}`
}

let cached: { secret: string; issuedAtS: number; fingerprint: string } | null = null

/**
 * The client secret to hand NextAuth: generated from the signing key when one
 * is configured, else the legacy pasted APPLE_CLIENT_SECRET, else "".
 */
export function resolveAppleClientSecret(env: Record<string, string | undefined> = process.env, nowS?: number): string {
  const now = nowS ?? Math.floor(Date.now() / 1000)
  if (!hasAppleSigningKey(env)) return env.APPLE_CLIENT_SECRET?.trim() ?? ""

  const clientId = env.APPLE_CLIENT_ID ?? ""
  const teamId = env.APPLE_TEAM_ID as string
  const keyId = env.APPLE_KEY_ID as string
  const fingerprint = `${clientId}|${teamId}|${keyId}`
  if (cached && cached.fingerprint === fingerprint && now - cached.issuedAtS < REFRESH_AFTER_S) {
    return cached.secret
  }
  const secret = buildAppleClientSecret({ clientId, teamId, keyId, privateKey: env.APPLE_PRIVATE_KEY as string, nowS: now })
  cached = { secret, issuedAtS: now, fingerprint }
  return secret
}

export function __resetAppleClientSecretCache(): void {
  cached = null
}

/**
 * Apple returns the user with a cross-site POST (`response_mode=form_post`).
 * NextAuth v4's PKCE and callback-url cookies default to SameSite=Lax, which a
 * browser does NOT send on a cross-site POST — so the callback fails with
 * "PKCE code_verifier cookie was missing" and nobody can sign in with Apple.
 * Those two cookies are re-declared SameSite=None (which requires Secure).
 *
 * Names keep NextAuth's own convention, so nothing else has to change. Returns
 * {} on plain http (local dev), where SameSite=None cannot be set at all.
 */
export function appleFormPostCookies(useSecureCookies: boolean) {
  if (!useSecureCookies) return {}
  const options = { httpOnly: true, sameSite: "none" as const, path: "/", secure: true }
  return {
    pkceCodeVerifier: {
      name: "__Secure-next-auth.pkce.code_verifier",
      options: { ...options, maxAge: 60 * 15 },
    },
    callbackUrl: {
      name: "__Secure-next-auth.callback-url",
      options,
    },
  }
}
