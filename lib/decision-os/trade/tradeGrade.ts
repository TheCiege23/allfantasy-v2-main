/**
 * THE trade grade — one letter, one label and one recommendation for a deal that has not happened
 * yet, on every surface that shows one. PURE and dependency-free, so a client component can import
 * it without a server module in its graph.
 *
 * 🛑 WHY THIS EXISTS (Guap, 2026-09-24: "make one grade across all the trade surfaces"). Measured
 * the same day, ten producers turned a trade into a letter on seven scales. A deal where you get
 * 1.5× what you send graded:
 *   - A in the Trade Center      (league value, ±10/±25 of the larger side)
 *   - B in the /core Trades list (share of traded value, 65/55/45/35)
 *   - C on the pending-offer card (canonical fairness, ONE letter for both teams — so the partner
 *                                  giving away a third of the value ALSO saw C)
 * and the Trade Center's own text label disagreed with its own letter, because the label measured
 * the gap against the SUM of both sides at 4%/12% while the letter measured it against the LARGER
 * side at 10%/25%.
 *
 * So there is one number and everything else is read off it:
 *   - the number is `percentDiff` on LEAGUE value (`leagueTradeTotals`), signed from the side that
 *     sends `give` — the same figure the Trade Center has always graded on;
 *   - the letter is `projectedLetterFor` (`lib/trade-intel/gradeScale.ts`), unchanged;
 *   - the label and the recommendation use the SAME two bands, so a C always reads "Even" and a B
 *     always reads "Slightly favors you". They can no longer disagree, because nothing else is read.
 *
 * ⚠ THE OTHER SIDE'S LETTER IS THE MIRROR, AND THAT IS EXACT, NOT AN APPROXIMATION. The gap is
 * divided by the larger side, so swapping the sides flips its sign and nothing else — the partner of
 * an A deal holds an F, never another C.
 *
 * ⚠ A RESULT GRADE IS A DIFFERENT QUESTION AND IS NOT THIS. A completed trade's realized grade
 * (`letterFor` in gradeScale — fantasy points actually scored since) answers "how did it turn out";
 * this answers "is this deal good for you, in this league, today". The two are allowed to differ
 * and are labelled apart.
 */
import {
  PROJECTED_EVEN_BAND,
  PROJECTED_STRONG_BAND,
  projectedLetterFor,
  type GradeLetter,
} from '@/lib/trade-intel/gradeScale'

export type TradeGradeAction = 'accept' | 'review' | 'counter' | 'decline'

export type TradeGradeSideAdvantage = 'even' | 'you' | 'opponent'

/** One asset in the graded deal, with both prices. Null prices mean the pricer found nothing. */
export type TradeGradeLine = {
  side: 'give' | 'get'
  name: string
  marketValue: number | null
  leagueValue: number | null
}

/** One asset whose league value differs from its market value, and why. */
export type TradeGradeMove = {
  side: 'give' | 'get'
  name: string
  base: number
  leagueValue: number
  reasons: string[]
}

export type TradeGradeView =
  | {
      graded: true
      /** For the side that sends `give` — "you" on every viewer surface. */
      letter: GradeLetter
      /** For the other side. Always the mirror of `letter`. */
      partnerLetter: GradeLetter
      /** Signed from the `give` side, on league value: + means that side receives more. */
      percentDiff: number
      label: string
      sideAdvantage: TradeGradeSideAdvantage
      action: TradeGradeAction
      recommendation: string
      /** League value each way — the totals the letter is taken on. */
      giveValue: number
      getValue: number
      /** Market value each way, before this league's adjustments. */
      giveMarket: number
      getMarket: number
      /** What the chart underneath is, in a manager's words ("Dynasty · Superflex · 12 teams · PPR"). */
      basis: string
      scoringApplied: boolean
      needApplied: boolean
      /** Why roster need was NOT priced, when it was not. Null when it was, or was never asked for. */
      needGap: string | null
      /** Every asset, so a card can print the value it was graded on beside each one. */
      lines: TradeGradeLine[]
      moves: TradeGradeMove[]
    }
  | {
      graded: false
      /** Why there is no letter, in words a manager can act on. */
      reason: string
      basis: string | null
    }

/**
 * The signed gap, in whole percent of the larger side: + means the `give` side receives more.
 *
 * ⚠ ROUNDED SYMMETRICALLY, AND THAT IS WHAT MAKES THE MIRROR EXACT. `Math.round` rounds a half UP,
 * so −9.5 became −9 (a C) while +9.5 became 10 (a B): the two managers in one offer, each graded
 * from their own side, could read "you C, them C" and "you B, them D". Rounding the magnitude and
 * restoring the sign makes grading the swapped deal and mirroring the grade the same operation.
 */
export function signedGapPct(giveValue: number, getValue: number): number {
  const raw = ((getValue - giveValue) / Math.max(giveValue, getValue, 1)) * 100
  return raw < 0 ? -Math.round(-raw) : Math.round(raw)
}

/** The label for a signed gap. Reads off the letter's own bands, so the two always agree. */
export function tradeGradeLabel(percentDiff: number): { label: string; sideAdvantage: TradeGradeSideAdvantage } {
  if (percentDiff >= PROJECTED_STRONG_BAND) return { label: 'Major win (you)', sideAdvantage: 'you' }
  if (percentDiff >= PROJECTED_EVEN_BAND) return { label: 'Slightly favors you', sideAdvantage: 'you' }
  if (percentDiff > -PROJECTED_EVEN_BAND) return { label: 'Even', sideAdvantage: 'even' }
  if (percentDiff > -PROJECTED_STRONG_BAND) return { label: 'Slightly favors opponent', sideAdvantage: 'opponent' }
  return { label: 'Major overpay', sideAdvantage: 'opponent' }
}

