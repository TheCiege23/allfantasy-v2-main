import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { encrypt } from '@/lib/league-auth-crypto'
import {
  readYahooOAuthState,
  sanitizeYahooReturnTo,
  YAHOO_RETURN_TO_COOKIE,
  YAHOO_STATE_COOKIE_NAMES,
} from '@/lib/yahoo/oauthConfig'

const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID
const YAHOO_CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET
const APP_URL = process.env.NEXTAUTH_URL || process.env.APP_URL || 'https://www.allfantasy.ai'
// Must match exactly what's in Yahoo Developer Console
const YAHOO_REDIRECT_URI = `${APP_URL}/api/auth/yahoo/callback`

export const GET = withApiUsage({ endpoint: "/api/auth/yahoo/callback", tool: "AuthYahooCallback" })(async (request: NextRequest) => {
  /**
   * Every exit below used to hardcode `/af-legacy`, so a user who began this flow on
   * `/import` was returned to a different surface -- on success AND on all six
   * failures. The starting screen writes its destination into a cookie; we honour it.
   */
  const returnTo = sanitizeYahooReturnTo(request.cookies.get(YAHOO_RETURN_TO_COOKIE)?.value)
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.redirect(`${APP_URL}/login?callbackUrl=${encodeURIComponent(returnTo)}`)
  }

  const searchParams = request.nextUrl.searchParams
  const code = searchParams?.get('code')
  const state = searchParams?.get('state')
  const error = searchParams?.get('error')
  
  if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET) {
    console.error("[Yahoo Callback] Missing YAHOO_CLIENT_ID or YAHOO_CLIENT_SECRET")
    return NextResponse.redirect(`${APP_URL}${returnTo}?yahoo_error=not_configured`)
  }

  if (error) {
    const errorDesc = searchParams?.get('error_description') || ''
    console.error('Yahoo OAuth error:', error, errorDesc)
    return NextResponse.redirect(`${APP_URL}${returnTo}?yahoo_error=${encodeURIComponent(error)}&yahoo_error_desc=${encodeURIComponent(errorDesc)}`)
  }
  
  if (!code) {
    return NextResponse.redirect(`${APP_URL}${returnTo}?yahoo_error=no_code`)
  }
  
  // Accept EITHER historical cookie. Once both entry points share one redirect_uri,
  // a round-trip started by the other flow lands here, and a round-trip already in
  // flight when this shipped carries the other name.
  const storedState = readYahooOAuthState(request.cookies)
  const initiatingUserId = request.cookies.get('yahoo_oauth_user_id')?.value
  if (!storedState || storedState !== state || !initiatingUserId || initiatingUserId !== session.user.id) {
    return NextResponse.redirect(`${APP_URL}${returnTo}?yahoo_error=invalid_state`)
  }
  
  try {
    const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: YAHOO_REDIRECT_URI,
      }),
    })
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Yahoo token error:', tokenResponse.status, errorText)
      console.error('Token request details - redirect_uri:', YAHOO_REDIRECT_URI)
      return NextResponse.redirect(`${APP_URL}${returnTo}?yahoo_error=token_failed&status=${tokenResponse.status}`)
    }
    
    const tokens = await tokenResponse.json()
    const { access_token, refresh_token, expires_in } = tokens
    
    const userResponse = await fetch('https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1?format=json', { // db-first-exception: user-delegated OAuth import, requires live accessToken
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
    })
    
    if (!userResponse.ok) {
      console.error('Yahoo user fetch error:', await userResponse.text())
      return NextResponse.redirect(`${APP_URL}${returnTo}?yahoo_error=user_fetch_failed`)
    }
    
    const userData = await userResponse.json()
    const user = userData?.fantasy_content?.users?.[0]?.user?.[0]
    const yahooUserId = user?.guid || 'unknown'
    const displayName = user?.profile?.display_name || user?.name || null
    
    const tokenExpiresAt = new Date(Date.now() + (expires_in || 3600) * 1000)
    const encryptedAccessToken = encrypt(access_token)
    const encryptedRefreshToken = refresh_token ? encrypt(refresh_token) : ''
    
    await prisma.yahooConnection.upsert({
      where: { yahooUserId },
      update: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
        displayName,
        updatedAt: new Date(),
      },
      create: {
        yahooUserId,
        displayName,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
      },
    })
    
    const response = NextResponse.redirect(`${APP_URL}${returnTo}?yahoo_connected=1&yahoo_user=${encodeURIComponent(yahooUserId)}`)
    
    response.cookies.set('yahoo_user_id', yahooUserId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    })

    response.cookies.set('yahoo_owner_user_id', session.user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    })
    
    // Clear both names -- either could have carried this round-trip.
    for (const name of YAHOO_STATE_COOKIE_NAMES) response.cookies.delete(name)
    response.cookies.delete(YAHOO_RETURN_TO_COOKIE)
    response.cookies.delete('yahoo_oauth_user_id')
    
    return response
  } catch (error: any) {
    console.error('Yahoo OAuth error:', error)
    return NextResponse.redirect(`${APP_URL}${returnTo}?yahoo_error=${encodeURIComponent(error.message || 'unknown')}`)
  }
})

