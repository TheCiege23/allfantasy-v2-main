/**
 * Zero Yahoo accounts have ever connected, and this is the most likely reason.
 *
 * Measured against Yahoo's own authorize endpoint on 2026-08-26, five
 * candidates, one accepted:
 *
 *   ACCEPTED  https://www.allfantasy.ai/api/league/yahoo/callback
 *   REJECTED  https://allfantasy.ai/api/league/yahoo/callback
 *   REJECTED  https://allfantasy.ai/api/auth/yahoo/callback
 *   REJECTED  https://allfantasy-v2-main-a6wc.vercel.app/api/league/yahoo/callback
 *   REJECTED  https://localhost:3000/api/league/yahoo/callback
 *
 * `YAHOO_REDIRECT_URI` in the local env is
 * `http://localhost:3000/api/league/yahoo/callback` — also rejected. Yahoo
 * answers a bad one on its OWN error page, so the manager sees a Yahoo failure
 * and the product looks innocent.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { checkYahooRedirectUri } from '@/lib/yahoo/oauthConfig'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
const ROUTE = read('app/api/league/yahoo-auth/route.ts')
/*
 * The OTHER entry point — and the one that matters most, because it is what
 * `ConnectedPlatforms` and `ImportV4` link to, so it is the door nearly every manager
 * opens. The guard was wired to `yahoo-auth` only, which is the League Sync dashboard.
 */
const AUTH_ROUTE = read('app/api/auth/yahoo/route.ts')
const IMPORT_SCREEN = read('components/core-app/screens/ImportV4.tsx')

const PROD = 'https://www.allfantasy.ai'
const LOCAL = 'http://localhost:3000'

describe('⚠ the www trap: Yahoo registers the exact host', () => {
  it('accepts the URI that is actually registered', () => {
    expect(checkYahooRedirectUri(`${PROD}/api/league/yahoo/callback`, PROD)).toEqual({ ok: true })
  })

  it('refuses the apex when the app is served from www', () => {
    // Two different registrations to Yahoo, and only one of them is on file.
    const out = checkYahooRedirectUri('https://allfantasy.ai/api/league/yahoo/callback', PROD)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toContain('two different URIs')
  })

  it('refuses a preview host when the app is served from the domain', () => {
    const out = checkYahooRedirectUri(
      'https://allfantasy-v2-main-a6wc.vercel.app/api/league/yahoo/callback',
      PROD,
    )
    expect(out.ok).toBe(false)
  })
})

describe('⚠ the configured value: localhost in a deployment that is not local', () => {
  it('refuses a localhost callback when the app is served from a domain', () => {
    /*
     * This is what YAHOO_REDIRECT_URI was actually set to. Yahoo would have sent
     * the manager to a machine that is not the one serving the product.
     */
    const out = checkYahooRedirectUri('http://localhost:3000/api/league/yahoo/callback', PROD)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toContain('not this one')
  })

  it('allows a localhost callback when the app IS local', () => {
    // Still has to be registered with Yahoo — this only stops the check from
    // blocking development.
    expect(checkYahooRedirectUri(`${LOCAL}/api/league/yahoo/callback`, LOCAL)).toEqual({ ok: true })
  })

  it('refuses plain http on a real deployment', () => {
    const out = checkYahooRedirectUri('http://www.allfantasy.ai/api/league/yahoo/callback', PROD)
    expect(out.ok).toBe(false)
  })
})

describe('⚠ it reports, it does not correct', () => {
  it('never returns a substitute URI', () => {
    /*
     * Guessing a replacement would send Yahoo a URI nobody registered and
     * produce the same error from a different line. The fix is in Yahoo's
     * developer console.
     */
    const out = checkYahooRedirectUri('nonsense', PROD)
    expect(out.ok).toBe(false)
    expect(Object.keys(out)).toEqual(['ok', 'reason'])
  })

  it('says something usable when the value is not a URL at all', () => {
    const out = checkYahooRedirectUri('', PROD)
    expect(out.ok === false && out.reason).toContain('not a URL')
  })

  it('judges the URI alone when the origin is unusable', () => {
    expect(checkYahooRedirectUri(`${PROD}/api/league/yahoo/callback`, 'not-an-origin')).toEqual({
      ok: true,
    })
  })
})

