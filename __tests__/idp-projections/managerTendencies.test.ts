import { describe, expect, it } from 'vitest'

import {
  MIN_PRICED_TRADES,
  computeManagerTendencies,
  type TradeSideObservation,
} from '@/lib/psychological-profiles/ManagerTendencyBuilder'

/**
 * `manager_trade_tendencies` has the columns the valuation brief asks for, is read by live
 * code, and has been permanently empty because nothing wrote it. These pin the two things that
 * make a writer safe: that it computes what it claims, and that it declines everything else.
 */

let seq = 0
function side(over: Partial<TradeSideObservation> = {}): TradeSideObservation {
  seq += 1
  return {
    managerKey: 'u1',
    leagueId: 'lg1',
    transactionId: `tx${seq}`,
    valueReceived: 1000,
    valueGiven: 1000,
    picksReceived: 0,
    picksGiven: 0,
    agesReceived: [],
    agesGiven: [],
    ...over,
  }
}

const one = (rows: ReturnType<typeof computeManagerTendencies>) => rows[0]

describe('computeManagerTendencies — what it declines to say', () => {
  it('returns null, not a default, for a manager with too few priced trades', () => {
    /*
     * The columns default to `false`, `false` and `"medium"`. Writing those would assert we
     * looked and found no preference — a different claim from not knowing, and one a reader
     * cannot tell apart from a real finding.
     */
    const rows = computeManagerTendencies([side(), side(), side()])
    expect(one(rows).avg_overpay_ratio).toBeNull()
    expect(one(rows).risk_tolerance).toBeNull()
    expect(one(rows).prefers_picks).toBeNull()
    expect(one(rows).prefers_youth).toBeNull()
  })

  it('never reports a pick preference for someone who has not traded picks', () => {
    const rows = computeManagerTendencies(
      Array.from({ length: 8 }, () => side({ picksReceived: 0, picksGiven: 0 })),
    )
    expect(one(rows).prefers_picks).toBeNull()
    // ...but it did have enough priced trades for the ratio, which is a separate question.
    expect(one(rows).avg_overpay_ratio).not.toBeNull()
  })

  it('never reports an age preference when ages are unknown on one side', () => {
    const rows = computeManagerTendencies(
      Array.from({ length: 8 }, () => side({ agesReceived: [24], agesGiven: [] })),
    )
    expect(one(rows).prefers_youth).toBeNull()
  })

  it('skips a trade it could not price rather than treating it as even', () => {
    const priced = Array.from({ length: MIN_PRICED_TRADES }, () =>
      side({ valueGiven: 1200, valueReceived: 1000 }),
    )
    const unpriced = Array.from({ length: 20 }, () => side({ valueGiven: null, valueReceived: null }))
    const rows = computeManagerTendencies([...priced, ...unpriced])
    // The ratio comes from the five it could price, not diluted toward 1.0 by the twenty it could not.
    expect(one(rows).avg_overpay_ratio).toBeCloseTo(1.2, 3)
    expect(one(rows).pricedTrades).toBe(MIN_PRICED_TRADES)
    // Trade COUNT still includes them: they happened, they just could not be valued.
    expect(one(rows).trades_accepted).toBe(25)
  })
})

describe('computeManagerTendencies — what it does say', () => {
  it('reads an overpay ratio above 1 as giving up more than you get back', () => {
    const rows = computeManagerTendencies(
      Array.from({ length: 6 }, () => side({ valueGiven: 1500, valueReceived: 1000 })),
    )
    expect(one(rows).avg_overpay_ratio).toBeCloseTo(1.5, 3)
    // Routed through the existing predicate rather than a second set of thresholds.
    expect(one(rows).risk_tolerance).toBe('high')
  })

  it('reads a ratio below the floor as a low risk tolerance', () => {
    const rows = computeManagerTendencies(
      Array.from({ length: 6 }, () => side({ valueGiven: 800, valueReceived: 1000 })),
    )
    expect(one(rows).avg_overpay_ratio).toBeCloseTo(0.8, 3)
    expect(one(rows).risk_tolerance).toBe('low')
  })

  it('is symmetric, so a trade and its mirror image cancel', () => {
    /*
     * THE ERROR THIS PINS. Trades are zero-sum — one side's 1.5 is the other's 0.667 — so the
     * population must centre on 1. An arithmetic mean of ratios gives 1.083 for that pair,
     * and the bias compounds until every manager reads as an overpayer. Measured on production
     * before the fix: median 1.56 across 285 managers, 224 of them "high risk".
     */
    const a = computeManagerTendencies(
      Array.from({ length: 6 }, (_, i) =>
        i % 2 === 0
          ? side({ valueGiven: 1500, valueReceived: 1000 })
          : side({ valueGiven: 1000, valueReceived: 1500 }),
      ),
    )
    expect(one(a).avg_overpay_ratio).toBeCloseTo(1.0, 3)
    expect(one(a).risk_tolerance).toBe('medium')
  })

  it('stops one blockbuster from defining a manager', () => {
    const even = Array.from({ length: 5 }, () => side({ valueGiven: 1000, valueReceived: 1000 }))
    const blockbuster = side({ valueGiven: 60000, valueReceived: 10000 })
    const rows = computeManagerTendencies([...even, blockbuster])
    // Geometric: 6^(1/6) ≈ 1.35, well under the 1.83 an arithmetic mean would report.
    expect(one(rows).avg_overpay_ratio!).toBeCloseTo(Math.pow(6, 1 / 6), 2)
    expect(one(rows).avg_overpay_ratio!).toBeLessThan(1.83)
  })

  it('detects a pick accumulator and a pick spender', () => {
    const accumulator = computeManagerTendencies(
      Array.from({ length: 4 }, () => side({ picksReceived: 2, picksGiven: 0 })),
    )
    expect(one(accumulator).prefers_picks).toBe(true)

    const spender = computeManagerTendencies(
      Array.from({ length: 4 }, () => side({ picksReceived: 0, picksGiven: 2 })),
    )
    expect(one(spender).prefers_picks).toBe(false)
  })

  it('detects a manager who trades for younger players', () => {
    const young = computeManagerTendencies(
      Array.from({ length: 4 }, () => side({ agesReceived: [23, 24], agesGiven: [29, 31] })),
    )
    expect(one(young).prefers_youth).toBe(true)

    const veteran = computeManagerTendencies(
      Array.from({ length: 4 }, () => side({ agesReceived: [30], agesGiven: [22] })),
    )
    expect(one(veteran).prefers_youth).toBe(false)
  })

  it('counts distinct leagues and distinct trades, not rows', () => {
    const rows = computeManagerTendencies([
      side({ transactionId: 'tx-a', leagueId: 'lg1' }),
      side({ transactionId: 'tx-a', leagueId: 'lg1' }),
      side({ transactionId: 'tx-b', leagueId: 'lg2' }),
    ])
    expect(one(rows).trades_accepted).toBe(2)
    expect(one(rows).leagues_played).toBe(2)
  })

  it('keeps managers separate and orders by how much is known about them', () => {
    const rows = computeManagerTendencies([
      side({ managerKey: 'quiet' }),
      ...Array.from({ length: 4 }, () => side({ managerKey: 'busy' })),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].user_id).toBe('busy')
    expect(rows[1].user_id).toBe('quiet')
  })

  it('emits no row at all for an unidentified manager', () => {
    // A blank key would collide every unmapped roster into one fictional manager.
    expect(computeManagerTendencies([side({ managerKey: '' })])).toHaveLength(0)
  })
})
