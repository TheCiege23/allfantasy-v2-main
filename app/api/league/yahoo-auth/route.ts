import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import crypto from 'crypto';
import {
  checkYahooRedirectUri,
  getYahooRedirectUri,
  getYahooStateCookieDomain,
  sanitizeYahooReturnTo,
  YAHOO_AUTH_URL,
  YAHOO_FANTASY_SCOPE,
  YAHOO_RETURN_TO_COOKIE,
} from '@/lib/yahoo/oauthConfig';

export async function GET(request: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
  const userId = session?.user?.id;

  if (!userId) {
    /*
     * ⚠ THE ERRAND HAS TO SURVIVE THE LOGIN. This redirected to a bare `/login`
     * and threw the destination away, so a manager who clicked Connect Yahoo
     * without a readable session signed in and arrived on the home page with
     * nothing resuming — the click was simply lost, and the only signal was
     * being "kicked out of the app". `/api/auth/yahoo`, the other entry point,
     * has carried a callbackUrl all along; this one never did.
     *
     * It also makes the failure legible: a bare `/login` is indistinguishable
     * from every other auth bounce in the product, while
     * `/login?callbackUrl=/api/league/yahoo-auth` names which route decided the
     * session was missing.
     */
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    login.searchParams.set(
      'callbackUrl',
      `/api/league/yahoo-auth${request.nextUrl.search}`,
    );
    return NextResponse.redirect(login);
  }

  const clientId = process.env.YAHOO_CLIENT_ID;
  if (!clientId) {
    console.error('[Yahoo OAuth] YAHOO_CLIENT_ID not configured');
    return NextResponse.redirect(new URL('/leagues?error=yahoo_not_configured', request.url));
  }

  const redirectUri = getYahooRedirectUri(`${request.nextUrl.origin}/api/league/yahoo/callback`);

  /*
   * ⚠ CHECKED BEFORE THE ROUND TRIP, BECAUSE YAHOO'S REFUSAL LOOKS LIKE YAHOO'S
   * FAULT. A redirect_uri Yahoo has not registered comes back as
   * `invalid_request / invalid redirect uri` on Yahoo's own error page — the
   * manager sees a Yahoo failure, the product looks innocent, and nothing in our
   * logs records that we sent a URI that could never have worked.
   */
  /*
   * Logged because the deployment stores this as a SENSITIVE env var, which
   * hides it in the dashboard but not in the runtime log. A redirect URI is not
   * a secret — it rides in the browser address bar on every round trip and
   * Yahoo echoes it back on its own error page — and being unable to read it is
   * what turned one wrong character into several failed attempts.
   */
  console.log('[Yahoo OAuth] redirect_uri:', redirectUri);

  const redirectCheck = checkYahooRedirectUri(redirectUri, request.nextUrl.origin);
  if (!redirectCheck.ok) {
    console.error('[Yahoo OAuth] refusing to start: %s', redirectCheck.reason);
    return NextResponse.redirect(new URL('/leagues?error=yahoo_redirect_uri', request.url));
  }

  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YAHOO_FANTASY_SCOPE,
    state,
  });

  const response = NextResponse.redirect(`${YAHOO_AUTH_URL}?${params.toString()}`);

  /*
   * ⚠ DOMAIN-SCOPED, LIKE THE OTHER ENTRY POINT. A host-only cookie set on the
   * apex dies when Yahoo returns the user to www (or vice versa) — the exact
   * invalid_state failure already fixed on /api/auth/yahoo. And the returnTo
   * cookie makes the callback land the user where they started (?returnTo=,
   * sanitized to safe internal paths; /import by default).
   */
  const cookieBase = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
    domain: getYahooStateCookieDomain(request.headers.get('host')),
  };
  response.cookies.set('yahoo_league_oauth_state', state, cookieBase);
  response.cookies.set(
    YAHOO_RETURN_TO_COOKIE,
    sanitizeYahooReturnTo(request.nextUrl.searchParams.get('returnTo')),
    cookieBase,
  );

  return response;
}
