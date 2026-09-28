/**
 * "Is Sign in with Apple configured?" — the ONE answer lib/auth.ts, the social
 * provider resolver, connected accounts and user settings share.
 *
 * Two ways to configure it, and the first is the one to use:
 *
 *  1. APPLE_CLIENT_ID + APPLE_TEAM_ID + APPLE_KEY_ID + APPLE_PRIVATE_KEY.
 *     The client secret is GENERATED from the .p8 key (lib/auth/appleClientSecret)
 *     and renewed automatically, so it never expires.
 *  2. APPLE_CLIENT_ID + APPLE_CLIENT_SECRET — a pre-signed JWT pasted in.
 *     ⚠ Apple caps that JWT at 6 months. When it lapses, Apple sign-in fails
 *     for everyone with no deploy and no warning. Kept only so an existing
 *     setup does not break; prefer (1).
 *
 * No crypto here on purpose: SocialProviderResolver is bundled into client
 * components, and a Node `crypto` import would break the browser build.
 */

type Env = Record<string, string | undefined>

function present(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0
}

export function hasAppleSigningKey(env: Env = process.env): boolean {
  return present(env.APPLE_TEAM_ID) && present(env.APPLE_KEY_ID) && present(env.APPLE_PRIVATE_KEY)
}

export function hasAppleSignInCredentials(env: Env = process.env): boolean {
  return present(env.APPLE_CLIENT_ID) && (hasAppleSigningKey(env) || present(env.APPLE_CLIENT_SECRET))
}
