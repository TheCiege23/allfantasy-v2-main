import { describe, expect, it } from 'vitest'

import { defenderPricerFrom, valueToRank } from '@/lib/core-app/tradeDefenders'
import { DEFAULT_RANK_CURVE, rankToValue } from '@/lib/projections/tradeGrading'

/*
 * Defenders reach the grader by VALUE and are counted by RANK, so the inversion between the
 * two is the whole correctness of this path. FantasyCalc publishes no defenders at any tier —
 * 331 of 331 traded ones were unpriced before this — and the canonical board answers in the
 * trade engine's own 0–10000 convention, which is what makes the round trip legitimate.
 */
describe('valueToRank', () => {
  /*
   * 🛑 THE PROPERTY THE WHOLE APPROACH RESTS ON. `sideMath` will push this rank straight back
   * through `rankToValue`, so if the inversion is not faithful every defender is priced at
   * something other than what the board said — confidently, and with no test failing.
   */
  it('round-trips through rankToValue', () => {
    for (const value of [10000, 8000, 5500, 5344, 3863, 2129, 1164, 500, 266, 50]) {
      const rank = valueToRank(value)
      expect(rank).not.toBeNull()
      expect(rankToValue(rank!)).toBeCloseTo(value, 6)
    }
  })

  it('is monotonic — a richer defender never ranks worse', () => {
    const ranks = [6000, 4000, 2000, 1000, 400].map((v) => valueToRank(v)!)
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThan(ranks[i - 1])
  })

  /*
   * ⚠ CLAMP, NEVER EXTRAPOLATE. Past either end the curve has no evidence, and continuing the
   * line would hand back a rank below 1 or beyond the sampled floor — both of which
   * `rankToValue` then silently clamps anyway, so the extrapolation would only ever be a
   * wrong number that looked deliberate.
   */
  it('clamps outside the sampled curve rather than extrapolating', () => {
    const first = DEFAULT_RANK_CURVE[0]
    const last = DEFAULT_RANK_CURVE[DEFAULT_RANK_CURVE.length - 1]
    expect(valueToRank(first.value + 10_000)).toBe(first.rank)
    expect(valueToRank(last.value - 1000)).toBe(last.rank)
  })

  it('refuses a value that is not a number', () => {
    expect(valueToRank(Number.NaN)).toBeNull()
    expect(valueToRank(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('defenderPricerFrom', () => {
  const board = {
    valueBySleeperId: { '10933': 3284, '4034': 5500 },
    positionRankBySleeperId: { '10933': 12, '4034': 1 },
    reference: { numTeams: 12, idpStarters: 3, scoringFormat: 'IDP' },
    coverage: { candidates: 5472, priced: 530 },
    computedAt: '2026-09-20T16:14:29.468Z',
  }

  it('prices a defender the board holds, in both currencies', () => {
    const price = defenderPricerFrom(board)('10933')
    expect(price?.value).toBe(3284)
    expect(price?.rank).not.toBeNull()
    /* The rank must carry the value back — the same round trip `sideMath` performs. */
    expect(rankToValue(price!.rank)).toBeCloseTo(3284, 6)
  })

  /*
   * ⚠ A DEFENDER THE BOARD DOES NOT HOLD STAYS UNPRICED, AND THIS IS THE COMMON CASE, NOT AN
   * EDGE ONE: the board prices only defenders it has projection history for — 197 of 331
   * traded ones, and CB worst at 5 of 32. A floor value here would grade a trade on a number
   * nobody measured.
   */
  it('returns nothing for a defender the board does not hold', () => {
    expect(defenderPricerFrom(board)('does-not-exist')).toBeNull()
  })

  /*
   * 🛑 NO BOARD MEANS NO DEFENDER PRICES. `readCanonicalDefenderBoard` returns null when the
   * row is missing OR EXPIRED, so this is also the stale-board path: a cron that stops running
   * degrades to withheld grades rather than to silently ancient ones.
   */
  it('prices nothing when the board is absent or expired', () => {
    expect(defenderPricerFrom(null)('10933')).toBeNull()
    expect(defenderPricerFrom(undefined)('10933')).toBeNull()
  })
})
