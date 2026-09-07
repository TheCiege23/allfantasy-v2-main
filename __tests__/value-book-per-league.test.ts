import { describe, expect, it } from 'vitest'

import { valueBookFor, leagueVariantFor, CROSS_LEAGUE_BOOK } from '@/lib/core-app/valueBook'

/*
 * Which value book a league is priced against.
 *
 * ⚠ WHY THIS SUITE EXISTS. Three surfaces — the player card, the per-league
 * Trades screen and the cross-league trades board — each hardcoded
 * `DYNASTY / SUPERFLEX`, copied from one another *so that they could not
 * disagree*. They agreed perfectly and were jointly wrong: every redraft league
 * was priced off the dynasty book. Nothing failed, no test went red, and the
 * numbers looked entirely plausible, because a wrong book returns a real price
 * for a real player.
 *
 * The fix moves the decision into one derivation, so the failure mode is now a
 * silent mis-derivation rather than a silent copy. That is what these pin.
 */

const RB = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']
const SF = [...RB, 'SUPER_FLEX']

describe('valueBookFor — the league decides its own book', () => {
  /* The bug, stated as a test: this is what every redraft league used to get. */
  it('prices a redraft one-QB league on the REDRAFT one-QB book', () => {
    expect(valueBookFor({ roster_positions: RB }, 'redraft')).toEqual({
      source: 'FANTASYCALC',
      format: 'REDRAFT',
      qbFormat: 'ONE_QB',
    })
  })

  it('prices a dynasty superflex league on the DYNASTY superflex book', () => {
    expect(valueBookFor({ roster_positions: SF }, 'dynasty')).toEqual({
      source: 'FANTASYCALC',
      format: 'DYNASTY',
      qbFormat: 'SUPERFLEX',
    })
  })

  /* The two axes are independent — a redraft league can start two QBs. */
  it('keeps format and qbFormat independent', () => {
    expect(valueBookFor({ roster_positions: SF }, 'redraft').format).toBe('REDRAFT')
    expect(valueBookFor({ roster_positions: SF }, 'redraft').qbFormat).toBe('SUPERFLEX')
    expect(valueBookFor({ roster_positions: RB }, 'dynasty').qbFormat).toBe('ONE_QB')
  })

  /*
   * ⚠ KEEPER IS DYNASTY, matching `getMarketValues` (`isDynasty = dynasty ||
   * keeper`). If this ever diverges, the card and the trade engine price the
   * same league differently — the exact failure the shared module prevents.
   */
  it('treats a keeper league as dynasty, exactly as getMarketValues does', () => {
    expect(valueBookFor({ roster_positions: RB }, 'keeper').format).toBe('DYNASTY')
  })

  /*
   * ⚠ AN UNKNOWN TYPE FALLS TO REDRAFT, NOT DYNASTY. Defaulting the other way
   * would put every unclassified league back on the book this change removes —
   * the bug would survive its own fix.
   */
  it('falls back to REDRAFT when the league type is unknown', () => {
    for (const t of [null, '', 'something-else']) {
      expect(valueBookFor({ roster_positions: RB }, t).format).toBe('REDRAFT')
    }
  })

  it('accepts both spellings of the superflex slot', () => {
    expect(valueBookFor({ roster_positions: ['QB', 'SUPER_FLEX'] }, 'dynasty').qbFormat).toBe('SUPERFLEX')
    expect(valueBookFor({ roster_positions: ['QB', 'superflex'] }, 'dynasty').qbFormat).toBe('SUPERFLEX')
  })

  it('survives absent or malformed settings rather than throwing', () => {
    for (const s of [null, undefined, {}, { roster_positions: 'not-an-array' }, 42]) {
      expect(valueBookFor(s, 'redraft')).toEqual({
        source: 'FANTASYCALC',
        format: 'REDRAFT',
        qbFormat: 'ONE_QB',
      })
    }
  })

  /* The licence boundary travels with the book so no call site can drop it. */
  it('always pins source to FANTASYCALC', () => {
    for (const t of ['dynasty', 'redraft', 'keeper', null]) {
      expect(valueBookFor({ roster_positions: SF }, t).source).toBe('FANTASYCALC')
    }
    expect(CROSS_LEAGUE_BOOK.source).toBe('FANTASYCALC')
  })

  /*
   * The league-less default is dynasty superflex and must stay stated rather
   * than derived — the universal card renders it on screen.
   */
  it('keeps the cross-league default at dynasty superflex', () => {
    expect(CROSS_LEAGUE_BOOK).toEqual({
      source: 'FANTASYCALC',
      format: 'DYNASTY',
      qbFormat: 'SUPERFLEX',
    })
  })
})

describe('leagueVariantFor — the shared predicates marketContextFor also reads', () => {
  it('reports the three traits the trade engine keys on', () => {
    expect(leagueVariantFor({ roster_positions: SF }, 'dynasty')).toEqual({
      superflex: true,
      dynasty: true,
      keeper: false,
    })
    expect(leagueVariantFor({ roster_positions: RB }, 'keeper')).toEqual({
      superflex: false,
      dynasty: false,
      keeper: true,
    })
  })
})
