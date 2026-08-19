import { describe, expect, it } from 'vitest'

import {
  blendByRank,
  buildAfValues,
  valueAtRankFrom,
  buildAfPickValues,
  type SourceEntries,
} from '@/lib/trade-intel/afValue'

/**
 * Real numbers, measured 2026-08-13 for a 12-team superflex dynasty league.
 * The scale mismatch is the whole reason this module blends ranks, not values.
 */
const FC: SourceEntries = {
  source: 'fantasycalc',
  entries: [
    { sleeperId: 'strange', value: 1589 },
    { sleeperId: 'shaheed', value: 1388 },
    { sleeperId: 'marks', value: 1318 },
  ],
}
const DP: SourceEntries = {
  source: 'dynastyprocess',
  entries: [
    { sleeperId: 'strange', value: 563 },
    { sleeperId: 'shaheed', value: 280 },
    { sleeperId: 'marks', value: 187 },
  ],
}

describe('rank interpolation over the reference curve', () => {
  const at = valueAtRankFrom([1000, 900, 800, 700])

  it('reads exact ranks straight off the curve', () => {
    expect(at(1)).toBe(1000)
    expect(at(3)).toBe(800)
  })

  it('interpolates a fractional rank between neighbours', () => {
    // A blended rank of 1.5 sits halfway between the 1st and 2nd values.
    expect(at(1.5)).toBe(950)
    expect(at(2.25)).toBe(875)
  })

  it('clamps outside the curve instead of extrapolating into nonsense', () => {
    expect(at(0)).toBe(1000)
    expect(at(99)).toBe(700)
    expect(valueAtRankFrom([])(1)).toBeNull()
  })
})

describe('blending happens in rank space', () => {
  const blended = buildAfValues([FC, DP], 'fantasycalc')

  it('produces a value on the REFERENCE scale, not an average of raw values', () => {
    const strange = blended.get('strange')!
    // Raw mean of 1589 and 563 would be 1076 — meaningless, the units differ.
    expect(strange.value).toBe(1589)
    expect(strange.readings.map((r) => r.raw).sort((a, b) => b - a)).toEqual([1589, 563])
  })

  it('agrees on order despite a 2.8x to 7x scale mismatch', () => {
    // Both sources rank these three identically, so blending changes no ordering.
    expect(blended.get('strange')!.blendedRank).toBe(1)
    expect(blended.get('shaheed')!.blendedRank).toBe(2)
    expect(blended.get('marks')!.blendedRank).toBe(3)
  })

  it('reports zero rank gap when the sources agree exactly', () => {
    expect(blended.get('strange')!.rankGap).toBe(0)
    expect(blended.get('strange')!.confidence).toBe('high')
    expect(blended.get('strange')!.sources).toEqual(['fantasycalc', 'dynastyprocess'])
  })
})

describe('confidence reflects real disagreement', () => {
  const curve = valueAtRankFrom(Array.from({ length: 300 }, (_, i) => 10000 - i * 30))

  it('is high when the sources are within ordinary disagreement', () => {
    // Measured median gap across commonly-priced players is 16.
    const v = blendByRank(
      [
        { source: 'fantasycalc', rank: 142, raw: 1589 },
        { source: 'dynastyprocess', rank: 128, raw: 563 },
      ],
      curve,
    )!
    expect(v.rankGap).toBe(14)
    expect(v.confidence).toBe('high')
    expect(v.blendedRank).toBe(135)
  })

  it('drops to low when the sources tell different stories', () => {
    const v = blendByRank(
      [
        { source: 'fantasycalc', rank: 40, raw: 5000 },
        { source: 'dynastyprocess', rank: 190, raw: 200 },
      ],
      curve,
    )!
    expect(v.rankGap).toBe(150)
    expect(v.confidence).toBe('low')
  })

  it('never calls a single uncorroborated source high confidence', () => {
    const v = blendByRank([{ source: 'fantasycalc', rank: 10, raw: 8000 }], curve)!
    // Null, not 0 — one opinion cannot agree with itself.
    expect(v.rankGap).toBeNull()
    expect(v.confidence).toBe('moderate')
    expect(v.sources).toEqual(['fantasycalc'])
  })
})

