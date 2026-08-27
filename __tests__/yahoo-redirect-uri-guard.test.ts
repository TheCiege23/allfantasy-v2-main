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
    expect(ROUTE).toContain('checkYahooRedirectUri(redirectUri, request.nextUrl.origin)')
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
    expect(ROUTE).toContain("login.searchParams.set(")
    expect(ROUTE).toContain('/api/league/yahoo-auth${request.nextUrl.search}')
    /* A bare /login is indistinguishable from every other auth bounce. */
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
