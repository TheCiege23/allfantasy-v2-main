export type SocialProvider =
  | 'google'
  | 'spotify'
  | 'apple'
  | 'facebook'
  | 'instagram'
  | 'x'
  | 'tiktok'
  | 'discord'

/**
 * Providers that are (or may become) technically configured but are manually
 * suspended for a business/compliance reason unrelated to env config — e.g.
 * a platform under active review. Checked before any per-provider config
 * check so the override applies uniformly everywhere this resolver is used
 * (login, signup, any future consumer), instead of being duplicated as a
 * one-off flag in a single page's UI.
 *
 * Update this set directly once the underlying reason resolves. Do not infer
 * suspension from env vars — this is a deliberate, manual override.
 */
const MANUALLY_SUSPENDED_PROVIDERS = new Set<SocialProvider>([
  'facebook', // Meta platform review — re-enable once resolved
])

/**
 * Explicit per-provider override for a manual suspension, so going live is an
 * env flip instead of a code change. Facebook's whole stack (NextAuth
 * provider, signIn callback, this resolver) is already built; the suspension
 * exists only because the Meta app was under platform review. Once the Meta
 * app is Live with Facebook Login configured, setting
 * NEXT_PUBLIC_ENABLE_FACEBOOK_AUTH=true (plus FACEBOOK_CLIENT_ID/SECRET)
 * turns the button on everywhere. The flag is an explicit human decision —
 * exactly what the suspension comment asks for — just expressed in env
 * config rather than a deploy.
 */
function isSuspensionOverridden(provider: SocialProvider): boolean {
  if (provider === 'facebook') return process.env.NEXT_PUBLIC_ENABLE_FACEBOOK_AUTH === 'true'
  return false
}

export function isSocialProviderEnabled(provider: SocialProvider): boolean {
  if (MANUALLY_SUSPENDED_PROVIDERS.has(provider) && !isSuspensionOverridden(provider)) return false

  if (provider === 'google') {
    // Accept either the explicit public flag OR (server-side) the presence of credentials.
    // On the client, GOOGLE_CLIENT_ID is not exposed, so the flag is the only signal.
    return (
      process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === 'true' ||
      !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    )
  }
  if (provider === 'spotify') {
    return !!(process.env.NEXT_PUBLIC_ENABLE_SPOTIFY_AUTH === 'true' || (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET))
  }
  if (provider === 'apple') {
    // Same shape as google/spotify/facebook — lib/auth.ts only registers
    // AppleProvider when APPLE_CLIENT_ID+APPLE_CLIENT_SECRET are both set,
    // so this must check real credential presence too, not only the public
    // flag, or the resolver can say "enabled" while lib/auth.ts never
    // actually registered the provider (and signIn('apple') then errors).
    return (
      process.env.NEXT_PUBLIC_ENABLE_APPLE_AUTH === 'true' ||
      !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET)
    )
  }
  if (provider === 'facebook') {
    // Accept the explicit public flag OR (server-side) the presence of credentials.
    // (Currently unreachable while 'facebook' is in MANUALLY_SUSPENDED_PROVIDERS above.)
    return (
      process.env.NEXT_PUBLIC_ENABLE_FACEBOOK_AUTH === 'true' ||
      !!(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET)
    )
  }
  if (provider === 'x') {
    // No NextAuth provider is wired for X/Twitter yet (lib/auth.ts has no
    // TwitterProvider). This flag exists so callers can flip it on the moment
    // a real provider lands, same forward-compat shape as facebook/spotify.
    return process.env.NEXT_PUBLIC_ENABLE_X_AUTH === 'true'
  }
  if (provider === 'discord') {
    // DiscordProvider is now registered in lib/auth.ts (gated on DISCORD_CLIENT_ID
    // + DISCORD_CLIENT_SECRET). This is intentionally a SEPARATE credential pair
    // from the pre-existing Discord bot/account-linking integration in
    // lib/discord/constants.ts (/api/auth/discord/callback, bot-install) — do not
    // conflate the two. Client bundles can't see the server-only vars, so the
    // explicit public flag is required there; same shape as google/spotify/facebook.
    return (
      process.env.NEXT_PUBLIC_ENABLE_DISCORD_AUTH === 'true' ||
      !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)
    )
  }
  return false
}

export function getSupportedSocialProviders(): SocialProvider[] {
  return ['google', 'spotify', 'apple', 'facebook', 'instagram', 'x', 'tiktok', 'discord']
}
