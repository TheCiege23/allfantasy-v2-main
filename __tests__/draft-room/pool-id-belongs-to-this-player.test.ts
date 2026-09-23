/**
 * The draft pool may only assign an id the pool can attribute to THAT player.
 *
 * 🛑 A SLEEPER-SHAPED NUMBER IS NOT A SLEEPER ID. Rolling Insights numbers its players in the
 * same range Sleeper does, and `SportsPlayer.externalId` holds whichever the source supplied,
 * so the two spaces are indistinguishable by inspection. The NFL scoring path reads a roster
 * row's id as a Sleeper id regardless — so an RI number assigned at the draft attributes
 * another man's week to that slot, silently and permanently.
 *
 * Measured 2026-09-23 on a 1,929-entry board built from the test database: 443 of the 1,713
 * numeric ids resolved to a DIFFERENT player when looked up in `SportsPlayer.sleeperId`.
 *
 *     A.J. Brown          4876  ->  Bradley Northnagel, LS
 *     DK Metcalf          4843  ->  Willie Mays, LB
 *     Marvin Harrison Jr. 8563  ->  Jordan Tucker, T
 *
 * After the fix the same board carried 8 (one of which is this control's own strictness about
 * "Kenny" vs "Kenneth" Gainwell, not a wrong id).
 */
import { describe, expect, it } from 'vitest'

import { providerIdIsUsableForPlayer } from '@/lib/draft-room/getResolvedDraftPoolForLeague'

/** The pool's own answer to "who holds this Sleeper id", by suffixless base name. */
const OWNERS = new Map<string, string>([
  ['8138', 'james cook'],
  // `canonicalName` drops the periods, so "A.J. Brown" keys as "aj brown".
  ['5859', 'aj brown'],
  ['4876', 'bradley northnagel'],
  ['12495', 'ollie gordon'],
])

const usable = (id: string, playerName: string, sport = 'NFL') =>
  providerIdIsUsableForPlayer({ id, playerName, sport, baseNameBySleeperId: OWNERS })

describe('providerIdIsUsableForPlayer', () => {
  it('accepts an id the pool attributes to this player', () => {
    expect(usable('5859', 'A.J. Brown')).toBe(true)
  })

  it('accepts across a generational suffix the feeds disagree about', () => {
    // Sleeper writes "James Cook", Rolling Insights "James Cook III". One man, one id.
    expect(usable('8138', 'James Cook III')).toBe(true)
    expect(usable('8138', 'James Cook')).toBe(true)
    expect(usable('12495', 'Ollie Gordon II')).toBe(true)
  })

  it('refuses an id the pool attributes to somebody else', () => {
    // 4876 is A.J. Brown's ROLLING INSIGHTS id and Bradley Northnagel's SLEEPER id.
    expect(usable('4876', 'A.J. Brown')).toBe(false)
  })

  /**
   * ⚠ THE DISTINGUISHING CASE. A "not provably somebody else's" rule passes this and leaves a
   * wrong id on the board — measured at 168 of them, because the pool cannot attribute an id
   * whose owner is not fantasy-relevant enough to be in it.
   */
  it('refuses an id the pool cannot attribute at all', () => {
    expect(OWNERS.has('4822')).toBe(false)
    expect(usable('4822', 'Deebo Samuel')).toBe(false)
  })

  it('leaves non-numeric ids alone — they are not in Sleeper space', () => {
    expect(usable('nfl:def:KC', 'Kansas City Defense')).toBe(true)
    expect(usable('7eae572c-056d-4d02-b2e3-c29dda34a32f', 'Travis Etienne Jr.')).toBe(true)
  })

  it('never questions another sport, whose pool carries no Sleeper ids at all', () => {
    // The map is empty for them, so a positive test would reject every numeric id.
    expect(
      providerIdIsUsableForPlayer({
        id: '4876',
        playerName: 'Connor McDavid',
        sport: 'NHL',
        baseNameBySleeperId: new Map(),
      }),
    ).toBe(true)
  })

  it('refuses an empty id rather than treating it as unquestioned', () => {
    expect(usable('', 'A.J. Brown')).toBe(false)
    expect(usable('   ', 'A.J. Brown')).toBe(false)
  })
})
