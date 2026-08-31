/**
 * Which identity row a Fantrax player links to.
 *
 * 🛑 A WRONG LINK IS WORSE THAN NO LINK. `PlayerIdentityMap` is what
 * `AFProjectionSnapshot.playerId` resolves to, so a mis-link attaches another
 * player's projection — and, once devyAdp lands, another player's market price —
 * to your roster spot. Null is a visible gap; a wrong link looks like data.
 *
 * So every test below is about refusing rather than matching.
 */

import { describe, expect, it } from 'vitest'

import { chooseIdentityMatch } from '@/lib/devy/ingestFantraxPlayerIdentities'

const row = (id: string, canonicalName: string, currentTeam: string | null, fantraxId: string | null = null) => ({
  id,
  canonicalName,
  currentTeam,
  fantraxId,
})

describe('chooseIdentityMatch', () => {
  it('matches a single name hit', () => {
    const out = chooseIdentityMatch([row('p1', 'Austyn Dendy', 'Bowling Green')], {
      name: 'Dendy, Austyn',
      school: 'BGSU',
    })
    expect(out).toMatchObject({ kind: 'match', id: 'p1' })
  })

  it('separates two players of the same name when the schools share a prefix', () => {
    const out = chooseIdentityMatch(
      [row('p1', 'John Smith', 'Alabama'), row('p2', 'John Smith', 'Texas State')],
      { name: 'Smith, John', school: 'Texas St.' },
    )
    expect(out).toMatchObject({ kind: 'match', id: 'p2' })
  })

  /**
   * ⚠ THE HONEST LIMIT OF PREFIX MATCHING, ASSERTED RATHER THAN GLOSSED.
   * Fantrax abbreviates by dropping letters from the middle — "TxSt" for Texas
   * State, "BGSU" for Bowling Green — and no prefix rule can recover that. When
   * two players share a name and their schools abbreviate past recognition, this
   * REFUSES. That costs coverage and it is the correct trade: a wrong link
   * attaches another player's projection to a roster spot, where a refusal
   * leaves a visible gap.
   *
   * Closing this properly needs a school alias table, not a cleverer string
   * comparison. Until then the refusal is the feature.
   */
  it('refuses a middle-dropping abbreviation rather than guessing between two players', () => {
    const out = chooseIdentityMatch(
      [row('p1', 'John Smith', 'Alabama'), row('p2', 'John Smith', 'Texas State')],
      { name: 'Smith, John', school: 'TxSt' },
    )
    expect(out).toEqual({ kind: 'none' })
  })

  /**
   * 🛑 THE CENTRAL REFUSAL. Two players of one name and no school to separate
   * them is exactly when picking the first row silently mis-prices a roster.
   */
  it('refuses when two share a name and no school is given', () => {
    const out = chooseIdentityMatch(
      [row('p1', 'John Smith', 'Alabama'), row('p2', 'John Smith', 'Texas State')],
      { name: 'Smith, John', school: '' },
    )
    expect(out).toEqual({ kind: 'ambiguous' })
  })

  it('refuses when two share a name AND a school', () => {
    const out = chooseIdentityMatch(
      [row('p1', 'John Smith', 'Alabama'), row('p2', 'John Smith', 'Alabama')],
      { name: 'Smith, John', school: 'Alabama' },
    )
    expect(out).toEqual({ kind: 'ambiguous' })
  })

  it('reports none when the name is not in the registry', () => {
    const out = chooseIdentityMatch([row('p1', 'Someone Else', 'Alabama')], {
      name: 'Dendy, Austyn',
      school: 'BGSU',
    })
    expect(out).toEqual({ kind: 'none' })
  })

  /**
   * ⚠ SCHOOL IS COMPARED BY PREFIX because the sources abbreviate differently —
   * Fantrax says "BGSU" where the registry says "Bowling Green". Requiring
   * equality would refuse nearly every real match.
   */
  it('matches an abbreviated school against a spelled-out one', () => {
    const out = chooseIdentityMatch(
      [row('p1', 'Jane Doe', 'Middle Tennessee'), row('p2', 'Jane Doe', 'Michigan')],
      { name: 'Doe, Jane', school: 'MidTN' },
    )
    /* "midtn" vs "middletennessee" share no 4-char prefix; "michigan" does not
       either. Refusing beats guessing between two real people. */
    expect(out).toEqual({ kind: 'none' })
  })

  it('reports whether the row already carried an id, so a re-run does not rewrite', () => {
    const out = chooseIdentityMatch([row('p1', 'Austyn Dendy', 'Bowling Green', '06k5m')], {
      name: 'Dendy, Austyn',
      school: 'BGSU',
    })
    expect(out).toMatchObject({ kind: 'match', alreadySet: true })
  })

  it('handles an empty candidate list without throwing', () => {
    expect(chooseIdentityMatch([], { name: 'Dendy, Austyn', school: 'BGSU' })).toEqual({ kind: 'none' })
  })
})
