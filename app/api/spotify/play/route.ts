import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PREMIUM_REQUIRED_MESSAGE } from '@/lib/spotify/playbackCapability'
import { getSpotifyAccess } from '@/lib/spotify/userAccess'
import { isValidContextUri, isValidDeviceId, startPlaylistPlayback } from '@/lib/spotify/webApi'

export const dynamic = 'force-dynamic'

const RECONNECT_FOR_PLAYBACK =
  'Reconnect Spotify to enable playback — your existing connection was made before playback permissions were added.'

/**
 * POST /api/spotify/play { deviceId, contextUri } — start one of the listener's playlists
 * on the AllFantasy in-browser player (the Web Playback SDK device).
 *
 * Both inputs are validated against Spotify's own id formats before anything is sent:
 * this route forwards to Spotify with the user's token, so it accepts nothing it could
 * not have produced itself.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { deviceId?: unknown; contextUri?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!isValidDeviceId(body.deviceId)) {
    return NextResponse.json({ error: 'The player is not ready yet.' }, { status: 400 })
  }
  if (!isValidContextUri(body.contextUri)) {
    return NextResponse.json({ error: 'That is not a Spotify playlist.' }, { status: 400 })
  }

  const access = await getSpotifyAccess(session.user.id)
  if (!access.ok) {
    if (access.reason === 'not_configured') {
      return NextResponse.json({ error: 'Spotify integration not configured on server' }, { status: 503 })
    }
    if (access.reason === 'not_connected') {
      return NextResponse.json({ error: 'Connect Spotify to play music here.' }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'Spotify connection expired. Reconnect Spotify.', reconnect: true },
      { status: 401 },
    )
  }

  const result = await startPlaylistPlayback(access.accessToken, body.deviceId, body.contextUri)
  if (result.ok) return NextResponse.json({ ok: true })

  console.warn('[spotify-play] start failed:', result.status, result.reason)
  switch (result.reason) {
    case 'premium_required':
      return NextResponse.json({ error: PREMIUM_REQUIRED_MESSAGE, premiumRequired: true }, { status: 403 })
    case 'forbidden':
      return NextResponse.json({ error: RECONNECT_FOR_PLAYBACK, reconnect: true }, { status: 403 })
    case 'unauthorized':
      return NextResponse.json(
        { error: 'Spotify connection expired. Reconnect Spotify.', reconnect: true },
        { status: 401 },
      )
    case 'device_not_found':
      return NextResponse.json(
        { error: 'The in-browser player dropped. Reload the page and try again.' },
        { status: 409 },
      )
    case 'rate_limited':
      return NextResponse.json({ error: 'Spotify is busy. Try again in a minute.' }, { status: 429 })
    default:
      return NextResponse.json({ error: 'Spotify would not start that playlist. Try again.' }, { status: 502 })
  }
}
