// @vitest-environment node
/**
 * Fantrax can resolve a player by id, and three separate places have to agree.
 *
 * 🛑 THE GAP WAS DECLARED IN THREE FILES AND CLOSED IN NONE. `PlayerIdentityMap`
 * gained a `fantraxId` column on 2026-08-31, written weekly by
 * `lib/devy/ingestFantraxPlayerIdentities.ts` — but the capability table, the
 * Identity Service's column map and the underlying resolver's column map each
 * independently said Fantrax had no column, each citing "requires a schema
 * migration, out of scope". The migration happened; the three declarations did
 * not notice, and nothing type-checks one against another.
 *
 * So this asserts the three AGREE, not merely that one of them is right. Any one
 * of them reverting silently turns Fantrax roster players back into name-only
 * matches, which fails by getting quietly worse rather than by breaking.
 *
 * ⚠ WHAT THIS DOES NOT CLAIM. Coverage is 25% (4,210 of 16,904 ids linked), and
 * the remainder is registry thinness rather than a matching failure — the first
 * run recorded 0 ambiguous. A miss falls through to the same name match Fantrax
 * always used, so the capability is strictly better and never worse. The test
 * pins the wiring, not the hit rate.
 */

import { describe, expect, it } from 'vitest'

import { getProviderCapability } from '@/lib/shared-services/player-identity/ProviderAdapters'

/** The column every layer must name. One string, so a typo cannot pass. */
const FANTRAX_COLUMN = 'fantraxId'

describe('the Fantrax direct-id capability', () => {
  it('declares a PlayerIdentityMap direct-id source', () => {
    const cap = getProviderCapability('fantrax')
    expect(cap.supportsDirectId).toBe(true)
    expect(cap.directIdSources).toEqual([{ table: 'PlayerIdentityMap', column: FANTRAX_COLUMN }])
  })

  /**
   * ⚠ THE RESOLVER READS `directIdSources.find(s => s.table === 'PlayerIdentityMap')`
   * and uses `.column` as a prisma `where` key. A source naming the wrong table
   * would leave `supportsDirectId: true` with nothing to look in — true and
   * useless, which is worse than false.
   */
  it('names the table the resolver actually queries', () => {
    const cap = getProviderCapability('fantrax')
    const source = cap.directIdSources.find((s) => s.table === 'PlayerIdentityMap')
    expect(source).toBeDefined()
    expect(source?.column).toBe(FANTRAX_COLUMN)
  })

  /**
   * 🛑 THE THREE MAPS MUST AGREE. These are three separate literals in three
   * files with no shared type between them; the whole failure being guarded
   * against is one of them drifting.
   */
  it('agrees with the Identity Service and the underlying resolver column maps', async () => {
    const svc = await import('@/lib/shared-services/identity/PlayerIdentityService')
    const resolver = await import('@/lib/league-import/playerIdResolver')
    /* Read through the modules' own source rather than exporting the private
       maps purely for a test — the constants are internal on purpose. */
    const fs = await import('node:fs/promises')
    for (const rel of [
      'lib/shared-services/identity/PlayerIdentityService.ts',
      'lib/league-import/playerIdResolver.ts',
    ]) {
      const text = await fs.readFile(rel, 'utf8')
      expect(text, `${rel} must map fantrax to ${FANTRAX_COLUMN}`).toContain(
        `fantrax: '${FANTRAX_COLUMN}'`,
      )
    }
    /* The imports above are what prove the two modules still load — a syntax
       error in either would fail here rather than in some unrelated suite. */
    expect(typeof svc.resolvePlayerIdentity).toBe('function')
    expect(typeof resolver.resolveCanonicalPlayerId).toBe('function')
  })

  /**
   * ⚠ YAHOO IS STILL UNCOVERED AND MUST STAY DECLARED THAT WAY. It shared the
   * "no column" sentence with Fantrax in all three files, so the edit that
   * closed Fantrax is exactly the edit that could sweep Yahoo along with it —
   * declaring a direct id for a column that does not exist.
   */
  it('leaves Yahoo declared as having no direct id', () => {
    const cap = getProviderCapability('yahoo')
    expect(cap.supportsDirectId).toBe(false)
    expect(cap.directIdSources).toEqual([])
  })

  it('leaves the providers that already had columns alone', () => {
    expect(getProviderCapability('sleeper').directIdSources).toEqual([
      { table: 'PlayerIdentityMap', column: 'sleeperId' },
      { table: 'SportsPlayer', column: 'sleeperId' },
    ])
    expect(getProviderCapability('espn').supportsDirectId).toBe(true)
    expect(getProviderCapability('mfl').supportsDirectId).toBe(true)
    expect(getProviderCapability('fleaflicker').supportsDirectId).toBe(true)
  })
})
