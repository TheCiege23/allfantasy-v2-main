import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import crypto from 'crypto';
import {
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
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const clientId = process.env.YAHOO_CLIENT_ID;
  if (!clientId) {
    console.error('[Yahoo OAuth] YAHOO_CLIENT_ID not configured');
    return NextResponse.redirect(new URL('/leagues?error=yahoo_not_configured', request.url));
  }

  const redirectUri = getYahooRedirectUri(`${request.nextUrl.origin}/api/league/yahoo/callback`);
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
