/**
 * The tanking calibration measures saved receipts exactly as the live review measures a pending trade —
 * the same split, the same two conditions — so the line it recommends is the line the check applies.
 */
import { describe, expect, it } from 'vitest'

import {
  receivedValueSplit,
  tallyTankingCalibration,
  tankingSidesFromReceipt,
} from '@/lib/decision-os/trade/tankingCalibration'
import { buildTradeReview, TANK_LINEUP_DROP_SHARE } from '@/lib/decision-os/trade/tradeReview'

const impact = (before: number, delta: number, startersAfter: string[]) => ({
  startingPointsBefore: before,
  startingPointsDelta: delta,
  startersAfter,
})

/** Alpha (proposer) sends its starter p1 and gets p2 (bench) + a pick; Bravo starts p1 afterwards. */
function receipt(over: { alphaDelta?: number; bravoStarters?: string[]; alphaStarters?: string[]; moves?: boolean } = {}) {
  return {
    assets: [
      { side: 'give' as const, name: 'Star Runner', kind: 'player' as const, marketValue: 6000, leagueValue: 6000, source: null, adjustments: [] },
      { side: 'get' as const, name: 'Bench Guy', kind: 'player' as const, marketValue: 1600, leagueValue: 1600, source: null, adjustments: [] },
      { side: 'get' as const, name: '2027 Round 2', kind: 'pick' as const, marketValue: 1500, leagueValue: 1500, source: null, adjustments: [] },
    ],
    canonical: {
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      participants: [
        { rosterId: 'rA', rosterImpact: impact(110, over.alphaDelta ?? -20, over.alphaStarters ?? ['p7']) },
        { rosterId: 'rB', rosterImpact: impact(100, 12, over.bravoStarters ?? ['p1']) },
      ],
      ...(over.moves === false
        ? {}
        : {
            moves: [
              { fromRosterId: 'rA', toRosterId: 'rB', playerId: 'p1', name: 'Star Runner' },
              { fromRosterId: 'rB', toRosterId: 'rA', playerId: 'p2', name: 'Bench Guy' },
            ],
          }),
    },
  } as never
}

describe('tankingSidesFromReceipt', () => {
  it("each side's drop and bench share, from the receipt alone", () => {
    const [alpha, bravo] = tankingSidesFromReceipt(receipt())
    expect(alpha!.dropShare).toBeCloseTo(20 / 110)
    expect(alpha!.benchShare).toBe(1) // p2 does not start; a pick never does
    expect(bravo!.dropShare).toBeCloseTo(-0.12)
    expect(bravo!.benchShare).toBe(0) // p1 starts for Bravo
  })

  it('a received player who starts is starter value', () => {
    const [alpha] = tankingSidesFromReceipt(receipt({ alphaStarters: ['p2'] }))
    expect(alpha!.benchShare).toBeCloseTo(1500 / 3100)
  })

  it('a receipt saved before moves were recorded yields nothing — never a guess', () => {
    expect(tankingSidesFromReceipt(receipt({ moves: false }))).toEqual([])
  })

  it('an unpriced line drops that side', () => {
    const r = receipt() as { assets: Array<{ leagueValue: number | null }> }
    r.assets[1]!.leagueValue = null
    expect(tankingSidesFromReceipt(r as never)).toHaveLength(1) // Bravo still measured
  })
})

describe('agrees with the live check', () => {
  it('the side the calibration counts at the current line is the side the review raises', () => {
    for (const alphaDelta of [-5, -10.9, -11, -30]) {
      const sides = tankingSidesFromReceipt(receipt({ alphaDelta }))
      const counted = tallyTankingCalibration(sides).flaggedAt.find((f) => f.current)!.flagged
      const review = buildTradeReview({
        sides: [{ name: 'Alpha' }, { name: 'Bravo' }],
        gapPct: { ok: true, value: 0 },
        lineup: {
          ok: true,
          value: [
            { startingBefore: 110, startingDelta: alphaDelta, receivedValue: 3100, receivedBenchValue: 3100, sentStarterNames: [] },
            { startingBefore: 100, startingDelta: 12, receivedValue: 6000, receivedBenchValue: 0, sentStarterNames: [] },
          ],
        },
        history: { ok: true, value: [0] },
        inactiveDays: { ok: true, value: [1, 1] },
        playoffPct: { ok: true, value: [50, 50] },
        deadlineAt: { ok: true, value: null },
        now: '2026-11-12T12:00:00.000Z',
      })
      const raised = review.checks.find((c) => c.code === 'tanking_signal')!.status === 'raised'
      expect(counted, `delta ${alphaDelta}`).toBe(raised ? 1 : 0)
    }
  })
})

describe('tallyTankingCalibration', () => {
  it('counts each candidate line, marks the current one, and places percentiles over bench-heavy losers', () => {
    const side = (dropShare: number, benchShare: number) => ({ dropShare, drop: dropShare * 100, before: 100, benchShare })
    const sides = [
      side(0.04, 0.9),
      side(0.12, 0.8),
      side(0.3, 1),
      side(0.3, 0.2), // starter value back: never flagged
      side(-0.1, 1), // gains lineup
    ]
    const t = tallyTankingCalibration(sides)
    expect(t.sides).toBe(5)
    expect(t.benchHeavy).toBe(4)
    expect(t.flaggedAt.map((f) => f.flagged)).toEqual([2, 2, 1, 1, 1])
    expect(t.flaggedAt.find((f) => f.current)!.dropShare).toBe(TANK_LINEUP_DROP_SHARE)
    expect(t.dropPercentiles).toEqual({ p50: 0.12, p75: 0.3, p90: 0.3, p95: 0.3 })
  })

  it('no data is no data', () => {
    const t = tallyTankingCalibration([])
    expect(t.dropPercentiles).toBeNull()
    expect(t.flaggedAt.every((f) => f.pctOfSides === null)).toBe(true)
  })
})

describe('receivedValueSplit', () => {
  it('an unpriced line makes both unknown', () => {
    expect(receivedValueSplit([{ name: 'a', leagueValue: 5 }, { name: 'b', leagueValue: null }], () => false)).toEqual({ receivedValue: null, receivedBenchValue: null })
  })
})
