import { prisma } from '@/lib/prisma'

/**
 * ONE place that turns "this AllFantasy user" into "a usable Spotify access token".
 *
 * Tokens live in two stores, because two flows write them: NextAuth sign-in writes
 * `AuthAccount`, the settings connect flow writes both `AuthAccount` and the legacy
 * `UserProfile.spotify*` columns. AuthAccount wins when present. This logic used to live
 * inline in /api/spotify/token; the playlist and play routes need exactly the same answer,
 * and a second copy of a refresh path is how the two stores drift.
 *
 * ⚠ NEVER LOG A TOKEN OR A FULL REQUEST BODY FROM HERE. Status codes only.
 */

type StoredSpotifyPrefs = {
  isPremium?: unknown
  /** Set only when isPremium came from Spotify's own `product` field. */
  premiumSource?: unknown
  displayName?: unknown
}

export type SpotifyAccess =
  | {
      ok: true
      accessToken: string
      expiresAtMs: number
      /** The scope string Spotify granted, or null when it was never recorded. */
      scope: string | null
      /** true / false when Spotify told us; null when it did not. See describePlaybackGap. */
      isPremium: boolean | null
      displayName: string | null
    }
  | { ok: false; reason: 'not_configured' | 'not_connected' | 'refresh_failed' | 'expired' }

/** Refresh five minutes early so a token never expires mid-request. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

/**
 * ⚠ A STORED `false` IS ONLY TRUSTED WHEN SPOTIFY SUPPLIED IT. Before the February 2026
 * Web API changes removed `product` from GET /v1/me in Development Mode, the callback
 * stored `product === 'premium'` — so an absent field was written as `false`, and those
 * rows cannot be told apart from a genuinely free account. Rows carrying
 * `premiumSource: 'spotify-product'` were written from a real `product` value; anything
 * else is unknown, and the Web Playback SDK's own `account_error` decides.
 */
export function readStoredPremium(prefs: StoredSpotifyPrefs): boolean | null {
  if (prefs.premiumSource !== 'spotify-product') return null
  return typeof prefs.isPremium === 'boolean' ? prefs.isPremium : null
}

export async function getSpotifyAccess(userId: string): Promise<SpotifyAccess> {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) return { ok: false, reason: 'not_configured' }

  const [profile, spotifyAccount] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        notificationPreferences: true,
        spotifyAccessToken: true,
        spotifyRefreshToken: true,
        spotifyExpiresAt: true,
        spotifyDisplayName: true,
        spotifyConnectedAt: true,
      },
    }),
    prisma.authAccount.findFirst({
      where: { userId, provider: 'spotify' },
      select: {
        id: true,
        access_token: true,
        refresh_token: true,
        expires_at: true,
        // Required by the scope inspectors. Omitting it reports every user as
        // incapable, which is the opposite failure but equally wrong.
        scope: true,
      },
    }),
  ])

  const prefs = (profile?.notificationPreferences ?? {}) as Record<string, unknown>
  const spotify = (prefs.spotify ?? {}) as StoredSpotifyPrefs
  const isPremium = readStoredPremium(spotify)
  const displayName =
    (typeof spotify.displayName === 'string' ? spotify.displayName : null) ??
    profile?.spotifyDisplayName ??
    null
  const scope = spotifyAccount?.scope ?? null

  const accessToken = spotifyAccount?.access_token ?? profile?.spotifyAccessToken ?? null
  const refreshToken = spotifyAccount?.refresh_token ?? profile?.spotifyRefreshToken ?? null
  const expiresAtMs = spotifyAccount?.expires_at
    ? spotifyAccount.expires_at * 1000
    : profile?.spotifyExpiresAt
      ? profile.spotifyExpiresAt.getTime()
      : 0

  if (!accessToken) return { ok: false, reason: 'not_connected' }

  const isExpired = Date.now() > expiresAtMs - EXPIRY_BUFFER_MS
  if (!isExpired) {
    return { ok: true, accessToken, expiresAtMs, scope, isPremium, displayName }
  }

  // An expired token with no refresh path must not be handed back as if it worked.
  if (!refreshToken) return { ok: false, reason: 'expired' }

  const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!refreshRes.ok) return { ok: false, reason: 'refresh_failed' }

  const tokens = (await refreshRes.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }
  const nextExpiresAtMs = Date.now() + tokens.expires_in * 1000

  if (spotifyAccount) {
    await prisma.authAccount.update({
      where: { id: spotifyAccount.id },
      data: {
        access_token: tokens.access_token,
        expires_at: Math.floor(nextExpiresAtMs / 1000),
        refresh_token: tokens.refresh_token ?? refreshToken,
      },
    })
  } else {
    await prisma.userProfile.updateMany({
      where: { userId },
      data: {
        spotifyAccessToken: tokens.access_token,
        spotifyRefreshToken: tokens.refresh_token ?? refreshToken,
        spotifyExpiresAt: new Date(nextExpiresAtMs),
        spotifyConnectedAt: profile?.spotifyConnectedAt ?? new Date(),
      },
    })
  }

  return {
    ok: true,
    accessToken: tokens.access_token,
    expiresAtMs: nextExpiresAtMs,
    scope,
    isPremium,
    displayName,
  }
}
