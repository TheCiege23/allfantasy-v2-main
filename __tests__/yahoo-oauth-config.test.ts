import { describe, it, expect, afterEach } from 'vitest'
import {
  getYahooRedirectUri,
  getYahooStateCookieDomain,
  readYahooOAuthState,
  sanitizeYahooReturnTo,
  YAHOO_DEFAULT_RETURN_TO,
  YAHOO_FANTASY_SCOPE,
  YAHOO_STATE_COOKIE_NAMES,
} from '@/lib/yahoo/oauthConfig'

const ORIGINAL = process.env.YAHOO_REDIRECT_URI
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.YAHOO_REDIRECT_URI
  else process.env.YAHOO_REDIRECT_URI = ORIGINAL
})

/** Minimal stand-in for the Next cookie jar the callbacks receive. */
const jar = (bag: Record<string, string>) => ({
  get: (name: string) => (name in bag ? { value: bag[name] } : undefined),
})

describe('yahoo redirect uri: one lever for both entry points', () => {
  it('prefers YAHOO_REDIRECT_URI over the caller fallback', () => {
    process.env.YAHOO_REDIRECT_URI = 'https://www.allfantasy.ai/api/auth/yahoo/callback'
    expect(getYahooRedirectUri('https://example.test/other/callback')).toBe(
      'https://www.allfantasy.ai/api/auth/yahoo/callback',
    )
  })

  it('both entry points resolve to the SAME uri once the env var is set — the whole point', () => {
    process.env.YAHOO_REDIRECT_URI = 'https://www.allfantasy.ai/api/auth/yahoo/callback'
    const fromAuthFlow = getYahooRedirectUri('https://www.allfantasy.ai/api/auth/yahoo/callback')
    const fromLeagueFlow = getYahooRedirectUri('https://www.allfantasy.ai/api/league/yahoo/callback')
    expect(fromAuthFlow).toBe(fromLeagueFlow)
  })

  it('falls back to the caller uri when unset, so an unconfigured deploy does not regress', () => {
    delete process.env.YAHOO_REDIRECT_URI
    expect(getYahooRedirectUri('https://www.allfantasy.ai/api/league/yahoo/callback')).toBe(
      'https://www.allfantasy.ai/api/league/yahoo/callback',
    )
  })

  it('treats blank or whitespace-only as unset rather than sending Yahoo an empty uri', () => {
    process.env.YAHOO_REDIRECT_URI = '   '
    expect(getYahooRedirectUri('https://fallback.test/cb')).toBe('https://fallback.test/cb')
    process.env.YAHOO_REDIRECT_URI = ''
    expect(getYahooRedirectUri('https://fallback.test/cb')).toBe('https://fallback.test/cb')
  })
})

describe('yahoo oauth state: a callback must accept either cookie', () => {
  it('reads the auth-flow cookie', () => {
    expect(readYahooOAuthState(jar({ yahoo_oauth_state: 'abc' }))).toBe('abc')
  })

  it('reads the league-flow cookie', () => {
    expect(readYahooOAuthState(jar({ yahoo_league_oauth_state: 'xyz' }))).toBe('xyz')
  })

  it('returns undefined when neither is present, so state validation still fails closed', () => {
    expect(readYahooOAuthState(jar({ unrelated: 'v' }))).toBeUndefined()
  })

  it('covers both historical names', () => {
    expect([...YAHOO_STATE_COOKIE_NAMES].sort()).toEqual(
      ['yahoo_league_oauth_state', 'yahoo_oauth_state'],
    )
  })
})

describe('yahoo scope', () => {
  it('is the fantasy read scope — without it a token cannot read a single league', () => {
    expect(YAHOO_FANTASY_SCOPE).toBe('fspt-r')
  })
})

describe('returnTo: the flow comes back where it started', () => {
  it('keeps a same-site absolute path', () => {
    expect(sanitizeYahooReturnTo('/import?provider=yahoo')).toBe('/import?provider=yahoo')
  })

  it('defaults to /import, not the af-legacy page the callback used to hardcode', () => {
    expect(YAHOO_DEFAULT_RETURN_TO).toBe('/import')
    expect(sanitizeYahooReturnTo(null)).toBe('/import')
    expect(sanitizeYahooReturnTo(undefined)).toBe('/import')
    expect(sanitizeYahooReturnTo('')).toBe('/import')
  })

  // returnTo is caller-supplied and therefore attacker-reachable.
  it.each([
    ['absolute url', 'https://evil.test/steal'],
    ['protocol-relative', '//evil.test/steal'],
    ['scheme-relative backslash', '/' + String.fromCharCode(92) + 'evil.test/steal'],
    ['javascript uri', 'javascript:alert(1)'],
    ['bare path', 'import'],
  ])('refuses to leave the site: %s', (_label, value) => {
    expect(sanitizeYahooReturnTo(value)).toBe('/import')
  })

  it('rejects control characters used to smuggle header breaks', () => {
    const withNewline = '/import' + String.fromCharCode(10) + 'Set-Cookie: x=1'
    expect(sanitizeYahooReturnTo(withNewline)).toBe('/import')
  })
})

describe('state cookie domain: one round-trip across apex and www', () => {
  it('scopes to the registrable domain on both hosts', () => {
    expect(getYahooStateCookieDomain('allfantasy.ai')).toBe('.allfantasy.ai')
    expect(getYahooStateCookieDomain('www.allfantasy.ai')).toBe('.allfantasy.ai')
  })

  it('ignores the port', () => {
    expect(getYahooStateCookieDomain('www.allfantasy.ai:443')).toBe('.allfantasy.ai')
  })

  it('leaves the cookie host-only elsewhere (localhost, previews)', () => {
    expect(getYahooStateCookieDomain('localhost:3000')).toBeUndefined()
    expect(getYahooStateCookieDomain('preview-abc.vercel.app')).toBeUndefined()
    expect(getYahooStateCookieDomain(null)).toBeUndefined()
  })

  it('does not match a lookalike domain', () => {
    expect(getYahooStateCookieDomain('allfantasy.ai.evil.test')).toBeUndefined()
    expect(getYahooStateCookieDomain('notallfantasy.ai')).toBeUndefined()
  })
})
