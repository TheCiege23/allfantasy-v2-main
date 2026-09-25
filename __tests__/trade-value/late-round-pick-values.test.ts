/**
 * 🛑 Rounds 5+ were invented, and out of order (field test, 2026-09-25). FantasyCalc's chart stops at
 * round 4, so a later pick fell through to the historical file or the generic curve and a 2027 8th
 * priced 560 against a 5th at 515. A round past the chart's last is now priced FROM that last round,
 * shrinking by the ratio the chart itself shows between its last two rounds — so a later round can
 * never be worth more than an earlier one.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { livePickValue } from '@/lib/trade-value-console/leagueTradePricing'

const row = (name: string, value: number) => ({ player: { name, position: 'PICK' }, value }) as never
/** A 2027 chart with rounds 1–4 as FantasyCalc publishes them, round-average rows only. */
const CHART = [row('2027 1st', 5000), row('2027 2nd', 2400), row('2027 3rd', 1200), row('2027 4th', 600), row('Some Player', 9000)]

describe('livePickValue — rounds past the chart', () => {
  it('the chart’s own rounds are unchanged', () => {
    expect([1, 2, 3, 4].map((r) => livePickValue(CHART, 2027, r, null))).toEqual([5000, 2400, 1200, 600])
  })

  it('round 5+ decays from round 4 by the chart’s own 3→4 ratio (0.5 here)', () => {
    expect(livePickValue(CHART, 2027, 5, null)).toBe(300)
    expect(livePickValue(CHART, 2027, 6, null)).toBe(150)
  })

  it('never inverts: every later round is worth strictly less than the one before', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => livePickValue(CHART, 2027, r, null)!)
    for (let i = 1; i < values.length; i++) expect(values[i]!, `round ${i + 1}`).toBeLessThan(values[i - 1]!)
  })

  it('a chart whose last two rounds are nearly equal still shrinks each round (ratio capped below 1)', () => {
    const flat = [row('2027 3rd', 1000), row('2027 4th', 990)]
    const r5 = livePickValue(flat, 2027, 5, null)!
    expect(r5).toBeLessThan(990)
    expect(livePickValue(flat, 2027, 6, null)!).toBeLessThan(r5)
  })

  /* Slot averages can put round 4 ABOVE round 3; an uncapped ratio would then make every later round climb. */
  it('a chart whose last round averages above the one before still decays past it', () => {
    const inverted = [row('2027 3rd', 800), row('2027 4th', 820)]
    const r5 = livePickValue(inverted, 2027, 5, null)!
    expect(r5).toBeLessThan(820)
    expect(livePickValue(inverted, 2027, 7, null)!).toBeLessThan(r5)
  })

  it('a season the chart does not carry stays null, so the caller’s own fallback answers', () => {
    expect(livePickValue(CHART, 2029, 5, null)).toBeNull()
    expect(livePickValue(CHART, 2029, 1, null)).toBeNull()
  })

  it('a missing round BELOW the chart’s last is a chart hole, not a late round — null', () => {
    const holey = [row('2027 1st', 5000), row('2027 3rd', 1200)]
    expect(livePickValue(holey, 2027, 2, null)).toBeNull()
  })

  it('only one round on the chart: shrinks at the floor ratio rather than guessing a curve', () => {
    const single = [row('2027 1st', 4000)]
    expect(livePickValue(single, 2027, 2, null)).toBe(1000)
  })
})
