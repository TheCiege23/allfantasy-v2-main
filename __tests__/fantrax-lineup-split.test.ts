/**
 * Fantrax lineup split — which players are starters, which are bench, which are
 * genuinely on injured reserve, and when we refuse to say.
 *
 * 🛑 WHY THIS EXISTS: `starterPlayerIds` was hardcoded `[]` in
 * FantraxLeagueFetchService, and `reservePlayerIds` was the whole roster. My Team
 * renders its lineup from `Roster.playerData.starters`, so a Fantrax league
 * showed BOTH "no starting lineup recorded" and "no bench players recorded"
 * while holding a full 39-man roster. Measured on production before the fix.
 *
 * The mapper (`FantraxRosterMapper`), the normalized type and the persistence
 * layer all carried `starter_ids` already — only the fetch service never filled
 * it. That is why the tests below are about the SPLIT rather than the plumbing.
 *
 * 🛑 AND THE SECOND HALF, FIXED 2026-09-04: the non-ACTIVE list was named
 * `reserve` and handed straight to `reservePlayerIds`, which every surface
 * renders as "Injured Reserve". The bench is DERIVED downstream
 * (`players − starters − reserve − taxi`), so filing it here reported a healthy
 * bench as hurt AND left the bench section empty. Production carried 29 of 39
 * players on the one imported Fantrax roster as reserve. Bench and IR are two
 * lists now, and only IR is persisted.
 */

import { describe, expect, it } from 'vitest'

import { splitLineupForTest as splitLineup } from '@/lib/league-import/fantrax/FantraxLeagueFetchService'

describe('Fantrax lineup split', () => {
  it('files ACTIVE players as starters and the rest as bench', () => {
    const out = splitLineup([
      { fantraxId: 'a', status: 'ACTIVE' },
      { fantraxId: 'b', status: 'RESERVE' },
      { fantraxId: 'c', status: 'ACTIVE' },
    ])
    expect(out).toEqual({ starters: ['a', 'c'], bench: ['b'], reserve: [] })
  })

  /**
   * ⚠ ANYTHING NOT `ACTIVE` IS OFF THE FIELD. Fantrax also emits injured-reserve
   * and minor-league states; treating only the literal string RESERVE as
   * non-starting would silently promote those into someone's starting lineup.
   */
  it('keeps any non-ACTIVE status out of the starting lineup', () => {
    const out = splitLineup([
      { fantraxId: 'a', status: 'ACTIVE' },
      { fantraxId: 'ir', status: 'INJURED_RESERVE' },
      { fantraxId: 'min', status: 'MINORS' },
    ])
    expect(out?.starters).toEqual(['a'])
  })

  /**
   * 🛑 THE REGRESSION. A minor-leaguer is not injured. `reserve` is what becomes
   * the IR section, so an unrecognised non-ACTIVE status must land on the bench —
   * the direction that under-claims rather than inventing an injury.
   */
  it('separates injured reserve from the bench', () => {
    const out = splitLineup([
      { fantraxId: 'a', status: 'ACTIVE' },
      { fantraxId: 'ir', status: 'INJURED_RESERVE' },
      { fantraxId: 'min', status: 'MINORS' },
      { fantraxId: 'res', status: 'RESERVE' },
    ])
    expect(out?.reserve).toEqual(['ir'])
    expect(out?.bench).toEqual(['min', 'res'])
  })

  it('is case- and whitespace-insensitive about the status', () => {
    const out = splitLineup([{ fantraxId: 'a', status: '  active  ' }])
    expect(out?.starters).toEqual(['a'])
  })

  /**
   * 🛑 THE GUARD THAT MATTERS. A CSV-era snapshot carries no status at all.
   * Guessing — "the first N are starters" — would put players in a lineup their
   * manager never set, which is a worse failure than showing no lineup. Null
   * means the caller keeps the previous everything-is-bench shape: honest about
   * not knowing rather than confidently wrong.
   */
  it('refuses to guess when no player carries a status', () => {
    expect(splitLineup([{ fantraxId: 'a' }, { fantraxId: 'b' }])).toBeNull()
  })

  it('refuses when statuses are present but none is ACTIVE', () => {
    expect(
      splitLineup([
        { fantraxId: 'a', status: 'RESERVE' },
        { fantraxId: 'b', status: 'RESERVE' },
      ]),
    ).toBeNull()
  })

  it('skips rows with no player id rather than emitting empty strings', () => {
    const out = splitLineup([
      { fantraxId: 'a', status: 'ACTIVE' },
      { status: 'ACTIVE' },
      { fantraxId: '', status: 'RESERVE' },
    ])
    expect(out).toEqual({ starters: ['a'], bench: [], reserve: [] })
  })
})
