import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

import { getYahooRedirectUri, YAHOO_FANTASY_SCOPE } from '@/lib/yahoo/oauthConfig'

const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID
const APP_URL = process.env.NEXTAUTH_URL || process.env.APP_URL || 'https://www.allfantasy.ai'
// Yahoo only accepts a redirect_uri registered in its developer console. This used to
// hardcode the line below and ignore YAHOO_REDIRECT_URI, so setting that variable fixed
// the League Sync button and did nothing for this one. Shared resolver, one lever.
const YAHOO_REDIRECT_URI = getYahooRedirectUri(`${APP_URL}/api/auth/yahoo/callback`)

export const GET = withApiUsage({ endpoint: "/api/auth/yahoo", tool: "AuthYahoo" })(async () => {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.redirect(`${APP_URL}/login?callbackUrl=/af-legacy`)
  }

  if (!YAHOO_CLIENT_ID) {
    console.error('YAHOO_CLIENT_ID is not configured')
    return NextResponse.redirect(`${APP_URL}/af-legacy?yahoo_error=not_configured`)
  }

  const state = crypto.randomBytes(16).toString('hex')
  
  // Build OAuth URL - Yahoo requires minimal parameters
  const params = new URLSearchParams()
  params.append('client_id', YAHOO_CLIENT_ID)
  params.append('redirect_uri', YAHOO_REDIRECT_URI)
  params.append('response_type', 'code')
  // Without fspt-r this flow completes and returns a token that cannot read a single
  // fantasy league. The League Sync flow always requested it; this one never did.
  params.append('scope', YAHOO_FANTASY_SCOPE)
  params.append('state', state)
  
  const authUrl = `https://api.login.yahoo.com/oauth2/request_auth?${params.toString()}`
  
  // Never log the full auth URL -- it carries client_id as a query parameter.
  console.log('Yahoo OAuth - Redirect URI:', YAHOO_REDIRECT_URI)
  
  const response = NextResponse.redirect(authUrl)
  
  response.cookies.set('yahoo_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  response.cookies.set('yahoo_oauth_user_id', session.user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  
  return response
})
