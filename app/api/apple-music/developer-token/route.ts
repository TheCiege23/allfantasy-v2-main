import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDeveloperToken, readAppleMusicConfig } from '@/lib/apple-music/developerToken'

export const dynamic = 'force-dynamic'

/**
 * GET /api/apple-music/developer-token — the short-lived pass MusicKit JS needs.
 *
 * Signs a JWT locally with the MusicKit key. It calls no Apple endpoint, so it
 * is not a provider call and does not touch the DB-first boundary.
 *
 * 503 — Apple Music is not configured on this server (the panel says so).
 * 401 — signed out (production only; local previews have no session).
 * 500 — the key would not sign. The reason is NOT returned or logged in detail,
 *       because the only input that can cause it is the secret.
 */
export async function GET() {
  const config = readAppleMusicConfig()
  if (!config) {
    return NextResponse.json({ error: 'Apple Music is not set up on this server.' }, { status: 503 })
  }

  if (process.env.NODE_ENV === 'production') {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const { token, expiresAt } = await getDeveloperToken(config)
    return NextResponse.json(
      { token, expiresAt },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch {
    console.error('[apple-music] developer token signing failed — check the APPLE_MUSIC_PRIVATE_KEY format')
    return NextResponse.json({ error: 'Apple Music is not available right now.' }, { status: 500 })
  }
}
