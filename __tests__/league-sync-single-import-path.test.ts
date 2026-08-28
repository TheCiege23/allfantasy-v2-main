/**
 * One way into a league, and one page that can still re-sync it.
 *
 * `/leagues/sync` used to carry its own add-and-sync modal plus a "Discover
 * Existing Leagues" panel, both driving the OLDER `/api/league/*` endpoints,
 * while `/import` drives `/api/leagues/import/*`. Two ways in, different code,
 * and only one of them applies the commissioner gate, the attestation step and
 * the team claim.
 *
 * ⚠ THE PAGE ITSELF WAS NOT DELETED, AND THAT WAS THE WHOLE QUESTION. It is the
 * only surface that can re-sync a league already imported — `/api/league/sync`
 * and `/api/league/sleeper-sync` appear in no other UI. Removing it would have
 * taken that with it; the button it provides is exactly the one that was missing
 * when an ESPN league needed its backfill re-run and the only way to do it was a
 * POST from a browser console.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const DASH = read('app/components/LeagueSyncDashboard.tsx')
const PAGE = read('app/leagues/sync/page.tsx')

describe('⚠ adding a league happens in exactly one place', () => {
  it('sends both Add League controls to /import', () => {
    // The header button and the empty-state button.
    const links = DASH.split('href="/import"').length - 1
    expect(links).toBe(2)
  })

  it('has no add-and-sync modal left behind', () => {
    /* Asserted on identifiers, which appear in no comment. */
    expect(DASH).not.toContain('const addLeague')
    expect(DASH).not.toContain('showAddModal')
  })

  it('drops the legacy discovery panel and its endpoint', () => {
    // Its own copy admitted it was half-built: "discovery coming soon", "Use
    // Add League above with your league ID instead."
    expect(DASH).not.toContain('/api/league/discover')
    expect(DASH).not.toContain('Discover Existing Leagues')
  })
})

describe('⚠ what had to survive, and did', () => {
  it('keeps re-sync, which exists nowhere else in the UI', () => {
    expect(DASH).toContain('/api/league/sync')
    expect(DASH).toContain('/api/league/sleeper-sync')
    expect(DASH).toContain('Re-sync')
  })

  it('keeps the connect / OAuth surface', () => {
    expect(DASH).toContain('/api/league/auth')
    expect(DASH).toContain('yahoo_connected')
  })

  it('keeps listing and opening leagues', () => {
    expect(DASH).toContain('/api/league/list')
    expect(DASH).toContain("'Open League' : 'Sync & Open'")
  })
})

describe('⚠ the surrounding claims were updated with it', () => {
  it('no longer tells the reader this page owns add-league', () => {
    /*
     * Three places asserted it did. A comment that describes a capability the
     * code no longer has is worse than no comment: the next person trusts it.
     */
    expect(PAGE).toContain('ADDING A LEAGUE IS NO LONGER ONE OF THEM')
    expect(read('lib/core-app/leagueSync.ts')).toContain('ADD-LEAGUE IS NO LONGER ON THAT PAGE')
    expect(read('components/core-app/AfCoreShell.tsx')).toContain(
      'Adding a league belongs to /import',
    )
  })

  it('still says why the page exists at all', () => {
    expect(read('lib/core-app/leagueSync.ts')).toContain('it owns connect, OAuth and')
  })
})
