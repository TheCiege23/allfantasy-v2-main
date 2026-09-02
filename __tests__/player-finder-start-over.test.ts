import { describe, expect, it } from 'vitest'

import { pickStartOver } from '@/lib/core-app/startOver'

/*
 * "Who does he replace?" — the inverse of the replacement question, and the
 * only per-league delta the Player Finder can put on a lineup card.
 *
 * The fixture is the handoff's own example: Kincaid (TE, 11.1 in this league's
 * scoring) on the bench behind Ferguson (TE, 8.7) and a FLEX at 9.1. The
 * handoff's card reads "Swap Ferguson out for Kincaid at FLEX · +2.4"; measured
 * against the slots the weakest ELIGIBLE starter is the TE slot, and the delta
 * is the same +2.4.
 */

const PLAYERS: Record<string, { name: string; position: string | null }> = {
  qb1: { name: 'Josh Allen', position: 'QB' },
  rb1: { name: 'Bijan Robinson', position: 'RB' },
  wr1: { name: 'Puka Nacua', position: 'WR' },
  te1: { name: 'Jake Ferguson', position: 'TE' },
  flx: { name: 'Rome Odunze', position: 'WR' },
}
const PRICES: Record<string, number | null> = { qb1: 22.4, rb1: 18.2, wr1: 16.0, te1: 8.7, flx: 9.1 }
const SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX']
const STARTERS = ['qb1', 'rb1', 'wr1', 'te1', 'flx']

const playerById = (id: string) => PLAYERS[id]
const priceOf = (prices: Record<string, number | null>) => (id: string) => prices[id] ?? null

describe('pickStartOver', () => {
  it('picks the weakest starter whose slot accepts him — the TE, not the higher FLEX', () => {
    const got = pickStartOver({
      benched: { position: 'TE', afPoints: 11.1 },
      starters: STARTERS,
      slots: SLOTS,
      playerById,
      priceOf: priceOf(PRICES),
    })
    expect(got).toMatchObject({ playerId: 'te1', name: 'Jake Ferguson', slot: 'TE', afPoints: 8.7, delta: 2.4 })
  })

  /*
   * ⚠ AN UNPRICED STARTER IS NEVER THE ONE TO DISPLACE. He is unknown, not
   * weak; treating him as zero would bench whoever the feed missed that week.
   */
  it('skips a starter the feed does not carry and takes the next weakest', () => {
    const got = pickStartOver({
      benched: { position: 'TE', afPoints: 11.1 },
      starters: STARTERS,
      slots: SLOTS,
      playerById,
      priceOf: priceOf({ ...PRICES, te1: null }),
    })
    expect(got).toMatchObject({ playerId: 'flx', slot: 'FLEX', delta: 2.0 })
  })

  it('returns null when the benched player himself cannot be priced', () => {
    expect(
      pickStartOver({
        benched: { position: 'TE', afPoints: null },
        starters: STARTERS,
        slots: SLOTS,
        playerById,
        priceOf: priceOf(PRICES),
      }),
    ).toBeNull()
  })

  it('returns null when no starting slot accepts his position', () => {
    expect(
      pickStartOver({
        benched: { position: 'K', afPoints: 9.0 },
        starters: STARTERS,
        slots: SLOTS,
        playerById,
        priceOf: priceOf(PRICES),
      }),
    ).toBeNull()
  })

  /*
   * The same rule the replacement engine uses: eligibility is against the
   * SLOT, so a TE can take SUPER_FLEX from a quarterback if he out-projects
   * him. Position matching would never offer it.
   */
  it('lets a skill player take a superflex slot from a weaker quarterback', () => {
    const got = pickStartOver({
      benched: { position: 'TE', afPoints: 14.0 },
      starters: ['qb1', 'sf'],
      slots: ['QB', 'SUPER_FLEX'],
      playerById: (id) => (id === 'sf' ? { name: 'Backup QB', position: 'QB' } : PLAYERS[id]),
      priceOf: (id) => (id === 'sf' ? 9.5 : PRICES[id] ?? null),
    })
    expect(got).toMatchObject({ playerId: 'sf', slot: 'SUPER_FLEX', delta: 4.5 })
  })

  /*
   * 27 of 164 production rosters store a different number of starters than
   * the league has slots. Then the slot cannot be pinned, the weaker
   * "share any slot" test applies, and `slot` is null so the card can say so.
   */
  it('falls back to shared-slot eligibility when the lineup cannot be pinned', () => {
    const got = pickStartOver({
      benched: { position: 'WR', afPoints: 12.0 },
      starters: ['qb1', 'rb1', 'wr1', 'te1'], // four starters, five slots
      slots: SLOTS,
      playerById,
      priceOf: priceOf(PRICES),
    })
    // RB, WR and TE all share FLEX with a WR; the QB shares nothing. Weakest is the TE.
    expect(got).toMatchObject({ playerId: 'te1', slot: null, delta: 3.3 })
  })

  /* A negative delta is an answer ("the bench is right"), not an absence. */
  it('returns a negative delta rather than hiding a correctly benched player', () => {
    const got = pickStartOver({
      benched: { position: 'TE', afPoints: 5.0 },
      starters: STARTERS,
      slots: SLOTS,
      playerById,
      priceOf: priceOf(PRICES),
    })
    expect(got?.delta).toBeCloseTo(-3.7, 5)
  })
})
