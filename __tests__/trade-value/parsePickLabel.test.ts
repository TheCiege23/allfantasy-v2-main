import { describe, it, expect } from 'vitest'
import { parsePickLabel } from '@/lib/parsePickLabel'

/**
 * `lib/parsePickLabel.ts` had NO tests, which is how `/api/trade-evaluator` could answer a
 * null with `{ year: 2025, round: 1 }` for months without anything going red.
 *
 * The refusal cases are the point of this file. A parser that is merely permissive looks
 * identical to a correct one until something downstream turns "I could not read this" into
 * the most valuable asset on the board.
 */
describe('parsePickLabel', () => {
  describe('formats that already worked — regression guard', () => {
    it.each([
      ['2026 3rd Rd', { year: 2026, round: 3 }],
      ['2025 4th', { year: 2025, round: 4 }],
      ['2025 1st Round', { year: 2025, round: 1 }],
      ['2026 2nd Rd (TheCiege24)', { year: 2026, round: 2 }],
      ['2025 Early 1st', { year: 2025, round: 1, bucket: 'early' }],
      ['2026 Mid 2nd', { year: 2026, round: 2, bucket: 'mid' }],
      ['2024 Late 3rd', { year: 2024, round: 3, bucket: 'late' }],
    ])('%s', (label, expected) => {
      expect(parsePickLabel(label)).toEqual(expected)
    })

    it('is case-insensitive', () => {
      expect(parsePickLabel('2026 EARLY 1ST')).toEqual({ year: 2026, round: 1, bucket: 'early' })
    })
  })

  describe('formats added 2026-09-11, because refusing them would have been a regression', () => {
    it('reads a round past the fifth instead of rejecting it', () => {
      // Was null -> priced as a 2025 1st. lib/pick-curve.ts has always accepted any round.
      expect(parsePickLabel('2027 6th')).toEqual({ year: 2027, round: 6 })
      expect(parsePickLabel('2027 10th')).toEqual({ year: 2027, round: 10 })
    })

    it('reads back the "Round N" label the evaluator route emits itself', () => {
      // resolvePickData builds `${year} Round ${round}` — a label its own parser could not read.
      expect(parsePickLabel('2026 Round 3')).toEqual({ year: 2026, round: 3 })
      expect(parsePickLabel('2026 rd 4')).toEqual({ year: 2026, round: 4 })
      expect(parsePickLabel('2026 Late Round 2')).toEqual({ year: 2026, round: 2, bucket: 'late' })
    })
  })

  describe('refuses rather than inventing a pick', () => {
    it.each([
      ['', 'empty'],
      ['   ', 'whitespace'],
      ['Kittens', 'not a pick at all'],
      ['first rounder', 'no year, no digits'],
      ['2026', 'year with no round'],
      ['3rd', 'round with no year'],
      ['1999 1st', 'year outside the 20xx window'],
      ['2026 0th', 'round zero — becomes a FIRST via pickRoundShare Math.max(1, …)'],
      ['2026 Round 0', 'round zero, word form'],
      ['2026 Round 99', 'round beyond any real draft'],
      ['2026 30th', 'round beyond MAX_PARSEABLE_ROUND'],
    ])('%s (%s)', (label) => {
      expect(parsePickLabel(label)).toBeNull()
    })

    it('refuses non-string input without throwing', () => {
      expect(parsePickLabel(null as unknown as string)).toBeNull()
      expect(parsePickLabel(undefined as unknown as string)).toBeNull()
      expect(parsePickLabel(42 as unknown as string)).toBeNull()
    })

    /*
     * ⚠ THE ONE THAT MATTERS MOST. Every string above used to resolve to a 2025 first-round
     * pick downstream. If this ever goes green against a non-null, the default is back.
     */
    it('never returns round 1 for input it cannot read', () => {
      for (const junk of ['', 'Kittens', 'first rounder', '2026 0th', '1999 1st']) {
        const parsed = parsePickLabel(junk)
        expect(parsed).toBeNull()
        expect(parsed?.round).not.toBe(1)
      }
    })
  })
})
