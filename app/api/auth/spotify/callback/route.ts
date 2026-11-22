import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const BASE = process.env.NEXTAUTH_URL ?? 'https://www.allfantasy.ai'
const CONNECTED_SETTINGS_PATH = '/settings?tab=connected'
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? ''
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? ''
const SPOTIFY_REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ?? `${BASE}/api/auth/spotify/callback`

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(CONNECTED_SETTINGS_PATH)}`, BASE))
  }

  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const err = searchParams.get('error')

  const cookieStore = await cookies()
  const storedState = cookieStore.get('spotify_oauth_state')?.value
  const initiatingUserId = cookieStore.get('spotify_oauth_user_id')?.value

  cookieStore.delete('spotify_oauth_state')
  cookieStore.delete('spotify_oauth_user_id')

  if (err || !code || !state || !storedState || storedState !== state || initiatingUserId !== session.user.id) {
    return NextResponse.redirect(new URL('/settings?tab=connected&spotify=error', BASE))
  }

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return NextResponse.redirect(new URL('/settings?tab=connected&spotify=error', BASE))
  }

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    }),
  })

  if (!tokenRes.ok) {
    console.error('[spotify-callback] token exchange failed:', tokenRes.status)
    return NextResponse.redirect(new URL('/settings?tab=connected&spotify=error', BASE))
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    scope?: string
  }

  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  const profile = profileRes.ok
    ? ((await profileRes.json()) as {
        display_name?: string
        id?: string
        images?: Array<{ url: string }>
        /** 'premium' | 'free' | 'open' — present only when user-read-private was granted. */
        product?: string
      })
    : null
  const spotifyProviderAccountId = profile?.id?.trim()

  if (!spotifyProviderAccountId) {
    return NextResponse.redirect(new URL('/settings?tab=connected&spotify=error', BASE))
  }

  try {
    const existingAccount = await prisma.authAccount.findFirst({
      where: { provider: 'spotify', providerAccountId: spotifyProviderAccountId },
      select: { id: true, userId: true },
    })

    if (existingAccount && existingAccount.userId !== session.user.id) {
      return NextResponse.redirect(new URL('/settings?tab=connected&spotify=error', BASE))
    }

    /*
     * /api/spotify/token reads `notificationPreferences.spotify.isPremium` to
     * decide whether the Web Playback SDK can stream — and nothing ever wrote
     * that field, so every user read as free forever. Persist the real
     * `product` from GET /v1/me here.
     *
     * ⚠ AN ABSENT `product` IS UNKNOWN, NOT FREE. This used to store
     * `product === 'premium'`, so a missing field became `false`. Since the
     * February 2026 Web API changes, GET /v1/me no longer returns `product` for
     * Development Mode apps at all — so that line told every Premium listener to
     * buy Premium. Record the tier only when Spotify supplied it, and mark it with
     * `premiumSource` so readStoredPremium can tell a real answer from the old
     * defaulted `false`. When it is unknown, the Web Playback SDK reports a free
     * account itself (`account_error`).
     */
    const existingProfile = await prisma.userProfile.findUnique({
      where: { userId: session.user.id },
      select: { notificationPreferences: true },
    })
    const prefs = (existingProfile?.notificationPreferences ?? {}) as Record<string, unknown>
    const {
      isPremium: _stalePremium,
      premiumSource: _stalePremiumSource,
      ...previousSpotify
    } = (prefs.spotify ?? {}) as Record<string, unknown>
    const reportedProduct = typeof profile?.product === 'string' ? profile.product : null
    const mergedPrefs = {
      ...prefs,
      spotify: {
        ...previousSpotify,
        ...(reportedProduct
          ? { isPremium: reportedProduct === 'premium', premiumSource: 'spotify-product' }
          : {}),
        displayName: profile?.display_name ?? null,
      },
    } as Prisma.InputJsonValue

    await prisma.userProfile.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        spotifyAccessToken: tokens.access_token,
        spotifyRefreshToken: tokens.refresh_token,
        spotifyExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        spotifyDisplayName: profile?.display_name ?? null,
        spotifyConnectedAt: new Date(),
        notificationPreferences: mergedPrefs,
      },
      update: {
        spotifyAccessToken: tokens.access_token,
        spotifyRefreshToken: tokens.refresh_token,
        spotifyExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        spotifyDisplayName: profile?.display_name ?? null,
        spotifyConnectedAt: new Date(),
        notificationPreferences: mergedPrefs,
      },
    })

    const authAccountPayload = {
      userId: session.user.id,
      type: 'oauth',
      provider: 'spotify',
      providerAccountId: spotifyProviderAccountId,
      refresh_token: tokens.refresh_token ?? null,
      access_token: tokens.access_token ?? null,
      expires_at: Math.floor((Date.now() + tokens.expires_in * 1000) / 1000),
      token_type: 'Bearer',
      /*
       * The scope string Spotify actually granted. This was hardcoded null,
       * which stored every fresh re-auth as playback-incapable —
       * inspectPlaybackScopes treats null as incapable on purpose — so the
       * "reconnect Spotify to fix playback" loop could never clear.
       */
      scope: tokens.scope ?? null,
      id_token: null,
      session_state: null,
    }

    if (existingAccount) {
      await prisma.authAccount.update({
        where: { id: existingAccount.id },
        data: authAccountPayload,
      })
    } else {
      await prisma.authAccount.deleteMany({
        where: { userId: session.user.id, provider: 'spotify' },
      })
      await prisma.authAccount.create({
        data: authAccountPayload,
      })
    }
  } catch (e) {
    console.error('[spotify-callback] DB update failed:', e)
    return NextResponse.redirect(new URL('/settings?tab=connected&spotify=error', BASE))
  }

  return NextResponse.redirect(new URL('/settings?tab=connected&spotify=connected', BASE))
}
