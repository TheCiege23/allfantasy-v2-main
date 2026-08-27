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
import { describeYahooRejection } from '@/lib/league-import/yahoo/yahooRejection'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
const SCREEN = read('components/core-app/screens/ImportV4.tsx')
const ROUTE = read('app/api/leagues/import/discover/route.ts')
const PIPELINE = read('lib/league-import/ImportedLeagueNormalizationPipeline.ts')

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
  it('names BOTH causes of a 403, in the order they need checking', () => {
    /*
     * ⚠ THE FIRST VERSION OF THIS MESSAGE WAS WRONG, AND WRONG IN THE EXPENSIVE
     * DIRECTION: it said reconnecting would not help, so it steered people away
     * from the fix.
     *
     * Yahoo's OAuth2 takes no `scope` parameter — the authorize request accepts
     * client_id, redirect_uri, response_type, state and language, and nothing
     * else. Permissions come entirely from the app registration AS IT STOOD WHEN
     * THE USER APPROVED, and that approval survives until it is removed in Yahoo
     * account settings. So an app can hold Fantasy Sports read and still be
     * refused, forever, on an approval granted before the permission existed —
     * which is exactly what was measured on 2026-08-27: a token issued at
     * 22:36:31, refused two seconds later.
     */
    const m = describeYahooRejection(403)
    expect(m).toContain('Fantasy Sports read permission')
    expect(m).toContain('developer console')
    /* The stale-approval half is the one that was missing. */
    expect(m).toContain('at the moment you approve')
    expect(m).toContain('remove the app under your Yahoo account settings')
    expect(m).toContain('reuses the old approval')
  })

  it('keeps 401 as the one that IS worth reconnecting', () => {
    expect(describeYahooRejection(401)).toContain('Reconnect Yahoo')
  })

  it('does not blame the app for a league that is simply not there', () => {
    expect(describeYahooRejection(404)).toContain('no league with that ID')
  })

  it('still names the status when it is one nobody has mapped', () => {
    expect(describeYahooRejection(503)).toContain('HTTP 503')
  })

  it('is the single mapper both paths use, so they cannot drift', () => {
    expect(ROUTE).toContain('describeYahooRejection(error.status)')
    expect(PIPELINE).toContain('e instanceof YahooApiResponseError')
    expect(PIPELINE).toContain('describeYahooRejection(e.status)')
  })

  it('stops handing the provider response body to the screen', () => {
    /*
     * A YahooApiResponseError carries Yahoo's raw body as its message, and the
     * generic handler returned it verbatim — so an import rendered Yahoo's JSON,
     * complete with our own API path, and explained nothing.
     */
    expect(PIPELINE).toContain("WITHOUT THIS, YAHOO'S RAW JSON REACHED THE SCREEN")
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
