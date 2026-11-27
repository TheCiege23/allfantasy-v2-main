import { describe, expect, it } from 'vitest'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { fairnessFromGrade, idpCeilingGradeCaveat } from '@/lib/decision-os/trade/gradeFairness'

/**
 * The IDP ceiling caveat, on the grade's own scale (2026-11-26).
 *
 * It used to be a range of the route's OLD composite fairness (50 = even, via `computeValueFairness`)
 * and fired when that range crossed 50 — "changes who it favours". The grade beside it is a letter
 * off a value gap (`fairnessScoreFromPercentDiff`, A/F ≥25%, B/D ≥10%, C inside), so the two could
 * disagree: a band crossing 50 can sit entirely inside one C, and a band that never crosses 50 can
 * move the letter from B to A. These pin the caveat to the letter: it speaks only when the letter
 * band actually changes, in letters and N/100 scores, and never beside a withheld grade.
 */

const graded = (percentDiff: number, letter: 'A' | 'B' | 'C' | 'D' | 'F', partnerLetter: 'A' | 'B' | 'C' | 'D' | 'F'): TradeGradeView => ({
  graded: true,
  letter,
  partnerLetter,
  percentDiff,
  label: 'test',
  sideAdvantage: percentDiff > 0 ? 'you' : percentDiff < 0 ? 'opponent' : 'even',
  action: 'review',
  recommendation: 'test',
  giveValue: 1000,
  getValue: 1000,
  giveMarket: 1000,
  getMarket: 1000,
  basis: null,
  scoringApplied: true,
  needApplied: false,
  needGap: null,
  lines: [],
  moves: [],
})
const WITHHELD: TradeGradeView = { graded: false, reason: 'No values on file for this league yet.', basis: null }

/** Sender's side: `received` is what the sender gets, `gave` what the sender sends. */
const band = (low: [number, number], high: [number, number]) => ({
  low: { received: low[0], gave: low[1] },
  high: { received: high[0], gave: high[1] },
})

describe('idpCeilingGradeCaveat — the defender-rate band in letters', () => {
  it('reports both ends as value gaps, N/100 scores and letters on the grade\'s bands', () => {
    // low rate: gets 1000 for 1100 → −9% → C (91); high rate: gets 1150 for 1000 → +13% → B (87)
    const c = idpCeilingGradeCaveat(band([1000, 1100], [1150, 1000]), fairnessFromGrade(graded(3, 'C', 'C')))
    expect(c).toMatchObject({
      gradeLetter: 'C',
      lowPercentDiff: -9,
      lowFairness: 91,
      lowLetter: 'C',
      highPercentDiff: 13,
      highFairness: 87,
      highLetter: 'B',
      changesGrade: true,
    })
    expect(c!.note).toContain('could change the grade from C to B')
    expect(c!.note).toContain('91/100')
    expect(c!.note).toContain('87/100')
  })

  it('a band the OLD gate would flag (it crosses even) but inside one C says nothing', () => {
    // −4% to +6%: the old composite range spanned 50 ("changes who it favours"); the letter is C throughout.
    expect(idpCeilingGradeCaveat(band([960, 1000], [1060, 1000]), fairnessFromGrade(graded(1, 'C', 'C')))).toBeNull()
  })

  it('a band that never crosses even but moves B to A does speak', () => {
    // +11% → B, +29% → A. Same side wins at both ends, so the old gate stayed silent.
    const c = idpCeilingGradeCaveat(band([1120, 1000], [1400, 1000]), fairnessFromGrade(graded(18, 'B', 'D')))
    expect(c).toMatchObject({ lowLetter: 'B', highLetter: 'A', gradeLetter: 'B' })
    expect(c!.note).toContain('could change the grade from B to A')
    expect(c!.note).not.toMatch(/who it favours/)
  })

  it('names both directions when the grade sits inside the band', () => {
    // −15% → D, +15% → B, grade C.
    const c = idpCeilingGradeCaveat(band([850, 1000], [1000, 850]), fairnessFromGrade(graded(0, 'C', 'C')))
    expect(c!.note).toContain('could change the grade from C to D or B')
  })

  it('stays silent when the band does not contain the letter shown (a different pricing pass disagrees)', () => {
    // Band says B..A, but the grade on the league's values reads D — the caveat would contradict the letter.
    expect(idpCeilingGradeCaveat(band([1120, 1000], [1400, 1000]), fairnessFromGrade(graded(-15, 'D', 'B')))).toBeNull()
  })

  it('a withheld grade gets no caveat, whatever the band', () => {
    expect(idpCeilingGradeCaveat(band([1000, 1100], [1150, 1000]), fairnessFromGrade(WITHHELD))).toBeNull()
  })

  it('no band (no defenders in the deal) or an unmeasurable side → no caveat', () => {
    expect(idpCeilingGradeCaveat(null, fairnessFromGrade(graded(3, 'C', 'C')))).toBeNull()
    expect(idpCeilingGradeCaveat(band([0, 1100], [1150, 1000]), fairnessFromGrade(graded(3, 'C', 'C')))).toBeNull()
  })
})
