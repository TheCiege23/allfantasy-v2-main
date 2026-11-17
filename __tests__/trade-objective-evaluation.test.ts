import { describe, expect, it } from 'vitest'
import { hasNoSignal, type TradeSide } from '@/lib/projections/tradeGrading'

/*
 * The per-side `evaluateTrade` and the rank-space `gradeTrade` that lived in
 * `lib/projections/tradeGrading.ts` were deleted on 2026-09-26 — neither had a runtime caller, and
 * the one trade engine is `lib/decision-os/trade/evaluateTrade.ts`. The coverage guard they sat on
 * is still exported and still used by `lib/core-app`, so it keeps its tests.
 */
describe('the coverage guard still governs', () => {
  const priced = (id: string, rank: number | null): TradeSide['assets'][number] => ({ id, rank, rawValue: null })

  it('refuses a single-sided trade', () => {
    expect(hasNoSignal({ label: 'a', assets: [] }, { label: 'b', assets: [priced('x', 1)] })).toBe(true)
  })

  it('refuses partial coverage, rather than pricing the missing asset at zero', () => {
    const partial = { label: 'x', assets: [priced('known', 10), priced('unknown', null)] }
    expect(hasNoSignal(partial, { label: 'y', assets: [priced('z', 40)] })).toBe(true)
  })

  it('allows a fully covered trade — the control that lets the two above fail', () => {
    expect(hasNoSignal({ label: 'a', assets: [priced('star', 5)] }, { label: 'b', assets: [priced('y1', 40), priced('y2', 60)] })).toBe(false)
  })
})
