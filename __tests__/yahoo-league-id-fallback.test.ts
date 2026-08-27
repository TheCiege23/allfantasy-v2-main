/**
 * Yahoo gets a second way in, and the loop that hid the first one is closed.
 *
 * Production request logs, captured while a manager pressed Connect Yahoo:
 *
 *   POST /api/leagues/import/discover   502
 *   GET  /api/auth/yahoo                307
 *   GET  /api/league/yahoo/callback     307
 *   GET  /import                        200
 *   ... and round again
 *
 * The 502 is the route's OWN response to `YahooApiResponseError` — Yahoo actively
 * refusing the league list. Its message contains "Reconnect", the screen treats
 * any such message as "not connected yet" and redirects to Yahoo, Yahoo already
 * holds consent so it returns at once, and the screen repaints identically. A
 * real error, reported many times, never once rendered.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { toYahooLeagueKey } from '@/lib/league-import/yahooLeagueKey'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
const SCREEN = read('components/core-app/screens/ImportV4.tsx')
const ROUTE = read('app/api/leagues/import/discover/route.ts')

describe('⚠ a typed id must skip the call that is failing', () => {
  it('wraps a bare league id into a game-qualified key', () => {
    /*
     * `resolveYahooLeagueLookup` short-circuits on `.l.` and otherwise resolves by
     * listing the account's leagues — the broken call. A bare number would have
     * gone straight back into it.
     */
    expect(toYahooLeagueKey('123456')).toBe('nfl.l.123456')
    expect(toYahooLeagueKey('  123456  ')).toBe('nfl.l.123456')
  })

  it('lifts the id out of a pasted league URL', () => {
    expect(toYahooLeagueKey('https://football.fantasysports.yahoo.com/f1/1361311/10')).toBe(
      'nfl.l.1361311',
    )
  })

  it('never second-guesses a key that already names its game', () => {
    // Including the numeric game ids Yahoo issues per season.
    expect(toYahooLeagueKey('nfl.l.123456')).toBe('nfl.l.123456')
    expect(toYahooLeagueKey('449.l.123456')).toBe('449.l.123456')
  })

  it('leaves anything that is not an id alone rather than inventing a key', () => {
    expect(toYahooLeagueKey('')).toBe('')
    expect(toYahooLeagueKey('my league')).toBe('my league')
  })
})

describe('⚠ the button routes a typed id around discovery', () => {
  it('previews the league instead of listing the account', () => {
    // canDiscover is true for Yahoo, so the old branch ran the account-wide
    // lookup unconditionally and ignored what had been typed.
    expect(SCREEN).toContain('if (usesConnectedAccount && typed) {')
    expect(SCREEN).toContain('void runPreview(toYahooLeagueKey(typed))')
    expect(SCREEN).toContain('A TYPED YAHOO LEAGUE ID MUST BYPASS DISCOVERY, NOT FEED IT')
  })

  it('says what it will do once something is typed', () => {
    expect(SCREEN).toContain("? 'Import this league'")
    expect(SCREEN).toContain(": 'Connect Yahoo'")
  })

  it('offers the field without demoting connecting', () => {
    // Connecting still names every league at once and asks nothing of the user.
    expect(SCREEN).toContain('Or paste one league ID')
    expect(SCREEN).toContain('A SECOND WAY IN, BECAUSE THE FIRST ONE CAN FAIL')
  })
})

describe('⚠ the redirect loop', () => {
  it('does not bounce to Yahoo when we have just come back from Yahoo', () => {
    expect(SCREEN).toContain(
      "if (provider === 'yahoo' && needsConnectionSetup(message) && !yahooConnected) {",
    )
  })

  it('recomputes when that flag changes, or the guard reads a stale value', () => {
    expect(SCREEN).toContain('[provider, yahooConnected]')
  })
})

describe('⚠ Yahoo status is the diagnosis, and it was discarded', () => {
  it('names a 403 as the missing fantasy permission', () => {
    // A valid token for an account that never granted Fantasy Sports read. The
    // fix is a checkbox at approval time, not a generic "try again".
    expect(ROUTE).toContain('if (status === 403)')
    expect(ROUTE).toContain('Fantasy Sports')
    expect(ROUTE).toContain('if (status === 401)')
  })

  it('records the status in the log, where there was previously nothing', () => {
    expect(ROUTE).toContain("'[Yahoo discovery] user=%s REJECTED yahoo_status=%d'")
    expect(ROUTE).toContain('error.status')
  })

  it('logs the status and a truncated user, never the provider response body', () => {
    /*
     * The body is Yahoo's own text and can echo request context. Asserting on the
     * call site rather than the whole file, because the reasoning above
     * necessarily mentions the thing being excluded.
     */
    const at = ROUTE.indexOf('[Yahoo discovery] user=%s REJECTED')
    const call = ROUTE.slice(at, ROUTE.indexOf(')', ROUTE.indexOf('error.status', at)))
    expect(call).toContain('auth.userId.slice(0, 8)')
    expect(call).not.toContain('error.message')
    expect(call).not.toContain('body')
  })
})
