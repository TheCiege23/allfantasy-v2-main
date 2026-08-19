/**
 * One place that decides how we talk to Yahoo's OAuth server.
 *
 * WHY THIS EXISTS. There are two Yahoo entry points -- `/api/auth/yahoo` (the
 * af-legacy button) and `/api/league/yahoo-auth` (the League Sync dashboard) --
 * and they disagreed with each other in two ways that both break the flow:
 *
 *   1. REDIRECT URI. `/api/auth/yahoo` hardcoded its own callback and ignored
 *      `YAHOO_REDIRECT_URI` entirely, while `/api/league/yahoo-auth` read the env
 *      var. Yahoo only accepts a redirect_uri that is registered in its developer
 *      console, so setting that variable fixed one button and did nothing for the
 *      other. Whichever one you clicked, if its URI was not the registered one,
 *      Yahoo rejected the request on its own error page.
 *
 *   2. SCOPE. `/api/auth/yahoo` requested NO scope. Yahoo needs `fspt-r` to read
 *      fantasy data, so that flow could complete "successfully" and still hand
 *      back a token that cannot read a single league.
 *
 * Both entry points now resolve through here. Set `YAHOO_REDIRECT_URI` to the one
 * URI registered with Yahoo and both buttons use it; leave it unset and each keeps
 * the callback it used before, so nothing regresses while the env var is missing.
 */

/** Yahoo Fantasy Sports, read scope. Required for any fantasy data. */
export const YAHOO_FANTASY_SCOPE = 'fspt-r'

export const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth'

/**
 * Both historical cookie names. A callback must accept EITHER, because a user can
 * have an OAuth round-trip in flight, started by the other entry point, at the
 * moment this ships.
 */
export const YAHOO_STATE_COOKIE_NAMES = ['yahoo_oauth_state', 'yahoo_league_oauth_state'] as const

export function getYahooClientId(): string | undefined {
  return process.env.YAHOO_CLIENT_ID
}

/**
 * The redirect URI to send Yahoo, and to expect back.
 *
 * `YAHOO_REDIRECT_URI` wins when set -- that is the unification lever. `fallback`
 * is the caller's own historical callback, used only when the env var is absent so
 * that an unconfigured deployment behaves exactly as it did before.
 */
export function getYahooRedirectUri(fallback: string): string {
  const configured = process.env.YAHOO_REDIRECT_URI?.trim()
  return configured && configured.length > 0 ? configured : fallback
}

/** Read the OAuth state from whichever cookie the initiating flow set. */
export function readYahooOAuthState(
  cookies: { get(name: string): { value: string } | undefined },
): string | undefined {
  for (const name of YAHOO_STATE_COOKIE_NAMES) {
    const value = cookies.get(name)?.value
    if (value) return value
  }
  return undefined
}
