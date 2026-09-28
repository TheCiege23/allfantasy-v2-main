import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { letterFor, projectedLetterFor } from '@/lib/trade-intel/gradeScale'

const SCALE = readFileSync(resolve(process.cwd(), 'lib/trade-intel/gradeScale.ts'), 'utf8')
const SCREEN = readFileSync(
  resolve(process.cwd(), 'components/core-app/screens/TradeCenter.tsx'),
  'utf8',
)

/**
 * A projected grade and a realized one are different measurements. The realized
 * bands are avgNetPerSeason — points a completed trade produced. A deal being
 * built has produced nothing.
 */

describe('projectedLetterFor', () => {
  it('⚠ returns NULL without signal, rather than a C', () => {
    /*
     * THE WHOLE REASON THIS FUNCTION EXISTS RATHER THAN AN INLINE TERNARY.
     * gradeScale's own header warns C spans a wide band, so an unpriced trade
     * lands mid-C and reads identically to a genuinely even one. A missing badge
     * is unmistakable in a way a C is not.
     */
    expect(projectedLetterFor({ percentDiff: 40, hasSignal: false })).toBeNull()
    expect(projectedLetterFor({ percentDiff: null, hasSignal: true })).toBeNull()
    expect(projectedLetterFor({ percentDiff: Number.NaN, hasSignal: true })).toBeNull()
  })

  it('grades from the viewer’s side', () => {
    expect(projectedLetterFor({ percentDiff: 40, hasSignal: true })).toBe('A')
    expect(projectedLetterFor({ percentDiff: 15, hasSignal: true })).toBe('B')
    expect(projectedLetterFor({ percentDiff: 2, hasSignal: true })).toBe('C')
    expect(projectedLetterFor({ percentDiff: -15, hasSignal: true })).toBe('D')
    expect(projectedLetterFor({ percentDiff: -40, hasSignal: true })).toBe('F')
  })

  it('is symmetric, so the two sides mirror', () => {
    expect(projectedLetterFor({ percentDiff: 40, hasSignal: true })).toBe('A')
    expect(projectedLetterFor({ percentDiff: -40, hasSignal: true })).toBe('F')
  })

  it('⚠ does NOT share bands with the realized scale', () => {
    /*
     * letterFor takes avgNetPerSeason. Feeding it a percentage gap would grade a
     * market-value delta on a scale calibrated for realized fantasy points — the
     * two are not in the same units and the result would be arbitrary.
     */
    expect(letterFor(40)).toBe('B')
    expect(projectedLetterFor({ percentDiff: 40, hasSignal: true })).toBe('A')
    expect(SCALE).toContain('MUST NOT USE THE BANDS ABOVE')
    expect(SCALE).toContain('not in the same units')
  })

  it('lives beside the realized scale so nobody meets one without the other', () => {
    expect(SCALE).toContain('export function letterFor')
    expect(SCALE).toContain('export function projectedLetterFor')
  })
})

describe('the screen honours the no-letter rule', () => {
  /*
   * Trade OS (2026-09-27): the screen's letters come ONLY from the server's one grade. The
   * `projectedLetterFor(percentDiff)` fallback it kept for older responses was a second copy of the
   * arithmetic run in the browser; with it gone, "no grade on the response" means "no badge".
   */
  it('⚠ renders a badge only when a letter came back', () => {
    expect(SCREEN).toContain('g.letter ? (')
  })

  it('takes both letters from the server grade, and computes none itself', () => {
    expect(SCREEN).toMatch(/const yourGrade = serverGrade\?\.graded \? serverGrade\.letter : null/)
    expect(SCREEN).toMatch(/const theirGrade = serverGrade\?\.graded \? serverGrade\.partnerLetter : null/)
    // Not imported at all. (The file's comments name the removed call, so match the import, not the word.)
    expect(SCREEN).not.toMatch(/import[^\n]*projectedLetterFor/)
  })
})