describe('⚠ refused before the round trip, not after', () => {
  it('checks in the connect route rather than letting Yahoo answer', () => {
    // Yahoo's refusal lands on Yahoo's own error page: the manager sees a Yahoo
    // failure, the product looks innocent, and nothing in our logs records that
    // we sent a URI that could never have worked.
    expect(ROUTE).toContain('CHECKED BEFORE THE ROUND TRIP')
    /*
     * ⚠ THE SECOND ARGUMENT USED TO BE request.nextUrl.origin, AND THAT MADE THIS
     * GUARD REFUSE EVERY CONNECT. A route handler's origin is the address the server
     * BOUND to, so in production the check read "YAHOO_REDIRECT_URI is
     * www.allfantasy.ai but this deployment serves 0.0.0.0:8080" and stopped the
     * flow before it started. The guard was right about what it was told.
     */
    expect(ROUTE).toContain('checkYahooRedirectUri(redirectUri, getServedOrigin(request))')
  })

  it('⚠ carries the errand through login instead of dropping it', () => {
    /*
     * This redirected to a bare `/login` and threw the destination away, so a
     * manager who clicked Connect Yahoo without a readable session signed in
     * and arrived on the home page with nothing resuming. The click was simply
     * lost, and the only signal was being "kicked out of the app".
     * `/api/auth/yahoo` has carried a callbackUrl all along; this one never did.
     */
    expect(ROUTE).toContain('THE ERRAND HAS TO SURVIVE THE LOGIN')
    expect(ROUTE).toContain('callbackUrl: `/api/league/yahoo-auth${request.nextUrl.search}`')
    /* A bare /login is indistinguishable from every other auth bounce. */
    expect(ROUTE).not.toContain("relativeRedirect('/login')")
    expect(ROUTE).not.toContain("NextResponse.redirect(new URL('/login', request.url))")
  })

  it('logs the redirect_uri, which the sensitive env flag hides from the dashboard', () => {
    // A redirect URI is not a secret — it rides in the address bar on every
    // round trip and Yahoo echoes it back on its own error page.
    expect(ROUTE).toContain("console.log('[Yahoo OAuth] redirect_uri:', redirectUri)")
  })

  it('sends the manager somewhere with a named reason', () => {
    expect(ROUTE).toContain('yahoo_redirect_uri')
    expect(ROUTE).toContain("console.error('[Yahoo OAuth] refusing to start: %s', redirectCheck.reason)")
  })
})

describe('⚠ BOTH entry points check, not just the one nobody uses', () => {
  /*
   * 🛑 THE GAP. `checkYahooRedirectUri` existed, was tested, and named the exact production
   * failure — and it was wired ONLY into `/api/league/yahoo-auth`, the League Sync dashboard
   * button. `/api/auth/yahoo` is what `ConnectedPlatforms` and `ImportV4` link to, so the
   * check guarded the door almost nobody opens while nearly every manager walked through the
   * unguarded one and met Yahoo's own error page.
   *
   * This is the third and last disagreement between the two entry points that
   * `lib/yahoo/oauthConfig.ts` was created to end — after redirect_uri and scope.
   */
  it('checks in /api/auth/yahoo too', () => {
    expect(AUTH_ROUTE).toContain('checkYahooRedirectUri(YAHOO_REDIRECT_URI, getServedOrigin(request))')
  })

  it('refuses BEFORE building the authorize URL, not after', () => {
    /* Ordering is the whole point: a check that runs after the redirect is no check. */
    const check = AUTH_ROUTE.indexOf('checkYahooRedirectUri(')
    const authorize = AUTH_ROUTE.indexOf('oauth2/request_auth')
    expect(check).toBeGreaterThan(-1)
    expect(authorize).toBeGreaterThan(-1)
    expect(check).toBeLessThan(authorize)
  })

  it('returns the manager where they started, not a hardcoded surface', () => {
    /*
     * The sibling sends everyone to /leagues because it has no returnTo. This route has
     * carried one since the callback stopped hardcoding /af-legacy, and dropping the user
     * elsewhere is the errand this file already fixed once.
     */
    expect(AUTH_ROUTE).toContain("buildYahooReturnUrl(returnTo, APP_URL, { yahoo_error: 'redirect_uri_not_registered' })")
  })

  it('⚠ builds that URL rather than appending a bare ?', () => {
    /*
     * returnTo is normally `/import?provider=yahoo`. Appending `?yahoo_error=` produced
     * `?provider=yahoo?yahoo_error=`, which the parser read as provider="yahoo?yahoo_error=..."
     * and silently fell back to Sleeper — the manager asked for Yahoo and got Sleeper with no
     * error on the page. Same bug, same file, and it must not come back through this exit.
     */
    expect(AUTH_ROUTE).not.toMatch(/\$\{returnTo\}\?yahoo_error/)
  })

  it('never logs the authorize URL, which carries client_id', () => {
    expect(AUTH_ROUTE).not.toMatch(/console\.log\([^)]*authUrl/)
  })
})

describe('⚠ the one Yahoo error a manager must not be told to retry', () => {
  /*
   * Every other code in `describeYahooError` is Yahoo answering, and retrying is reasonable.
   * `redirect_uri_not_registered` is OURS — the route refused to start because the configured
   * URI is not registered with Yahoo. A retry is guaranteed to fail, so "please try again"
   * would have the manager pay for the attempt repeatedly.
   */
  it('has an honest message for the code the route now emits', () => {
    expect(IMPORT_SCREEN).toContain("case 'redirect_uri_not_registered':")
  })

  it('does not tell them to try again, and does not blame their account', () => {
    const start = IMPORT_SCREEN.indexOf("case 'redirect_uri_not_registered':")
    expect(start).toBeGreaterThan(-1)
    const message = IMPORT_SCREEN.slice(start, IMPORT_SCREEN.indexOf('\n', IMPORT_SCREEN.indexOf('return', start)))
    expect(message).not.toMatch(/try again/i)
    expect(message).toMatch(/misconfigured/i)
  })

  it('keeps the specific host detail in the server log, not on the manager screen', () => {
    /* checkYahooRedirectUri's reason names the configured vs served host — operator detail. */
    expect(AUTH_ROUTE).toContain('refusing to start: %s')
    expect(AUTH_ROUTE).not.toContain('yahoo_error_desc: redirectCheck.reason')
  })
})
