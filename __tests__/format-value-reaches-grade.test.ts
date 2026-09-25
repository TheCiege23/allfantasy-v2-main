import { afterEach, describe, expect, it } from 'vitest'

import { gradeTrade } from '@/lib/decision-os/trade/valueGrader'
import type { AssetValueSnapshot, SideTotals } from '@/lib/trade-value/types'

/**
 * The format registry computed an opinion on every asset and the grade ignored it, so a
 * guillotine league and a redraft league graded the same trade identically. These cover
 * the seam that closes that — and, just as importantly, that it stays shut until someone
 * deliberately opens it.
 */

const FLAG = 'DECISION_OS_TRADE_FORMAT_VALUE'

afterEach(() => {
  delete process.env[FLAG]
})

function player(
  fromRosterId: string,
  internalValue: number,
  multiplier: number | null,
): AssetValueSnapshot {
  return {
    kind: 'player',
    fromRosterId,
    toRosterId: fromRosterId === 'A' ? 'B' : 'A',
    playerId: `p-${fromRosterId}-${internalValue}`,
    playerName: `Player ${internalValue}`,
    position: 'WR',
    sources: {} as AssetValueSnapshot['sources'],
    internalValue,
    valuationBasis: 'market',
    formatFit:
      multiplier == null
        ? null
        : { formatId: 'guillotine', label: 'Guillotine', fit: { multiplier, reason: 'test' }, legality: null },
    formatAdjustedValue: multiplier == null ? null : Math.round(internalValue * multiplier),
  }
}

function side(rosterId: string, assets: AssetValueSnapshot[]): SideTotals {
  return {
    rosterId,
    total: assets.reduce((s, a) => s + a.internalValue, 0),
    formatAdjustedTotal: assets.reduce((s, a) => s + (a.formatAdjustedValue ?? a.internalValue), 0),
    assets,
  }
}

/** A lands 5000 of market value; B lands 5000. Even on the baseline, by construction. */
const EVEN_ON_BASELINE = {
  a: side('A', [player('A', 5000, null)]),
  b: side('B', [player('B', 5000, 0.5)]),
}

describe('the format opinion is carried but not yet load-bearing', () => {
  it('grades on the market baseline when the flag is unset', () => {
    const { grade } = gradeTrade(EVEN_ON_BASELINE.a, EVEN_ON_BASELINE.b)

    // 5000 vs 5000 — the 0.5 multiplier on B is ignored entirely.
    expect(grade.valueDifference).toBe(0)
    expect(grade.fairnessScore).toBe(100)
  })

  it('grades identically whether or not a format opinion exists, while the flag is off', () => {
    const withOpinion = gradeTrade(EVEN_ON_BASELINE.a, EVEN_ON_BASELINE.b).grade
    const withoutOpinion = gradeTrade(
      side('A', [player('A', 5000, null)]),
      side('B', [player('B', 5000, null)]),
    ).grade

    expect(withOpinion.valueDifference).toBe(withoutOpinion.valueDifference)
    expect(withOpinion.fairnessScore).toBe(withoutOpinion.fairnessScore)
  })
})

describe('with the flag on, the format decides the verdict', () => {
  it('turns an even-on-market trade into a lopsided one', () => {
    process.env[FLAG] = 'true'
    const { grade } = gradeTrade(EVEN_ON_BASELINE.a, EVEN_ON_BASELINE.b)

    // B's asset is worth half as much in this format: 5000 vs 2500.
    expect(grade.valueDifference).toBe(2500)
    expect(grade.fairnessScore).toBeLessThan(100)
  })

  it('measures fairness against the same totals the difference came from', () => {
    process.env[FLAG] = 'true'
    const { grade } = gradeTrade(EVEN_ON_BASELINE.a, EVEN_ON_BASELINE.b)

    // 2500 / max(5000, 2500) = 50% off → 50, not 2500/5000 against a mixed denominator.
    expect(grade.fairnessScore).toBe(50)
  })

  it('leaves a trade alone when no asset drew an opinion', () => {
    process.env[FLAG] = 'true'
    const { grade } = gradeTrade(
      side('A', [player('A', 4000, null)]),
      side('B', [player('B', 4000, null)]),
    )

    expect(grade.valueDifference).toBe(0)
    expect(grade.fairnessScore).toBe(100)
  })

  it('treats a 1.0 multiplier as "considered, no change"', () => {
    process.env[FLAG] = 'true'
    const { grade } = gradeTrade(
      side('A', [player('A', 3000, 1)]),
      side('B', [player('B', 3000, 1)]),
    )

    expect(grade.valueDifference).toBe(0)
  })

  it('falls back to the baseline when a side carries no adjusted total', () => {
    process.env[FLAG] = 'true'
    const legacySideA: SideTotals = { rosterId: 'A', total: 5000, assets: [player('A', 5000, null)] }
    const legacySideB: SideTotals = { rosterId: 'B', total: 5000, assets: [player('B', 5000, null)] }

    // Snapshots written before `formatAdjustedTotal` existed must still grade, not divide by zero.
    expect(gradeTrade(legacySideA, legacySideB).grade.valueDifference).toBe(0)
  })
})
