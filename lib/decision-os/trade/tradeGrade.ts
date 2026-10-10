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
 *   - the number is `percentDiff` on chart + league-scoring value (`leagueTradeTotals`), signed from the side that
 *     sends `give` — and, on the viewer's own trades when their roster need was priced, on that value
 *     adjusted for their roster (`withYourTeamLetter`, 2026-10-10), with the league-value grade kept in
 *     `market` for the partner and for history;
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
import type { LeagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import type { TradeValueSource } from './valueSource'
import { tradePackageReview } from './tradeEvidence'
import type { RosterSpotCredit } from '@/lib/trade-value/rosterSpotCharge'

/**
 * The open-roster-spot credit an uneven deal earned (`lib/trade-value/rosterSpotCharge.ts`), already inside
 * `giveValue`/`getValue`. `side` is the total it joined, in this view's frame. Not a line: the lines stay one
 * per traded asset, which completed-trade pricing and every per-asset table rely on.
 */
export type TradeRosterSpot = RosterSpotCredit

export type TradeGradeAction = 'accept' | 'review' | 'counter' | 'decline'

export type TradeGradeSideAdvantage = 'even' | 'you' | 'opponent'

/** One asset in the graded deal, with both prices. Null prices mean the pricer found nothing. */
export type TradeGradeLine = {
  side: 'give' | 'get'
  /** Explicit identity for roster-slot checks; absent on older saved evaluations. */
  assetKind?: 'player' | 'pick' | 'faab'
  name: string
  marketValue: number | null
  leagueValue: number | null
  /**
   * The PLAYER RECORD's origin (`sleeper`, `fantasycalc+rolling`, `fantasycalc_pick`, …) — not the
   * value's. Kept for compatibility; read `valueSource` for where the price came from.
   */
  source?: string | null
  /** WHICH evidence priced this asset (`./valueSource.ts`). Null when unpriced; absent before 2026-09-28. */
  valueSource?: TradeValueSource | null
  /** When that evidence was captured (ISO). Only a market chart has one; null for league math or undated sources. */
  valueAsOf?: string | null
  /** The period a league-computed value projects over, e.g. "2026 week 3" for a defender. */
  valueScope?: string | null
}

/** One asset whose league value differs from its market value, and why. */
export type TradeGradeMove = {
  side: 'give' | 'get'
  name: string
  base: number
  leagueValue: number
  reasons: string[]
}

/**
 * Personal roster utility: league value adjusted for the VIEWER's roster need (open starting slots,
 * surplus depth, how thin the waiver wire is at the position). On the viewer's own trades it is what the
 * headline letter is taken on (`withYourTeamLetter`); everywhere else it is reported beside the letter.
 */
export type TradeRosterFit = {
  giveValue: number
  getValue: number
  percentDiff: number
  moves: TradeGradeMove[]
}

/** The league-value grade of a deal whose headline is the your-team letter — what the partner and history see. */
export type TradeMarketGrade = {
  letter: GradeLetter
  partnerLetter: GradeLetter
  percentDiff: number
  label: string
  giveValue: number
  getValue: number
}

export type TradeGradeView =
  | {
      graded: true
      /**
       * For the side that sends `give` — "you" on every viewer surface. On the viewer's own trades, when
       * their roster need was priced, it is the YOUR-TEAM letter (`letterBasis: 'your_team'`); otherwise
       * the league-value letter.
       */
      letter: GradeLetter
      /**
       * For the other side, on LEAGUE VALUE: the mirror of the market letter (`market.letter` under a
       * your-team headline, `letter` otherwise). The other manager's roster is not the one being read.
       */
      partnerLetter: GradeLetter
      /** Signed from the `give` side, on league value: + means that side receives more. */
      percentDiff: number
      label: string
      sideAdvantage: TradeGradeSideAdvantage
      action: TradeGradeAction
      recommendation: string
      /**
       * League value each way — the totals the lines add up to, and the ones a market letter is taken
       * on. Under a your-team headline the letter is taken on `rosterFit`'s totals instead.
       */
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
      /** The roster-spot credit inside the totals, when the player counts differ. Absent on older grades. */
      rosterSpot?: TradeRosterSpot | null
      /** The viewer's roster utility; the your-team letter is taken on it (see `letterBasis`). */
      rosterFit?: TradeRosterFit | null
      /**
       * How `letter`, `percentDiff`, `label`, `action` and `recommendation` were taken. `your_team`
       * (Guap's ruling, 2026-10-10): on the viewer's own trades the headline is league value adjusted for
       * THEIR roster need (`rosterFit`), and `market` keeps the league-value grade every other surface
       * shows. Absent or `market`: the league-value grade.
       */
      letterBasis?: 'market' | 'your_team'
      /** With `letterBasis: 'your_team'`: the same deal's league-value grade. */
      market?: TradeMarketGrade | null
      /**
       * The league type the grade was priced under and how we know it (see `leagueTypeGrading.ts`).
       * Set by the league grader; absent where no league was read.
       */
      leagueType?: LeagueTypeBasis | null
      /**
       * When this letter was FROZEN as a completed trade's original grade (`frozenCompletedGrade.ts`).
       * Absent: a live grade, taken on today's values.
       */
      frozenAt?: string | null
      /**
       * With `frozenAt`: how the frozen original was priced (`frozenCompletedGrade.ts`, 2026-10-03) —
       * `trade_date` on the stored market from the trade's own date, `first_graded` on the values of
       * the day AllFantasy first graded it because no market record covers the trade date. Every
       * surface says which (`gradeMoment`). Absent on a live grade.
       */
      frozenBasis?: 'trade_date' | 'first_graded' | null
      /** The day the frozen letter's values are from: the capture day (`trade_date`) or first-graded moment. */
      pricedAsOf?: string | null
      /** When the trade happened (ISO), when known — so a first-graded label can say how long after. */
      tradeAt?: string | null
      /**
       * Today's re-evaluation of the same deal, beside a frozen original — never merged into it. Null
       * when today's grade is the original (just frozen) or could not be taken.
       */
      current?: { letter: GradeLetter; partnerLetter: GradeLetter; giveValue: number; getValue: number } | null
    }
  | {
      graded: false
      /** Why there is no letter, in words a manager can act on. */
      reason: string
      basis: string | null
      leagueType?: LeagueTypeBasis | null
      /**
       * Set when there is no letter because the transaction is not a trade at all: a Pirate steal
       * (`lib/trade-intel/pirateSteal.ts`). Lets a surface label it and skip it as a "trade".
       */
      kind?: 'pirate_steal'
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
export function tradeGradeRecommendation(args: {
  letter: GradeLetter
  giveValue: number
  getValue: number
  /** What the letter measures. A your-team letter already counts roster fit, so it never says "check it". */
  basis?: 'market' | 'your_team'
}): string {
  const gap = Math.round(Math.abs(args.getValue - args.giveValue))
  if (args.basis === 'your_team') {
    switch (args.letter) {
      case 'A':
        return 'A clear win for your roster. Check injury risk, then take it.'
      case 'B':
        return 'Good for your roster. Confirm player risk before acting.'
      case 'C':
        return 'Even for your roster — decide on this week’s lineup and team direction.'
      case 'D':
        return `Costs your roster more than it adds. A counter needs about ${gap.toLocaleString()} more coming back to reach even.`
      case 'F':
        return `An overpay for your roster — about ${gap.toLocaleString()} short. Decline, or ask for substantially more.`
    }
  }
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
  /** The roster-spot credit ALREADY inside `giveValue`/`getValue`, carried so every surface can show it. */
  rosterSpot?: TradeRosterSpot | null
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
  if (![args.giveValue, args.getValue, args.giveMarket, args.getMarket].every(Number.isFinite) ||
      args.lines.some(line => [line.marketValue, line.leagueValue].some(value => value != null && (!Number.isFinite(value) || value < 0)))) {
    return { graded: false, reason: 'One or more asset values are invalid. Refresh the values before grading this deal.', basis }
  }
  if (!(args.giveValue > 0) || !(args.getValue > 0)) {
    return { graded: false, reason: 'The priced assets carry no usable value.', basis }
  }

  const percentDiff = signedGapPct(args.giveValue, args.getValue)
  const letter = projectedLetterFor({ percentDiff, hasSignal: true })
  const partnerLetter = projectedLetterFor({ percentDiff: -percentDiff, hasSignal: true })
  if (!letter || !partnerLetter) return { graded: false, reason: 'The value gap could not be measured.', basis }

  const { label, sideAdvantage } = tradeGradeLabel(percentDiff)
  const packageReview = tradePackageReview(args.lines, { rosterSpotCharged: Boolean(args.rosterSpot) })
  return {
    graded: true,
    letter,
    partnerLetter,
    percentDiff,
    label,
    sideAdvantage,
    action: packageReview && ACTION_BY_LETTER[letter] === 'accept' ? 'review' : ACTION_BY_LETTER[letter],
    recommendation: packageReview
      ? `Quoted values: ${label.toLowerCase()}. ${packageReview.note}`
      : tradeGradeRecommendation({ letter, giveValue: args.giveValue, getValue: args.getValue }),
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
    ...(args.rosterSpot ? { rosterSpot: args.rosterSpot } : {}),
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

/**
 * THE YOUR-TEAM LETTER (Guap's ruling, 2026-10-10). On the viewer's own trades, when their roster need
 * was priced (`rosterFit`), the headline — letter, gap, label, action and recommendation — moves to
 * league value adjusted for THEIR roster: an empty starting slot you cannot fill off
 * waivers makes the player who fills it worth more to you, and sending surplus depth costs you less. The
 * same bands, so a your-team B is the same distance from even as a market B.
 *
 * The league-value grade is kept whole in `market`, and the partner's letter stays on it: their roster
 * is not the one being read, and a partner letter derived from the viewer's need would be a guess about
 * someone else's team. Contention (a contender's or a seller's window) does NOT move this letter yet —
 * it stays the sentence beside it until a win-now vs future value split has been measured.
 *
 * Unchanged when there is no roster fit (need not priced, or a gap): the headline stays on league value.
 */
export function withYourTeamLetter(view: TradeGradeView): TradeGradeView {
  if (!view.graded || !view.rosterFit) return view
  const fit = view.rosterFit
  const letter = projectedLetterFor({ percentDiff: fit.percentDiff, hasSignal: true })
  if (!letter) return view
  const { label, sideAdvantage } = tradeGradeLabel(fit.percentDiff)
  const packageReview = tradePackageReview(view.lines, { rosterSpotCharged: Boolean(view.rosterSpot) })
  return {
    ...view,
    letter,
    percentDiff: fit.percentDiff,
    label,
    sideAdvantage,
    action: packageReview && ACTION_BY_LETTER[letter] === 'accept' ? 'review' : ACTION_BY_LETTER[letter],
    recommendation: packageReview
      ? `Quoted values: ${label.toLowerCase()}. ${packageReview.note}`
      : tradeGradeRecommendation({ letter, giveValue: fit.giveValue, getValue: fit.getValue, basis: 'your_team' }),
    // `giveValue`/`getValue` stay the league-value totals the lines add up to — every asset table prints
    // them under the lines. The your-team totals the letter is taken on are `rosterFit`'s.
    letterBasis: 'your_team',
    market: {
      letter: view.letter,
      partnerLetter: view.partnerLetter,
      percentDiff: view.percentDiff,
      label: view.label,
      giveValue: view.giveValue,
      getValue: view.getValue,
    },
  }
}

/**
 * The league-value grade of any view: itself, or — under a your-team headline — the market grade it
 * carries, with the headline restored. For every reader whose question is about the DEAL rather than
 * the viewer's roster (the trade agent's "fair for both", the other side's view).
 */
export function marketView(view: TradeGradeView): TradeGradeView {
  if (!view.graded || view.letterBasis !== 'your_team' || !view.market) return view
  const m = view.market
  const { label, sideAdvantage } = tradeGradeLabel(m.percentDiff)
  const packageReview = tradePackageReview(view.lines, { rosterSpotCharged: Boolean(view.rosterSpot) })
  const { letterBasis: _basis, market: _market, ...rest } = view
  return {
    ...rest,
    letter: m.letter,
    partnerLetter: m.partnerLetter,
    percentDiff: m.percentDiff,
    label,
    sideAdvantage,
    action: packageReview && ACTION_BY_LETTER[m.letter] === 'accept' ? 'review' : ACTION_BY_LETTER[m.letter],
    recommendation: packageReview
      ? `Quoted values: ${label.toLowerCase()}. ${packageReview.note}`
      : tradeGradeRecommendation({ letter: m.letter, giveValue: m.giveValue, getValue: m.getValue }),
    giveValue: m.giveValue,
    getValue: m.getValue,
  }
}

/** The league-value letter of any view — the market letter under a your-team headline. */
export function marketLetterOf(view: Extract<TradeGradeView, { graded: true }>): GradeLetter {
  return view.letterBasis === 'your_team' && view.market ? view.market.letter : view.letter
}

/** The same grade seen from the OTHER side of the deal: sides swapped, letters swapped. */
export function mirrorTradeGrade(input: TradeGradeView): TradeGradeView {
  if (!input.graded) return input
  // The other side reads the deal on league value: a your-team headline is the viewer's roster alone.
  const view = marketView(input)
  if (!view.graded) return view
  const percentDiff = -view.percentDiff
  const { label, sideAdvantage } = tradeGradeLabel(percentDiff)
  const packageReview = tradePackageReview(
    view.lines.map(line => ({ ...line, side: line.side === 'give' ? 'get' : 'give' })),
    { rosterSpotCharged: Boolean(view.rosterSpot) },
  )
  return {
    ...view,
    letter: view.partnerLetter,
    partnerLetter: view.letter,
    percentDiff,
    label,
    sideAdvantage,
    action: packageReview && ACTION_BY_LETTER[view.partnerLetter] === 'accept' ? 'review' : ACTION_BY_LETTER[view.partnerLetter],
    recommendation: packageReview
      ? `Quoted values: ${label.toLowerCase()}. ${packageReview.note}`
      : tradeGradeRecommendation({ letter: view.partnerLetter, giveValue: view.getValue, getValue: view.giveValue }),
    giveValue: view.getValue,
    getValue: view.giveValue,
    giveMarket: view.getMarket,
    getMarket: view.giveMarket,
    lines: view.lines.map((l) => ({ ...l, side: l.side === 'give' ? 'get' : 'give' })),
    moves: view.moves.map((m) => ({ ...m, side: m.side === 'give' ? 'get' : 'give' })),
    // The credit stays with the same TOTAL, which this view calls the other side.
    ...(view.rosterSpot ? { rosterSpot: { ...view.rosterSpot, side: view.rosterSpot.side === 'give' ? 'get' : 'give' } as TradeRosterSpot } : {}),
    // The original viewer's personal utility is not the other manager's roster fit.
    rosterFit: null,
    // Today's re-evaluation flips with the original, or the other side reads the wrong "now".
    current: view.current
      ? { letter: view.current.partnerLetter, partnerLetter: view.current.letter, giveValue: view.current.getValue, getValue: view.current.giveValue }
      : view.current,
  }
}
