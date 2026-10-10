/**
 * The your-team NFL letter (Guap's ruling, 2026-10-10): on the viewer's own trades the headline letter is
 * league value adjusted for THEIR roster need; the league-value grade is kept beside it in `market`, the
 * partner's letter stays on it, and contention does not move it.
 */
import { describe, expect, it } from 'vitest'
import {
  gradeTrade,
  marketLetterOf,
  marketView,
  mirrorTradeGrade,
  withYourTeamLetter,
  type TradeGradeView,
} from '@/lib/decision-os/trade/tradeGrade'
import { qualifyDeal } from '@/lib/decision-os/trade/tradeAgentRules'

type Graded = Extract<TradeGradeView, { graded: true }>

// A deal even on league value (+3: C), that fills an empty TE slot nobody on waivers can (+16 for this roster: B).
function market(fit: { giveValue: number; getValue: number; percentDiff: number } | null = { giveValue: 5000, getValue: 5928, percentDiff: 16 }): Graded {
  const view = gradeTrade({
    giveValue: 5000, getValue: 5153, giveMarket: 5000, getMarket: 4500, unpriced: 0, giveCount: 1, getCount: 1,
    basis: 'Dynasty · Superflex · 12 teams · PPR', scoringApplied: true, needApplied: false, needGap: null,
    lines: [{ side: 'give', name: 'Kenneth Walker', marketValue: 5000, leagueValue: 5000 }, { side: 'get', name: 'Trey McBride', marketValue: 4500, leagueValue: 5153 }],
    moves: [],
  })
  if (!view.graded) throw new Error('withheld')
  return { ...view, rosterFit: fit ? { ...fit, moves: [] } : null }
}

describe('withYourTeamLetter', () => {
  it('takes the headline on the roster fit and keeps the league-value grade whole beside it', () => {
    const before = market()
    const v = withYourTeamLetter(before) as Graded
    expect([v.letterBasis, v.letter, v.percentDiff, v.label, v.sideAdvantage, v.action]).toEqual(['your_team', 'B', 16, 'Slightly favors you', 'you', 'accept'])
    expect(v.market).toEqual({ letter: 'C', partnerLetter: 'C', percentDiff: 3, label: 'Even', giveValue: 5000, getValue: 5153 })
    // The partner reads league value: their roster is not the one being read.
    expect(v.partnerLetter).toBe('C')
    // The totals stay what the lines add up to.
    expect([v.giveValue, v.getValue, v.lines]).toEqual([before.giveValue, before.getValue, before.lines])
  })

  it('says what a your-team letter means — it already counts roster fit', () => {
    const v = withYourTeamLetter(market()) as Graded
    expect(v.recommendation).toBe('Good for your roster. Confirm player risk before acting.')
    expect(market().recommendation).toContain('on league value')
    const overpay = withYourTeamLetter(market({ giveValue: 5000, getValue: 3500, percentDiff: -30 })) as Graded
    expect([overpay.letter, overpay.recommendation]).toEqual(['F', 'An overpay for your roster — about 1,500 short. Decline, or ask for substantially more.'])
  })

  it('leaves a grade with no roster fit on league value — need was not priced, so nothing moves', () => {
    const v = market(null)
    expect(withYourTeamLetter(v)).toBe(v)
    expect(withYourTeamLetter({ graded: false, reason: 'unpriced', basis: null })).toEqual({ graded: false, reason: 'unpriced', basis: null })
  })
})

describe('reading the league-value grade back', () => {
  it('restores the league-value headline exactly', () => {
    const original = market()
    const back = marketView(withYourTeamLetter(original)) as Graded
    expect(back).toEqual(original)
    expect(marketLetterOf(withYourTeamLetter(original) as Graded)).toBe('C')
    expect(marketLetterOf(original)).toBe('C')
  })

  it('shows the other side the league-value grade, never the viewer’s roster', () => {
    const mirrored = mirrorTradeGrade(withYourTeamLetter(market())) as Graded
    expect(mirrored).toEqual(mirrorTradeGrade(market()))
    expect([mirrored.letter, mirrored.letterBasis, mirrored.market]).toEqual(['C', undefined, undefined])
  })
})

describe('the trade agent keeps asking "fair on league value, and both rosters gain"', () => {
  it('qualifies a deal both sides read as your-team B, because both market letters are C', () => {
    const v = withYourTeamLetter(market())
    expect(qualifyDeal(v, v)).toEqual({ ok: true, viewerFitPct: 16, partnerFitPct: 16 })
  })

  it('refuses a deal that reads C for your team but is uneven on league value', () => {
    // -12 on league value (D), but the fit lifts it to even for this roster.
    const lopsided = gradeTrade({
      giveValue: 5000, getValue: 4400, giveMarket: 5000, getMarket: 4400, unpriced: 0, giveCount: 1, getCount: 1,
      basis: 'x', scoringApplied: false, needApplied: false, needGap: null, lines: [], moves: [],
    }) as Graded
    const v = withYourTeamLetter({ ...lopsided, rosterFit: { giveValue: 4600, getValue: 4400, percentDiff: 4, moves: [] } }) as Graded
    expect(v.letter).toBe('C')
    expect(qualifyDeal(v, v)).toMatchObject({ ok: false, why: 'reads D/D, not C/C' })
  })
})
