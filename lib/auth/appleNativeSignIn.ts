import "server-only"

import { createHash } from "node:crypto"
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"

/**
 * Native Sign in with Apple, for the iOS app (ios-app/ AppleSignInHandler.swift).
 *
 * WHY NATIVE. Inside the app the website runs in a WKWebView, where the web Apple button cannot
 * work (Apple's page opens outside the app, so the session lands in Safari) and Google refuses
 * OAuth outright. So the social buttons were hidden in the app and an iPhone user had to make a
 * username and password. Apple's own sign-in sheet works in any app: the app asks it, gets a
 * signed identity token, and hands it to the page, which hands it here.
 *
 * WHAT IS CHECKED. The token is a JWT signed by Apple (keys at appleid.apple.com/auth/keys):
 * issuer Apple, audience OUR bundle id (a token Apple issued to some other app is refused), not
 * expired and minted in the last 10 minutes, and carrying the nonce THIS page asked for — the
 * page makes a random nonce, the app sends Apple its sha256, and the token comes back holding
 * that hash. A token lifted from somewhere else does not carry this page's nonce.
 *
 * THE SAME ACCOUNT AS THE WEB APPLE BUTTON. Apple's `sub` is stable per developer team, across
 * the app and the website's Services ID, and the account is linked through the same
 * `linkSocialAccountToAppUser` call the web callback makes (provider "apple"). Someone who
 * signed in with Apple on the website gets the same account in the app.
 */

const APPLE_ISSUER = "https://appleid.apple.com"
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys")
const MAX_TOKEN_AGE = "10m"

/** The iOS app's bundle id (ios-app/capacitor.config.json `appId`). */
export function appleNativeAudience(env: NodeJS.ProcessEnv = process.env): string {
  return env.APPLE_IOS_BUNDLE_ID?.trim() || "ai.allfantasy.app"
}

let defaultJwks: JWTVerifyGetKey | null = null
function appleJwks(): JWTVerifyGetKey {
  defaultJwks ??= createRemoteJWKSet(APPLE_JWKS_URL)
  return defaultJwks
}

export function sha256HexOf(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export type VerifiedAppleIdentity = {
  sub: string
  email: string | null
  emailVerified: boolean
}

/**
 * Verify an identity token from the native sheet. Returns null for anything that is not a
 * fresh token Apple issued to this app for this nonce. Never throws for a bad token.
 */
export async function verifyAppleNativeIdentityToken(
  identityToken: unknown,
  rawNonce: unknown,
  opts: { jwks?: JWTVerifyGetKey; audience?: string } = {},
): Promise<VerifiedAppleIdentity | null> {
  const token = typeof identityToken === "string" ? identityToken.trim() : ""
  const nonce = typeof rawNonce === "string" ? rawNonce.trim() : ""
  if (!token || token.length > 8192 || nonce.length < 16 || nonce.length > 256) return null
  try {
    const { payload } = await jwtVerify(token, opts.jwks ?? appleJwks(), {
      issuer: APPLE_ISSUER,
      audience: opts.audience ?? appleNativeAudience(),
      maxTokenAge: MAX_TOKEN_AGE,
      algorithms: ["RS256"],
    })
    if (typeof payload.sub !== "string" || !payload.sub) return null
    if (payload.nonce !== sha256HexOf(nonce)) return null
    const email = typeof payload.email === "string" && payload.email.includes("@") ? payload.email : null
    const emailVerified = payload.email_verified === true || payload.email_verified === "true"
    return { sub: payload.sub, email, emailVerified }
  } catch {
    return null
  }
}

/**
 * The `apple-native` credentials provider's authorize step: verify, then link exactly as the web
 * Apple callback does. Apple sends the person's name only on their FIRST sign-in, and only to
 * the device, so the page passes it along; it is display text, never identity.
 */
export async function authorizeAppleNative(credentials: Record<string, unknown> | undefined) {
  const identity = await verifyAppleNativeIdentityToken(credentials?.identityToken, credentials?.nonce)
  if (!identity) return null

  const rawName = typeof credentials?.name === "string" ? credentials.name.trim().slice(0, 80) : ""
  const { linkSocialAccountToAppUser } = await import("@/lib/auth/SocialAccountLinkingService")
  const linked = await linkSocialAccountToAppUser({
    provider: "apple",
    providerAccountId: identity.sub,
    type: "oauth",
    email: identity.email,
    emailVerified: identity.emailVerified,
    name: rawName || null,
    image: null,
  })

  const { activeAccountRestriction, ACCOUNT_SUSPENDED_ERROR } = await import("@/lib/moderation/accountSuspension")
  if (await activeAccountRestriction(linked.id)) throw new Error(ACCOUNT_SUSPENDED_ERROR)

  return {
    id: linked.id,
    email: linked.email,
    name: linked.displayName || linked.username || linked.email,
    username: linked.username,
    image: linked.avatarUrl,
  }
}
