import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { inspectPlaylistScopes } from '@/lib/spotify/playbackCapability'
import { getSpotifyAccess } from '@/lib/spotify/userAccess'
import { listMyPlaylists } from '@/lib/spotify/webApi'

export const dynamic = 'force-dynamic'

const RECONNECT_FOR_PRIVATE =
  'Showing public playlists only. Reconnect Spotify to include your private and collaborative ones.'

/**
 * GET /api/spotify/playlists — the signed-in listener's own Spotify playlists, for the
 * music widget's picker. Per-user account data, fetched live with the user's own token.
 */
export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const access = await getSpotifyAccess(session.user.id)
  if (!access.ok) {
    if (access.reason === 'not_configured') {
      return NextResponse.json({ error: 'Spotify integration not configured on server' }, { status: 503 })
    }
    if (access.reason === 'not_connected') {
      return NextResponse.json({ error: 'Spotify not connected', connected: false }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'Spotify connection expired. Reconnect Spotify.', connected: true, expired: true },
      { status: 401 },
    )
  }

  const result = await listMyPlaylists(access.accessToken)
  if (!result.ok) {
    console.warn('[spotify-playlists] list failed:', result.status)
    if (result.status === 401) {
      return NextResponse.json(
        { error: 'Spotify connection expired. Reconnect Spotify.', expired: true },
        { status: 401 },
      )
    }
    if (result.status === 429) {
      return NextResponse.json({ error: 'Spotify is busy. Try again in a minute.' }, { status: 429 })
    }
    return NextResponse.json({ error: 'Could not load your Spotify playlists.' }, { status: 502 })
  }

  const scopes = inspectPlaylistScopes(access.scope)
  return NextResponse.json(
    {
      playlists: result.playlists,
      truncated: result.truncated,
      canListPrivate: scopes.canListPrivate,
      notice: scopes.canListPrivate ? null : RECONNECT_FOR_PRIVATE,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
