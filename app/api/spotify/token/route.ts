import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  describePlaybackGap,
  inspectPlaybackScopes,
  inspectPlaylistScopes,
} from '@/lib/spotify/playbackCapability'
import { getSpotifyAccess } from '@/lib/spotify/userAccess'

export const dynamic = 'force-dynamic'

/**
 * GET /api/spotify/token — Get a valid Spotify access token for the current user.
 * Auto-refreshes if expired. Used by the Web Playback SDK on the client.
 *
 * Token lookup and refresh live in lib/spotify/userAccess so the playlist and play
 * routes reach the same answer through the same code.
 */
export async function GET() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'Spotify integration not configured on server' },
      { status: 503 },
    )
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const access = await getSpotifyAccess(session.user.id)

  if (!access.ok) {
    switch (access.reason) {
      case 'not_configured':
        return NextResponse.json(
          { error: 'Spotify integration not configured on server' },
          { status: 503 },
        )
      case 'not_connected':
        return NextResponse.json({ error: 'Spotify not connected', connected: false }, { status: 404 })
      case 'refresh_failed':
        return NextResponse.json(
          { error: 'Token refresh failed', connected: true, expired: true },
          { status: 401 },
        )
      case 'expired':
        // Don't hand back a stale token — tell the client to reconnect.
        return NextResponse.json(
          {
            error: 'Spotify token expired and cannot be refreshed',
            connected: true,
            expired: true,
          },
          { status: 401 },
        )
    }
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
   * showing a dead player. This now runs on the refresh path too — it used to
   * return early there without any playback fields, so a user whose token had
   * just been refreshed never saw the reconnect prompt.
   */
  const playback = inspectPlaybackScopes(access.scope)
  const playbackMessage = describePlaybackGap(playback, access.isPremium)
  const playlists = inspectPlaylistScopes(access.scope)

  return NextResponse.json({
    token: access.accessToken,
    expiresIn:
      access.expiresAtMs > 0
        ? Math.max(0, Math.floor((access.expiresAtMs - Date.now()) / 1000))
        : 3600,
    // null = Spotify did not say. Do not coerce to false; see readStoredPremium.
    isPremium: access.isPremium,
    displayName: access.displayName,
    connected: true,
    canPlay: playback.canPlay && access.isPremium !== false,
    needsReauthorization: playback.needsReauthorization,
    missingScopes: playback.missing,
    playbackMessage,
    canListPrivatePlaylists: playlists.canListPrivate,
  })
}
