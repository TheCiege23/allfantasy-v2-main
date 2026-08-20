import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import crypto from 'crypto';
import { getYahooRedirectUri, YAHOO_AUTH_URL, YAHOO_FANTASY_SCOPE } from '@/lib/yahoo/oauthConfig';

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

  response.cookies.set('yahoo_league_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return response;
}
