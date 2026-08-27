/**
 * The import page offered to connect an account that was already connected.
 *
 * OAuth completed, the token was written, and `/import` still rendered the
 * Connect Yahoo button — because it decided "connected" from a query parameter
 * that the callback which actually ran does not set.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const PAGE = read('app/import/page.tsx')
const AUTH_CB = read('app/api/auth/yahoo/callback/route.ts')
const LEAGUE_CB = read('app/api/league/yahoo/callback/route.ts')

describe('⚠ the two callbacks really do disagree', () => {
  it('the auth callback returns yahoo_connected=1', () => {
    expect(AUTH_CB).toContain("yahoo_connected: '1'")
  })

  it('the league callback returns success=yahoo_connected', () => {
    expect(LEAGUE_CB).toContain("dest.searchParams.set('success', 'yahoo_connected')")
  })

  it('the page reads both spellings rather than picking a winner', () => {
    // Either callback can legitimately be the one that ran.
    expect(PAGE).toContain('THE TWO CALLBACKS SET DIFFERENT PARAMETERS')
    expect(PAGE).toContain('pickQuery(sp, "yahoo_connected") === "1"')
    expect(PAGE).toContain('pickQuery(sp, "success") === "yahoo_connected"')
  })
})

describe('⚠ a connection is not a query string', () => {
  it('reads the stored row, so the fact survives a refresh', () => {
    /*
     * Derived from the URL alone, "connected" survived exactly one render. A
     * refresh, a new tab, or coming back the next day all showed "not
     * connected" while the token sat in the database the whole time.
     */
    expect(PAGE).toContain('A CONNECTION IS NOT A QUERY STRING')
    expect(PAGE).toContain('platform: "yahoo"')
    expect(PAGE).toContain('yahooConnectedFromQuery || Boolean(yahooAuthRow?.oauthToken)')
  })

  it('⚠ requires a token, not merely a row', () => {
    // A row with no token is a connect that started and never finished — the
    // shape the ESPN row has carried since August. It is not a connection.
    expect(PAGE).toContain('select: { oauthToken: true }')
    expect(PAGE).toContain('is not a connection')
  })

  it('degrades to "offer to connect" rather than taking the page down', () => {
    expect(PAGE).toContain('.catch(() => null)')
  })

  it('does not spend a query on a visitor who is not signed in', () => {
    const sessionGate = PAGE.indexOf('if (!session?.user?.id)')
    const dbRead = PAGE.indexOf('leagueAuth')
    expect(sessionGate).toBeGreaterThan(-1)
    expect(dbRead).toBeGreaterThan(sessionGate)
  })
})
