import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { inspectPlaybackScopes, describePlaybackGap } from '@/lib/spotify/playbackCapability'

export const dynamic = 'force-dynamic'

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

type SpotifyData = {
  userId?: string | null
  displayName?: string | null
  email?: string | null
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: string | null
  isPremium?: boolean
  connectedAt?: string | null
}

/**
 * GET /api/spotify/token — Get a valid Spotify access token for the current user.
 * Auto-refreshes if expired. Used by the Web Playback SDK on the client.
 */
export async function GET() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'Spotify integration not configured on server' },
      { status: 503 },
    )
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [profile, spotifyAccount] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId: session.user.id },
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
      where: { userId: session.user.id, provider: 'spotify' },
      select: {
        id: true,
        access_token: true,
        refresh_token: true,
        expires_at: true,
        // Required by inspectPlaybackScopes below. Omitting it reports every user
        // as incapable, which is the opposite failure but equally wrong.
        scope: true,
      },
    }),
  ])

  const prefs = (profile?.notificationPreferences ?? {}) as Record<string, unknown>
  const spotify = (prefs.spotify ?? {}) as SpotifyData
  const accessToken = spotifyAccount?.access_token ?? profile?.spotifyAccessToken ?? null
  const refreshToken = spotifyAccount?.refresh_token ?? profile?.spotifyRefreshToken ?? null
  const expiresAt = spotifyAccount?.expires_at
    ? spotifyAccount.expires_at * 1000
    : profile?.spotifyExpiresAt
      ? profile.spotifyExpiresAt.getTime()
      : 0

  if (!accessToken) {
    return NextResponse.json({ error: 'Spotify not connected', connected: false }, { status: 404 })
  }

  // Check if token is expired (with 5-minute buffer)
  const isExpired = Date.now() > expiresAt - 5 * 60 * 1000

  if (isExpired && refreshToken) {
    // Credentials presence already asserted at the top of the handler.
    const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })

    if (!refreshRes.ok) {
      return NextResponse.json({ error: 'Token refresh failed', connected: true, expired: true }, { status: 401 })
    }

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
        where: { userId: session.user.id },
        data: {
          spotifyAccessToken: tokens.access_token,
          spotifyRefreshToken: tokens.refresh_token ?? refreshToken,
          spotifyExpiresAt: new Date(nextExpiresAtMs),
          spotifyConnectedAt: profile?.spotifyConnectedAt ?? new Date(),
        },
      })
    }

    return NextResponse.json({
      token: tokens.access_token,
      expiresIn: tokens.expires_in,
      isPremium: spotify.isPremium ?? false,
      displayName: spotify.displayName ?? profile?.spotifyDisplayName ?? null,
      connected: true,
    })
  }

  // If we reach here with an expired token but no refresh path available,
  // don't hand back a stale token — tell the client to reconnect.
  if (isExpired) {
    return NextResponse.json(
      {
        error: 'Spotify token expired and cannot be refreshed',
        connected: true,
        expired: true,
      },
      { status: 401 },
    )
  }

  /*
   * ⚠ A VALID TOKEN IS NOT A PLAYABLE TOKEN. Measured in production: all 8
   * connected Spotify accounts hold `scope: user-read-email` and nothing else.
   * That token refreshes, identifies the user, and passes every check the widget
   * made — so the player rendered, looked connected, and silently produced no
   * audio. Scopes are granted at authorization time, so widening the scope list
   * fixed NEW connections and did nothing for existing ones.
   *
   * Reporting the gap here means the client can say "reconnect" instead of
   * showing a dead player.
   */
  const playback = inspectPlaybackScopes(spotifyAccount?.scope ?? null)
  const playbackMessage = describePlaybackGap(playback, spotify.isPremium ?? false)

  return NextResponse.json({
    token: accessToken,
    expiresIn: expiresAt > 0 ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : 3600,
    isPremium: spotify.isPremium ?? false,
    displayName: spotify.displayName ?? profile?.spotifyDisplayName ?? null,
    connected: true,
    canPlay: playback.canPlay && (spotify.isPremium ?? false),
    needsReauthorization: playback.needsReauthorization,
    missingScopes: playback.missing,
    playbackMessage,
  })
}
