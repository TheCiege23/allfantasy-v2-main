/**
 * Rosters store an OBJECT, not an array — and reading them as an array fails silently.
 *
 * 🛑 THE BUG THIS GUARDS. `allLeagueRosterPlayerIds` in `lib/idp/ai/idpChimmy.ts` open-coded the
 * parse and bailed on `!Array.isArray(playerData)`. Production stores
 * `{ players: [...], starters: [...], taxi: [...], reserve: [...], lineup_sections: {...} }`,
 * so every row was skipped and the set came back empty.
 *
 * Measured 2026-08-29 across all 10 IDP-scoring leagues in production: every one has `Roster`
 * rows (12 to 32 each) and every one parsed to ZERO ids. On `IDP Glory! Plus alil Offense` the
 * shared parser reads 573. The consequence was not a crash — Chimmy's waiver pool simply never
 * excluded anybody, so it was free to recommend players already rostered in the league.
 *
 * `getRosterPlayerIds` is the one parser and handles both shapes. These tests pin the shape that
 * actually exists, so a second open-coded copy cannot quietly reintroduce the empty set.
 */
import { describe, expect, it } from 'vitest'

import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'

/** The exact shape observed on production rosters, trimmed to the keys that matter. */
const PRODUCTION_SHAPE = {
  taxi: ['12529', '12619'],
  players: ['8155', '6124', '7648'],
  reserve: ['10905'],
  starters: ['6770', '9224'],
  lineup_sections: { starters: ['6770'], bench: ['8155'] },
  import: { provider: 'sleeper', teamName: 'Save Bandit!' },
  source_provider: 'sleeper',
}

describe('roster playerData — the object shape production actually stores', () => {
  it('reads player ids out of the object form', () => {
    const ids = getRosterPlayerIds(PRODUCTION_SHAPE)
    expect(ids).toEqual(['8155', '6124', '7648'])
  })

  it('is NOT an array, which is exactly why the open-coded guard returned nothing', () => {
    /*
     * The regression in one line: any parser gated on `Array.isArray(playerData)` sees false
     * here and skips the row. That is what made the rostered set empty in all 10 IDP leagues.
     */
    expect(Array.isArray(PRODUCTION_SHAPE)).toBe(false)
    expect(getRosterPlayerIds(PRODUCTION_SHAPE).length).toBeGreaterThan(0)
  })

  it('still reads the bare array form, so nothing that stored one regresses', () => {
    expect(getRosterPlayerIds(['1', '2', '3'])).toEqual(['1', '2', '3'])
  })

  it('returns an empty list for a roster with genuinely no players, not a throw', () => {
    expect(getRosterPlayerIds({ starters: ['1'], taxi: ['2'] })).toEqual([])
    expect(getRosterPlayerIds(null)).toEqual([])
    expect(getRosterPlayerIds(undefined)).toEqual([])
  })

  it('does not mistake starters, taxi or reserve for the roster itself', () => {
    /*
     * `players` is the full roster; the others are subsets of it. Summing them would double
     * count, and using `starters` alone would under-count a waiver pool's exclusion set.
     */
    const ids = getRosterPlayerIds(PRODUCTION_SHAPE)
    expect(ids).not.toContain('12529') // taxi
    expect(ids).not.toContain('10905') // reserve
    expect(ids).not.toContain('6770') // starters-only id
  })
})
