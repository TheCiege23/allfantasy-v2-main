import { describe, expect, it } from 'vitest'

import {
  chopMargin,
  faabPurchasingPower,
  floorOverCeilingNote,
  guillotineHorizon,
} from '@/lib/trade-intel/guillotine'

/**
 * One team is chopped per period and its whole roster hits waivers. You are not
 * trying to beat an opponent, you are trying not to be last — which inverts
 * enough of the normal model that guillotine needs its own.
 */

describe('guillotineHorizon: a trade decays toward zero as the field shrinks', () => {
  it('⚠ the same trade is worth a fraction of itself later in the season', () => {
    /*
     * A player only generates value for the weeks you are still alive, and the
     * field shrinks every week. This is the manager's own observation and it
     * falls straight out of the survival maths.
     */
    const early = guillotineHorizon({ teamsRemaining: 18, startingTeams: 18 })!
    const mid = guillotineHorizon({ teamsRemaining: 9, startingTeams: 18 })!
    const late = guillotineHorizon({ teamsRemaining: 3, startingTeams: 18 })!

    expect(early.tradeValueMultiplier).toBeCloseTo(1, 5)
    expect(mid.tradeValueMultiplier).toBeLessThan(early.tradeValueMultiplier)
    expect(late.tradeValueMultiplier).toBeLessThan(mid.tradeValueMultiplier)
    expect(late.tradeValueMultiplier).toBeLessThan(0.2)
  })

  it('⚠ expected weeks alive is (T−1)/2, and the assumption is stated', () => {
    /*
     * Under equal odds the chance of surviving k more weeks is (T−k)/T, so the
     * expectation is exactly (T−1)/2. That is a real derivation rather than a
     * tuned constant — and it is only true under equal odds, which the basis
     * string says out loud so a manager clear of the line can discount it.
     */
    const h = guillotineHorizon({ teamsRemaining: 11, startingTeams: 18 })!
    expect(h.expectedWeeksAlive).toBe(5)
    expect(h.basis).toContain('even chance of being chopped')
  })

  it('counts the rosters still to be dumped on the wire', () => {
    const h = guillotineHorizon({ teamsRemaining: 7, startingTeams: 18 })!
    expect(h.releasesRemaining).toBe(6)
  })

  it('says the end is imminent when two are left', () => {
    const h = guillotineHorizon({ teamsRemaining: 2, startingTeams: 18 })!
    expect(h.basis).toContain('almost no time to pay you back')
  })

  it('handles multi-chop leagues rather than assuming one a week', () => {
    const h = guillotineHorizon({ teamsRemaining: 9, startingTeams: 18, teamsPerChop: 2 })!
    expect(h.weeksToEnd).toBe(4)
  })

  it('withholds on impossible inputs instead of returning a number', () => {
    expect(guillotineHorizon({ teamsRemaining: 20, startingTeams: 18 })).toBeNull()
    expect(guillotineHorizon({ teamsRemaining: 0, startingTeams: 18 })).toBeNull()
  })
})

describe('chopMargin: the distance that matters is to the BOTTOM', () => {
  const scores = [
    { rosterId: 'a', points: 140 },
    { rosterId: 'b', points: 120 },
    { rosterId: 'c', points: 101 },
    { rosterId: 'd', points: 95 },
  ]

  it('⚠ measures against the lowest score, not the average', () => {
    /*
     * Finishing eighth of ten is fine; finishing tenth ends the season. Distance
     * to the mean is the wrong question in this format and it is the question
     * every other model asks.
     */
    const m = chopMargin({ scores, rosterId: 'a' })!
    expect(m.margin).toBe(45)
    expect(m.basis).toContain('clear of the chop')
  })

  it('flags a team sitting on the line', () => {
    const m = chopMargin({ scores, rosterId: 'c' })!
    expect(m.onTheLine).toBe(true)
    expect(m.basis).toContain('floor matters more than upside')
  })

  it('reports the bottom team as behind, not ahead', () => {
    const m = chopMargin({ scores, rosterId: 'd' })!
    expect(m.margin).toBeLessThan(0)
    expect(m.basis).toContain('last by')
  })

  it('withholds when there is nothing to compare', () => {
    expect(chopMargin({ scores: [{ rosterId: 'a', points: 100 }], rosterId: 'a' })).toBeNull()
    expect(chopMargin({ scores, rosterId: 'zz' })).toBeNull()
  })
})

describe('faabPurchasingPower: measured, not assumed', () => {
  const bids = [1, 2, 3, 5, 8, 12, 18, 25, 40, 60]

  it('⚠ reports what a dollar actually buys in THIS league', () => {
    /*
     * The generic heuristic prices FAAB as a linear share of some anchor. In
     * guillotine every chop dumps a full roster on the wire, so what a dollar
     * buys is a fact about this league's bidding and nothing else.
     */
    const p = faabPurchasingPower({ winningBids: bids })!
    expect(p.sampleSize).toBe(10)
    expect(p.basis).toContain('acquisition market here')
  })

  it('⚠ refuses to quote a median off a handful of bids', () => {
    // A confident number resting on two claims is worse than no number.
    expect(faabPurchasingPower({ winningBids: [10, 20] })).toBeNull()
  })

  it('ignores malformed bids rather than letting them move the median', () => {
    const p = faabPurchasingPower({ winningBids: [...bids, Number.NaN, -5] })!
    expect(p.sampleSize).toBe(10)
  })
})

describe('floorOverCeilingNote: said when it matters, not every week', () => {
  it('⚠ fires late, because a warning that fires always is wallpaper', () => {
    const early = guillotineHorizon({ teamsRemaining: 16, startingTeams: 18 })!
    const late = guillotineHorizon({ teamsRemaining: 4, startingTeams: 18 })!
    expect(floorOverCeilingNote(early)).toBeNull()
    expect(floorOverCeilingNote(late)).toContain('not trying to outscore an opponent')
  })

  it('⚠ says the advice is the opposite of head-to-head', () => {
    // Upside wins a head-to-head week and loses a guillotine season. A manager
    // carrying normal instincts into this format needs telling.
    const late = guillotineHorizon({ teamsRemaining: 3, startingTeams: 18 })!
    expect(floorOverCeilingNote(late)).toContain('opposite of the advice')
  })
})
