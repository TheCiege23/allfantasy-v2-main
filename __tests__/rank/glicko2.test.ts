import { describe, expect, it } from 'vitest'
import {
  GLICKO_DEFAULT_RD,
  conservativeRating,
  decay,
  newRating,
  ratePeriod,
  winProbability,
} from '@/lib/rank/skillRating/glicko2'

describe('Glicko-2', () => {
  /**
   * The worked example in Glickman, "Example of the Glicko-2 system" (2012):
   * 1500/200/0.06 beats 1400/30, loses to 1550/100 and 1700/300, τ = 0.5.
   * Published result: r' = 1464.06, RD' = 151.52, σ' = 0.05999.
   */
  it("reproduces Glickman's published worked example", () => {
    const next = ratePeriod({ rating: 1500, rd: 200, volatility: 0.06 }, [
      { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
    ], 0.5)
    expect(next.rating).toBeCloseTo(1464.06, 1)
    expect(next.rd).toBeCloseTo(151.52, 1)
    expect(next.volatility).toBeCloseTo(0.05999, 4)
  })

  it('beating a stronger opponent is worth more than beating a weaker one', () => {
    const me = { rating: 1500, rd: 100, volatility: 0.06 }
    const strong = ratePeriod(me, [{ opponent: { rating: 1800, rd: 60, volatility: 0.06 }, score: 1 }])
    const weak = ratePeriod(me, [{ opponent: { rating: 1200, rd: 60, volatility: 0.06 }, score: 1 }])
    expect(strong.rating - me.rating).toBeGreaterThan(weak.rating - me.rating)
    expect(weak.rating).toBeGreaterThan(me.rating)
  })

  it('a tie against an equal opponent leaves the rating where it was', () => {
    const me = { rating: 1600, rd: 80, volatility: 0.06 }
    const next = ratePeriod(me, [{ opponent: { rating: 1600, rd: 80, volatility: 0.06 }, score: 0.5 }])
    expect(next.rating).toBeCloseTo(1600, 6)
    expect(next.rd).toBeLessThan(me.rd)
  })

  it('an idle period grows the deviation only, capped at the starting RD', () => {
    const me = { rating: 1700, rd: 60, volatility: 0.06 }
    const idle = ratePeriod(me, [])
    expect(idle.rating).toBe(1700)
    expect(idle.rd).toBeGreaterThan(60)
    expect(decay(me, 100_000).rd).toBe(GLICKO_DEFAULT_RD)
    expect(decay(me, 0)).toEqual(me)
  })

  it('win probability is symmetric and 50% for equals', () => {
    const a = { rating: 1650, rd: 70, volatility: 0.06 }
    const b = { rating: 1500, rd: 120, volatility: 0.06 }
    expect(winProbability(a, b) + winProbability(b, a)).toBeCloseTo(1, 10)
    expect(winProbability(a, a)).toBeCloseTo(0.5, 10)
    expect(winProbability(a, b)).toBeGreaterThan(0.5)
  })

  it('the conservative rating keeps an unproven manager low', () => {
    expect(conservativeRating(newRating())).toBe(1500 - 2 * 350)
    expect(conservativeRating({ rating: 1600, rd: 50, volatility: 0.06 })).toBe(1500)
  })
})
