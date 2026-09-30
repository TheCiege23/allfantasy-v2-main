/**
 * A player below this league's chart counts as 0, and says so (Guap, 2026-09-30). Case Keenum held a
 * Pirate League twinty 4-for-2 ungraded: FantasyCalc's redraft chart does not list him, its dynasty
 * charts price him at 757 superflex. The refusal to grade a MISSING asset still stands for everything
 * that is genuinely unknown — these pin exactly where the line is.
 */
import { describe, expect, it } from 'vitest'

import { belowChartFloorAsset, belowChartFloorNote, isFloorEligible } from '@/lib/trade-value/belowChartFloor'

const unpriced = (code?: string, position = 'QB') => ({
  unpriced: true as const,
  position,
  ...(code ? { unpricedReason: { code: code as never, label: 'x' } } : {}),
})

describe('isFloorEligible — only an offensive skill player the chart simply omits', () => {
  it('a skill player with no value on file is eligible', () => {
    expect(isFloorEligible(unpriced(), 'QB')).toBe(true)
    expect(isFloorEligible(unpriced('no_value_on_file'), 'WR')).toBe(true)
    // The stale-snapshot refusal is "not on today's board" — the chart omits him.
    expect(isFloorEligible(unpriced('not_on_feed'), 'RB')).toBe(true)
  })

  it('a priced player is not a floor case', () => {
    expect(isFloorEligible({ position: 'QB' }, 'QB')).toBe(false)
  })

  it('defenders, kickers and team defenses stay unpriced — the feed never lists them', () => {
    expect(isFloorEligible(unpriced(undefined, 'LB'), 'LB')).toBe(false)
    expect(isFloorEligible(unpriced(undefined, 'K'), 'K')).toBe(false)
    expect(isFloorEligible(unpriced(undefined, 'DEF'), 'DEF')).toBe(false)
  })

  it('"we could not look" is never "below the chart"', () => {
    for (const code of ['unidentified', 'ambiguous_identity', 'feed_unavailable', 'no_feed_for_sport']) {
      expect(isFloorEligible(unpriced(code), 'QB')).toBe(false)
    }
    // The league's own reason counts too.
    expect(isFloorEligible(unpriced(), 'QB', { code: 'feed_unavailable', label: 'x' })).toBe(false)
  })
})

describe('the floor asset and its sentence', () => {
  it('is priced at 0 and is NOT unpriced', () => {
    const a = belowChartFloorAsset('Case Keenum', 'QB')
    expect(a.value).toBe(0)
    expect(a.assetValue.marketValue).toBe(0)
    expect(a.unpriced).toBeUndefined()
  })

  it('names who counted as 0', () => {
    expect(belowChartFloorNote(['Case Keenum'])).toBe(
      "Case Keenum is below this league's chart — FantasyCalc lists him on its other charts but not this one — so he counts as 0.",
    )
    expect(belowChartFloorNote(['A', 'B', 'A'])).toMatch(/^A and B are below/)
    expect(belowChartFloorNote([])).toBeNull()
  })
})