describe('degrading rather than guessing', () => {
  it('still values a player only one source prices', () => {
    const orphan = buildAfValues(
      [FC, { source: 'dynastyprocess', entries: [{ sleeperId: 'strange', value: 563 }] }],
      'fantasycalc',
    )
    const shaheed = orphan.get('shaheed')!
    expect(shaheed.sources).toEqual(['fantasycalc'])
    expect(shaheed.confidence).toBe('moderate')
  })

  it('returns nothing at all when the reference source is missing', () => {
    // Without the reference curve there is no scale to express a blend in.
    expect(buildAfValues([DP], 'fantasycalc').size).toBe(0)
  })

  it('ignores non-positive and malformed values rather than ranking them', () => {
    const dirty = buildAfValues(
      [
        {
          source: 'fantasycalc',
          entries: [
            { sleeperId: 'good', value: 500 },
            { sleeperId: 'zero', value: 0 },
            { sleeperId: 'nan', value: Number.NaN },
          ],
        },
      ],
      'fantasycalc',
    )
    expect([...dirty.keys()]).toEqual(['good'])
  })
})

describe('cross-source spread is the honest uncertainty', () => {
  const curve = valueAtRankFrom(Array.from({ length: 300 }, (_, i) => 10000 - i * 30))

  it('reports the value-unit gap between the sources', () => {
    // Ranks 128 and 142 on a 30/rank curve -> 14 ranks * 30 = 420.
    const v = blendByRank(
      [
        { source: 'fantasycalc', rank: 142, raw: 1589 },
        { source: 'dynastyprocess', rank: 128, raw: 563 },
      ],
      curve,
    )!
    expect(v.valueSpread).toBe(420)
  })

  it('is null with a single source rather than 0', () => {
    // 0 would claim a precision nothing tested.
    const v = blendByRank([{ source: 'fantasycalc', rank: 10, raw: 8000 }], curve)!
    expect(v.valueSpread).toBeNull()
  })

  it('grows with disagreement, which is the point', () => {
    const tight = blendByRank(
      [{ source: 'fantasycalc', rank: 100, raw: 1 }, { source: 'dynastyprocess', rank: 102, raw: 1 }],
      curve,
    )!
    const wide = blendByRank(
      [{ source: 'fantasycalc', rank: 40, raw: 1 }, { source: 'dynastyprocess', rank: 190, raw: 1 }],
      curve,
    )!
    expect(wide.valueSpread!).toBeGreaterThan(tight.valueSpread!)
  })
})

describe('picks blend among themselves, not against players', () => {
  const FC_PICKS = { source: 'fantasycalc' as const, byRound: { '2026:1': 3526, '2026:2': 1689, '2026:3': 1124, '2026:4': 844 } }
  const DP_PICKS = { source: 'dynastyprocess' as const, byRound: { '2026:1': 1200, '2026:2': 520, '2026:3': 300, '2026:4': 180 } }

  it('prices on the reference scale despite a ~3x scale mismatch', () => {
    const picks = buildAfPickValues([FC_PICKS, DP_PICKS], 'fantasycalc')
    // Both sources order the rounds identically, so ranks agree exactly.
    expect(picks.get('2026:1')!.value).toBe(3526)
    expect(picks.get('2026:2')!.value).toBe(1689)
    expect(picks.get('2026:2')!.rankGap).toBe(0)
    expect(picks.get('2026:2')!.confidence).toBe('high')
    expect(picks.get('2026:2')!.sources).toEqual(['fantasycalc', 'dynastyprocess'])
  })

  it('still prices a round only one source covers, uncorroborated', () => {
    const picks = buildAfPickValues(
      [FC_PICKS, { source: 'dynastyprocess', byRound: { '2026:1': 1200 } }],
      'fantasycalc',
    )
    const r3 = picks.get('2026:3')!
    expect(r3.sources).toEqual(['fantasycalc'])
    expect(r3.confidence).toBe('moderate')
  })

  it('returns nothing without the reference source', () => {
    expect(buildAfPickValues([DP_PICKS], 'fantasycalc').size).toBe(0)
  })
})
