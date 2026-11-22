import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { SPOTIFY_SCOPES } from '@/lib/spotify/scopes'
import { canConnectSpotify } from '@/lib/spotify/connectAccess'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? ''
const SPOTIFY_REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ??
  `${process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai'}/api/auth/spotify/callback`

// Shared with the NextAuth Spotify provider. These two flows hit the SAME Spotify app, and
// when their scope lists drifted apart sign-in broke while connect kept working — see
// lib/spotify/scopes.ts. Do not re-inline a second list here.
const SCOPES = SPOTIFY_SCOPES

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent('/settings?tab=connected')}`, process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai')
    )
  }

  if (!SPOTIFY_CLIENT_ID) {
    return NextResponse.redirect(
      new URL('/settings?tab=connected&spotify=error', process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai')
    )
  }

  /*
   * Same gate as the Settings button, enforced here so a typed URL cannot skip it.
   * Without it a non-allowlisted user lands on Spotify's own developer-facing 403
   * ("User not registered in the Developer Dashboard") with no way back.
   */
  const [user, profile, spotifyAccount] = await Promise.all([
    prisma.appUser.findUnique({ where: { id: session.user.id }, select: { email: true } }),
    prisma.userProfile.findUnique({ where: { userId: session.user.id }, select: { spotifyConnectedAt: true } }),
    prisma.authAccount.findFirst({ where: { userId: session.user.id, provider: 'spotify' }, select: { id: true } }),
  ])
  const allowed = canConnectSpotify({
    email: user?.email,
    alreadyConnected: Boolean(profile?.spotifyConnectedAt || spotifyAccount),
  })
  if (!allowed) {
    return NextResponse.redirect(
      new URL('/settings?tab=connected&spotify=not-available', process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai')
    )
  }

  const state = crypto.randomUUID()
  const cookieStore = await cookies()

  cookieStore.set('spotify_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  cookieStore.set('spotify_oauth_user_id', session.user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const url = new URL('https://accounts.spotify.com/authorize')
  url.searchParams.set('client_id', SPOTIFY_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)

  return NextResponse.redirect(url)
}
