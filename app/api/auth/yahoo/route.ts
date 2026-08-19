import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse, type NextRequest } from 'next/server'
import crypto from 'crypto'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

import {
  getYahooRedirectUri,
  getYahooStateCookieDomain,
  sanitizeYahooReturnTo,
  YAHOO_FANTASY_SCOPE,
  YAHOO_RETURN_TO_COOKIE,
} from '@/lib/yahoo/oauthConfig'

const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID
const APP_URL = process.env.NEXTAUTH_URL || process.env.APP_URL || 'https://www.allfantasy.ai'
// Yahoo only accepts a redirect_uri registered in its developer console. This used to
// hardcode the line below and ignore YAHOO_REDIRECT_URI, so setting that variable fixed
// the League Sync button and did nothing for this one. Shared resolver, one lever.
const YAHOO_REDIRECT_URI = getYahooRedirectUri(`${APP_URL}/api/auth/yahoo/callback`)

export const GET = withApiUsage({ endpoint: "/api/auth/yahoo", tool: "AuthYahoo" })(async (request: NextRequest) => {
  /**
   * Where to land once Yahoo answers. The callback used to hardcode `/af-legacy` on
   * every exit, so a user who started from `/import` was dumped on another surface and
   * had to navigate back and start over -- the single biggest reason connecting Yahoo
   * felt like a six-page errand.
   */
  const returnTo = sanitizeYahooReturnTo(request.nextUrl.searchParams.get('returnTo'))

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    // Carry the destination through login so signing in does not lose the errand.
    return NextResponse.redirect(`${APP_URL}/login?callbackUrl=${encodeURIComponent(`/api/auth/yahoo?returnTo=${returnTo}`)}`)
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
  
  /**
   * The site answers on BOTH allfantasy.ai and www.allfantasy.ai. A host-only cookie
   * written on the apex is invisible when Yahoo returns to the www redirect_uri, and
   * the callback correctly reports that as `invalid_state`. Scope it to the registrable
   * domain so one round-trip can span both hosts.
   */
  const cookieDomain = getYahooStateCookieDomain(request.headers.get('host'))
  const cookieBase = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  }

  response.cookies.set('yahoo_oauth_state', state, cookieBase)
  response.cookies.set(YAHOO_RETURN_TO_COOKIE, returnTo, cookieBase)

  response.cookies.set('yahoo_oauth_user_id', session.user.id, cookieBase)
  
  return response
})
