/**
 * ONE trade grade (Guap, 2026-09-24: "make one grade across all the trade surfaces").
 *
 * 🛑 MEASURED THE SAME DAY: a deal where you get 1.5x what you send graded A in the Trade Center,
 * B in the /core Trades list (share of traded value, 65/55/45/35) and C on the pending-offer card
 * (canonical fairness — one letter for both teams, so the partner losing a third of the value saw C
 * too). And the Trade Center's own label disagreed with its own letter. These pin the one scale.
 */
import { describe, expect, it } from 'vitest'
import { gradeTrade, mirrorTradeGrade, tradeGradeLabel, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

const deal = (giveValue: number, getValue: number, extra: Partial<Parameters<typeof gradeTrade>[0]> = {}) =>
  gradeTrade({
    giveValue,
    getValue,
    giveMarket: giveValue,
    getMarket: getValue,
    unpriced: 0,
    giveCount: 1,
    getCount: 1,
    basis: 'Dynasty · 1QB · 12 teams · PPR',
    scoringApplied: false,
    needApplied: false,
    needGap: null,
    lines: [],
    moves: [],
    ...extra,
  })

const graded = (v: TradeGradeView) => {
  if (!v.graded) throw new Error(`expected a grade, got withheld: ${v.reason}`)
  return v
}

describe('🛑 the 1.5x deal that got three letters', () => {
  it('is an A for the side receiving 1.5x — and an F, not a C, for the side giving it', () => {
    const g = graded(deal(1000, 1500))
    expect(g.percentDiff).toBe(33)
    expect(g.letter).toBe('A')
    expect(g.partnerLetter).toBe('F')
    expect(g.label).toBe('Major win (you)')
  })

  it('seen from the other side it is the exact mirror', () => {
    const them = graded(mirrorTradeGrade(deal(1000, 1500)))
    expect(them.letter).toBe('F')
    expect(them.partnerLetter).toBe('A')
    expect(them.label).toBe('Major overpay')
    expect(them.giveValue).toBe(1500)
    expect(them.getValue).toBe(1000)
    // Grading the swapped deal directly gives the same answer as mirroring it.
    expect(graded(deal(1500, 1000)).letter).toBe(them.letter)
  })
})

describe('the label and the letter cannot disagree', () => {
  const LABEL_FOR = {
    A: 'Major win (you)',
    B: 'Slightly favors you',
    C: 'Even',
    D: 'Slightly favors opponent',
    F: 'Major overpay',
  } as const

  it('across every gap from a 60% loss to a 150% win', () => {
    const seen = new Set<string>()
    for (let get = 400; get <= 2500; get += 3) {
      const g = graded(deal(1000, get))
      expect(g.label).toBe(LABEL_FOR[g.letter])
      expect(graded(deal(get, 1000)).letter).toBe(g.partnerLetter)
      seen.add(g.letter)
    }
    // Positive control: the sweep really crossed every band.
    expect([...seen].sort()).toEqual(['A', 'B', 'C', 'D', 'F'])
  })

  it('🛑 an exact half-point on a band edge grades the same from both sides', () => {
    // 95 of 1000 is 9.5%. Math.round made that −9 (C) one way and +10 (B) the other, so the two
    // managers in one offer could each be told a letter that was not the other's mirror.
    const receiver = graded(deal(1000, 905))
    const proposer = graded(deal(905, 1000))
    expect(receiver.percentDiff).toBe(-10)
    expect(proposer.percentDiff).toBe(10)
    expect(receiver.letter).toBe(proposer.partnerLetter)
    expect(proposer.letter).toBe(receiver.partnerLetter)
    expect([receiver.letter, proposer.letter]).toEqual(['D', 'B'])
  })

  it('an 8% edge is Even — the old label said "Slightly favors you" beside a C', () => {
    const g = graded(deal(1000, 1087))
    expect(g.percentDiff).toBe(8)
    expect(g.letter).toBe('C')
    expect(g.label).toBe('Even')
    expect(tradeGradeLabel(8).label).toBe('Even')
  })

  it('the recommendation follows the letter, and a D names the gap to close', () => {
    expect(graded(deal(1000, 1400)).action).toBe('accept')
    expect(graded(deal(1000, 1050)).action).toBe('review')
    const d = graded(deal(1200, 1000))
    expect(d.letter).toBe('D')
    expect(d.action).toBe('counter')
    expect(d.recommendation).toContain('about 200 more')
    expect(graded(deal(2000, 1000)).action).toBe('decline')
  })
})

describe('no letter from part of a deal', () => {
  it('any unpriced asset withholds the grade, and says why', () => {
    const v = deal(1000, 1500, { unpriced: 1 })
    expect(v.graded).toBe(false)
    if (!v.graded) expect(v.reason).toMatch(/1 asset has no value/)
  })

  it('an empty side is not a trade', () => {
    expect(deal(1000, 1500, { getCount: 0 }).graded).toBe(false)
  })

  it('a caller-known reason wins over the arithmetic', () => {
    const v = deal(1000, 1500, { withheld: 'No league is selected.' })
    expect(v).toEqual({ graded: false, reason: 'No league is selected.', basis: 'Dynasty · 1QB · 12 teams · PPR' })
  })

  it('zero on a side is no signal, not an F', () => {
    expect(deal(0, 1500).graded).toBe(false)
  })
})
