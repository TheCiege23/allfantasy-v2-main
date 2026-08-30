import { describe, expect, it } from 'vitest'

import { isRosteredPlayer, rosterNameKeys } from '@/lib/live/rosterPlayMatch'

/*
 * The join behind /core/live's "Biggest mover" card.
 *
 * ⚠ WHY IT EXISTS. The roster side is `SportsPlayer.name` and the play side is
 * whatever Rolling Insights called the player — two vendors, compared with
 * `===`. Measured on production 2026-08-30 across the 9,412 canonical RI names
 * for the NFL: 8,664 matched exactly, 748 did not, and 208 of those differed by
 * nothing but case. Every pair below is a real divergence from that set, not an
 * invented one.
 *
 * The failure mode is the reason this is worth a suite: no match means the card
 * does not render AT ALL. It reads as a quiet afternoon, not as a broken join —
 * the same silent-absence shape as the fixture map on /core/my-team and the
 * injury book on /core.
 */

const ROSTER = rosterNameKeys([
  'Clark Phillips III',
  'Jessie Bates III',
  'James Pearce Jr',
  'David Sills V',
  "Ja'Marr Chase",
  'Amon-Ra St. Brown',
])

describe('rosterPlayMatch', () => {
  /* The 208 that differ by case alone — the cheapest and largest slice. */
  it('matches across a case difference in a generational suffix', () => {
    expect(isRosteredPlayer(ROSTER, 'Clark Phillips Iii')).toBe(true)
    expect(isRosteredPlayer(ROSTER, 'Jessie Bates Iii')).toBe(true)
  })

  it('matches across a trailing punctuation difference', () => {
    expect(isRosteredPlayer(ROSTER, 'James Pearce Jr.')).toBe(true)
  })

  it('matches across an apostrophe the vendors punctuate differently', () => {
    expect(isRosteredPlayer(ROSTER, 'JaMarr Chase')).toBe(true)
  })

  /*
   * ⚠ A RESIDUAL GAP, PINNED RATHER THAN FIXED. `normalizeMatchName` DELETES
   * punctuation instead of replacing it with a space, so "Amon-Ra" collapses to
   * "amonra" while "Amon Ra" stays "amon ra" — a hyphen and a space do not
   * converge, and this pair still misses.
   *
   * Left alone deliberately. That helper is shared by five callers and its own
   * docblock rests on being conservative; widening it to treat punctuation as a
   * separator is a change to every name join in the codebase, not to this card.
   * Asserted here so the limit is visible and a future widening shows up as a
   * failing expectation rather than as a silent behaviour change.
   */
  it('does NOT yet match a hyphen against a space', () => {
    expect(isRosteredPlayer(ROSTER, 'Amon Ra St Brown')).toBe(false)
    expect(isRosteredPlayer(ROSTER, 'Amon-Ra St Brown')).toBe(true)
  })

  it('matches a plain case difference', () => {
    expect(isRosteredPlayer(ROSTER, 'david sills v')).toBe(true)
  })

  /*
   * ⚠ THE PROPERTY THAT MAKES THIS SAFE FOR A BIND RATHER THAN A LOOKUP. The
   * roster is the user's OWN players, so a false positive attributes another
   * athlete's touchdown to them. `normalizeMatchName` is conservative by design
   * and must never collapse two genuinely different people.
   */
  it('does not match a different player', () => {
    expect(isRosteredPlayer(ROSTER, 'Justin Jefferson')).toBe(false)
    expect(isRosteredPlayer(ROSTER, 'Clark Phillips Sr')).toBe(true) // same stem, suffix stripped
    expect(isRosteredPlayer(ROSTER, 'Clark Philips III')).toBe(false) // one letter apart, not a match
  })

  it('does not match on a first name or a surname alone', () => {
    expect(isRosteredPlayer(ROSTER, 'Clark')).toBe(false)
    expect(isRosteredPlayer(ROSTER, 'Phillips')).toBe(false)
  })

  /* A play with no player attached must never bind to the whole roster. */
  it('refuses an empty or absent play name', () => {
    expect(isRosteredPlayer(ROSTER, null)).toBe(false)
    expect(isRosteredPlayer(ROSTER, '')).toBe(false)
    expect(isRosteredPlayer(ROSTER, '   ')).toBe(false)
  })

  /* An unnameable roster entry must not become a key that matches everything. */
  it('drops roster names that normalise to nothing', () => {
    const keys = rosterNameKeys(['', '   ', '...', 'Real Player'])
    expect(keys.size).toBe(1)
    expect(isRosteredPlayer(keys, '')).toBe(false)
  })

  it('is empty for an empty roster', () => {
    expect(rosterNameKeys([]).size).toBe(0)
    expect(isRosteredPlayer(rosterNameKeys([]), 'Anyone')).toBe(false)
  })
})
