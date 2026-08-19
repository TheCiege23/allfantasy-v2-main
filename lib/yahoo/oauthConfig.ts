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

/** Cookie carrying where to send the user once Yahoo answers. */
export const YAHOO_RETURN_TO_COOKIE = 'yahoo_oauth_return_to'

/**
 * Where the OAuth round-trip should land when nothing says otherwise.
 *
 * This used to be `/af-legacy`, hardcoded into every one of the callback's exits --
 * success and all six failures. So a user who started the flow from `/import` was
 * dumped on a different surface entirely and had to walk back. `/import` is the
 * screen that actually wants a Yahoo connection, so it is the honest default.
 */
export const YAHOO_DEFAULT_RETURN_TO = '/import'

/**
 * Only same-site, absolute paths may be returned to. A caller-supplied `returnTo`
 * is attacker-reachable, so anything that could leave the site -- an absolute URL,
 * a protocol-relative `//evil.test`, or a backslash variant that some parsers treat
 * as a slash -- falls back to the default rather than being followed.
 */
export function sanitizeYahooReturnTo(value: string | null | undefined): string {
  if (typeof value !== 'string') return YAHOO_DEFAULT_RETURN_TO
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return YAHOO_DEFAULT_RETURN_TO

  // `//evil.test` and `/\evil.test` are both read as scheme-relative by some
  // parsers, so either would leave the site. Written via char code rather than an
  // escape so the check cannot be flattened by a careless edit.
  const BACKSLASH = String.fromCharCode(92)
  if (trimmed.startsWith('//') || trimmed.startsWith('/' + BACKSLASH)) {
    return YAHOO_DEFAULT_RETURN_TO
  }

  // Control characters (NUL..US) can smuggle a header break into a redirect.
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) <= 0x1f) return YAHOO_DEFAULT_RETURN_TO
  }

  return trimmed
}


/**
 * Cookie domain for the OAuth state.
 *
 * The state cookie was host-only, and the site answers on BOTH `allfantasy.ai` and
 * `www.allfantasy.ai`. Start the flow on the apex, come back to the www redirect_uri,
 * and the cookie is invisible -- which the callback correctly reports as
 * `invalid_state`. Scoping it to the registrable domain lets one round-trip span both.
 * Returns undefined for hosts where this does not apply (localhost, previews), leaving
 * the cookie host-only there.
 */
export function getYahooStateCookieDomain(host: string | null | undefined): string | undefined {
  if (!host) return undefined
  const bare = host.split(':')[0].toLowerCase()
  if (bare === 'allfantasy.ai' || bare.endsWith('.allfantasy.ai')) return '.allfantasy.ai'
  return undefined
}
