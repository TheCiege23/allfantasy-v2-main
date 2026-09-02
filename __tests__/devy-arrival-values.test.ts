import { describe, it, expect } from 'vitest'
import {
  ARRIVAL_VALUES,
  ARRIVAL_VALUE_PROVENANCE,
  arrivalValueFor,
} from '@/lib/devy/arrivalValues.generated'

/*
 * The contract, not the numbers. Exact figures move every time the backfill is
 * re-run against a newer draft class or a refreshed FantasyCalc board, and a
 * test pinned to them would fail on a correct refresh — the same reason the
 * draft-rate test was rewritten this way.
 */
describe('arrival values', () => {
  it('is measured and covers all four skill positions', () => {
    expect(ARRIVAL_VALUE_PROVENANCE.measured).toBe(true)
    expect(ARRIVAL_VALUES.map((c) => c.position).sort()).toEqual(['QB', 'RB', 'TE', 'WR'])
  })

  /*
   * ⚠ THE SURVIVORSHIP GUARD, AND THE POINT OF THE WHOLE FILE. `meanOnBoard`
   * conditions on the player having worked out; the expectation divides by every
   * player drafted. If a refactor ever let the expectation drift up to the mean,
   * every devy prospect would be priced as though the bust case does not exist.
   * The two are only equal when every drafted player made the board.
   */
  it('keeps the expectation strictly below the survivorship-conditioned mean', () => {
    for (const cell of ARRIVAL_VALUES) {
      expect(cell.boardHitRate).toBeLessThan(1)
      expect(cell.expectedLow).toBeLessThan(cell.meanOnBoard)
      expect(cell.expectedHigh).toBeLessThan(cell.meanOnBoard)
    }
  })

  it('bounds the band the right way round', () => {
    // Off-board counted as zero is a lower bound; counted as the board minimum
    // is an upper bound. Never the reverse.
    for (const cell of ARRIVAL_VALUES) {
      expect(cell.expectedHigh).toBeGreaterThanOrEqual(cell.expectedLow)
      expect(cell.onBoard).toBeLessThanOrEqual(cell.drafted)
    }
  })

  it('returns null for a position it never measured', () => {
    // Defensive positions are not devy skill assets and must not resolve to a
    // default. Null is the honest answer.
    expect(arrivalValueFor('CB')).toBeNull()
    expect(arrivalValueFor('QB')).not.toBeNull()
  })

  /*
   * ⚠ THE SCALE GAP, PINNED — AND NOTE WHAT IT IS *NOT*.
   *
   * This test previously carried the reasoning that E[value | drafted] coming
   * out above `FIRST_ROUND_IN_MARKET_UNITS` (950) was impossible. That was the
   * wrong comparison: a population expectation is not the price of a tradeable
   * asset, and the two are not required to order any particular way.
   *
   * What IS measured is that the two live on different scales. Against this same
   * board, the top twelve skill players of a class are worth 4,530-5,663 — so a
   * rookie first, which buys one of them, is worth thousands here rather than
   * 950. The pick curve's own note already said it was shape-only with each
   * caller keeping its own scale.
   *
   * The assertion is kept because the GAP is real and load-bearing: anything
   * that starts comparing devy values to pick values has to come here first.
   */
  it('lives on a different scale from the rookie-pick anchor', async () => {
    const { FIRST_ROUND_IN_MARKET_UNITS } = await import('@/lib/pick-curve')
    expect(ARRIVAL_VALUE_PROVENANCE.expectedLow).toBeGreaterThan(FIRST_ROUND_IN_MARKET_UNITS)
  })
})