const ACTION_BY_LETTER: Record<GradeLetter, TradeGradeAction> = {
  A: 'accept',
  B: 'accept',
  C: 'review',
  D: 'counter',
  F: 'decline',
}

/**
 * What the grade means for the side that sends `give`. Worded about the DEAL rather than as an
 * order, because the same sentence sits on an offer the manager received and on one they sent.
 */
export function tradeGradeRecommendation(args: { letter: GradeLetter; giveValue: number; getValue: number }): string {
  const gap = Math.round(Math.abs(args.getValue - args.giveValue))
  switch (args.letter) {
    case 'A':
      return 'A clear win on league value. Check lineup fit and injury risk, then take it.'
    case 'B':
      return 'Favors you on league value. Confirm lineup fit and player risk before acting.'
    case 'C':
      return 'Even on league value — decide on roster fit, this week’s lineup and team direction.'
    case 'D':
      return `Favors the other side on league value. A counter needs about ${gap.toLocaleString()} more coming back to reach even.`
    case 'F':
      return `An overpay on league value — about ${gap.toLocaleString()} short. Decline, or ask for substantially more.`
  }
}

/**
 * Grade a deal from its league-value totals.
 *
 * ⚠ ANY UNPRICED ASSET WITHHOLDS THE LETTER. An asset with no price is left out of the totals, so
 * a letter drawn from them would grade a trade that is not the one on the table — the missing
 * player reads as worthless. `/core` Trades already refused on partial coverage ("missing assets
 * were not treated as zero"); the one grade keeps that rule rather than the looser one.
 */
export function gradeTrade(args: {
  giveValue: number
  getValue: number
  giveMarket: number
  getMarket: number
  /** Assets on either side with no price at all. */
  unpriced: number
  /** How many assets each side carries — a side with none is not a trade. */
  giveCount: number
  getCount: number
  basis: string
  scoringApplied: boolean
  needApplied: boolean
  needGap: string | null
  lines: TradeGradeLine[]
  moves: TradeGradeMove[]
  /** Set when the caller already knows the grade cannot be trusted (e.g. a data gap it reported). */
  withheld?: string | null
}): TradeGradeView {
  const basis = args.basis || null
  if (args.withheld) return { graded: false, reason: args.withheld, basis }
  if (args.giveCount === 0 || args.getCount === 0) {
    return { graded: false, reason: 'One side of this trade has no assets recorded.', basis }
  }
  if (args.unpriced > 0) {
    return {
      graded: false,
      reason: `${args.unpriced} asset${args.unpriced === 1 ? ' has' : 's have'} no value on this league's chart, and a missing asset is not graded as worthless.`,
      basis,
    }
  }
  if (!(args.giveValue > 0) || !(args.getValue > 0)) {
    return { graded: false, reason: 'The priced assets carry no usable value.', basis }
  }

  const percentDiff = signedGapPct(args.giveValue, args.getValue)
  const letter = projectedLetterFor({ percentDiff, hasSignal: true })
  const partnerLetter = projectedLetterFor({ percentDiff: -percentDiff, hasSignal: true })
  if (!letter || !partnerLetter) return { graded: false, reason: 'The value gap could not be measured.', basis }

  const { label, sideAdvantage } = tradeGradeLabel(percentDiff)
  return {
    graded: true,
    letter,
    partnerLetter,
    percentDiff,
    label,
    sideAdvantage,
    action: ACTION_BY_LETTER[letter],
    recommendation: tradeGradeRecommendation({ letter, giveValue: args.giveValue, getValue: args.getValue }),
    giveValue: Math.round(args.giveValue),
    getValue: Math.round(args.getValue),
    giveMarket: Math.round(args.giveMarket),
    getMarket: Math.round(args.getMarket),
    basis: args.basis,
    scoringApplied: args.scoringApplied,
    needApplied: args.needApplied,
    needGap: args.needGap,
    lines: args.lines,
    moves: args.moves,
  }
}

/**
 * The other side's letter from one side's letter alone. EXACT, not an estimate: the bands are
 * symmetric about zero and the gap is rounded symmetrically (`signedGapPct`), so A↔F, B↔D and C↔C
 * is precisely what grading the swapped deal returns. Null stays null — no letter, no mirror.
 */
export function mirrorLetter(letter: GradeLetter | null | undefined): GradeLetter | null {
  switch (letter) {
    case 'A':
      return 'F'
    case 'B':
      return 'D'
    case 'C':
      return 'C'
    case 'D':
      return 'B'
    case 'F':
      return 'A'
    default:
      return null
  }
}

/** The same grade seen from the OTHER side of the deal: sides swapped, letters swapped. */
export function mirrorTradeGrade(view: TradeGradeView): TradeGradeView {
  if (!view.graded) return view
  const percentDiff = -view.percentDiff
  const { label, sideAdvantage } = tradeGradeLabel(percentDiff)
  return {
    ...view,
    letter: view.partnerLetter,
    partnerLetter: view.letter,
    percentDiff,
    label,
    sideAdvantage,
    action: ACTION_BY_LETTER[view.partnerLetter],
    recommendation: tradeGradeRecommendation({ letter: view.partnerLetter, giveValue: view.getValue, getValue: view.giveValue }),
    giveValue: view.getValue,
    getValue: view.giveValue,
    giveMarket: view.getMarket,
    getMarket: view.giveMarket,
    lines: view.lines.map((l) => ({ ...l, side: l.side === 'give' ? 'get' : 'give' })),
    moves: view.moves.map((m) => ({ ...m, side: m.side === 'give' ? 'get' : 'give' })),
  }
}
