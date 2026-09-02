import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse, type NextRequest } from 'next/server'
import crypto from 'crypto'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getServedOrigin } from '@/lib/http/served-origin'

import {
  buildYahooReturnUrl,
  checkYahooRedirectUri,
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

  /*
   * 🛑 REFUSE A redirect_uri YAHOO CANNOT ACCEPT, RATHER THAN SPENDING THE ROUND TRIP.
   *
   * The sibling entry point `/api/league/yahoo-auth` has done this since the guard was
   * written. THIS one — the entry point `ConnectedPlatforms` and `ImportV4` actually link to,
   * and therefore the one nearly every manager uses — did not. So the check that exists,
   * is tested, and names the exact production failure was wired to the door almost nobody
   * opens. That is the same "two entry points disagree" defect `lib/yahoo/oauthConfig.ts`
   * was created to end; this is the last of the three, after redirect_uri and scope.
   *
   * Without it Yahoo answers a bad URI on ITS OWN error page with
   * `error=invalid_request&error_description=invalid+redirect+uri`, so the manager sees a
   * Yahoo failure, the product looks innocent, and nothing here records that we sent a URI
   * that could never have worked.
   *
   * ⚠ IT REPORTS, IT DOES NOT CORRECT. Substituting a guessed URI would send Yahoo one
   * nobody registered and produce the same failure from a different line. The fix is in
   * Yahoo's developer console; this only ensures somebody is told.
   */
  /*
   * Logged because the deployment stores this as a SENSITIVE env var, which hides it in the
   * dashboard but not in the runtime log. A redirect URI is not a secret — it rides in the
   * browser address bar on every round trip and Yahoo echoes it back on its own error page —
   * and being unable to read it is what turned one wrong character into several failed
   * attempts. The auth URL itself is still never logged: it carries client_id.
   */
  console.log('[Yahoo OAuth] redirect_uri:', YAHOO_REDIRECT_URI)

  /*
   * ⚠ getServedOrigin, not request.nextUrl.origin. checkYahooRedirectUri compares
   * hosts, and a route handler's origin is the address the server BOUND to — so in
   * production it read "this deployment serves 0.0.0.0:8080" and refused every Yahoo
   * connect. Both entry points had it; see lib/http/served-origin.ts.
   */
  const redirectCheck = checkYahooRedirectUri(YAHOO_REDIRECT_URI, getServedOrigin(request))
  if (!redirectCheck.ok) {
    console.error('[Yahoo OAuth] refusing to start: %s', redirectCheck.reason)
    /*
     * Back to where they STARTED, not a hardcoded surface. The sibling sends everyone to
     * /leagues because it has no returnTo; this route has carried one since the callback
     * stopped hardcoding /af-legacy, and dropping the user somewhere else is the errand
     * this file already fixed once. `buildYahooReturnUrl` because returnTo usually already
     * has a query string — `/import?provider=yahoo` — and appending with a bare `?` is what
     * previously made the import screen silently fall back to Sleeper.
     */
    return NextResponse.redirect(
      buildYahooReturnUrl(returnTo, APP_URL, { yahoo_error: 'redirect_uri_not_registered' }),
    )
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
  
  // The redirect_uri is logged above, before the guard. Never log the full auth URL --
  // it carries client_id as a query parameter.

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
