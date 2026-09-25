/**
 * A trade priced for ONE league — the market value, what this league does to it, and why. PURE.
 *
 * 🛑 GUAP'S DECISION, 2026-09-24: THE VERDICT IS GRADED ON THE LEAGUE-ADJUSTED VALUE. "The values
 * have to be crisp and honest and based on the league, scoring, roster need … waiver availability."
 * This overturns the "V5" rule recorded in `formats/applyFormat.ts` — that league effects stay a
 * separate number beside the grade and never move it — for the trade verdict. V5's REASON survives
 * and is what this module is built around: an adjustment nobody can see is the failure, so every
 * line carries its market base AND each adjustment as a factor with a sentence. The grade moves;
 * nothing moves it silently.
 *
 * The adjustments themselves are not invented here. Each comes from a helper that already existed
 * and already bounds itself:
 *   - scoring: `scoringFit` — this league's reception weight per position against the chart's
 *     (the real TE premium, not a flat 15%); clamped to [0.5, 2.0].
 *   - need:    `counterpartyPriceDelta` — the roster's open starting slots, priced by how many
 *     players at that position are actually on this league's waiver wire; +15% at most when a
 *     claim fixes it, +60% at most when nothing is available, −4% for surplus depth.
 * This module only combines them, caps the product, and totals the deal.
 */

import { signedGapPct } from './tradeGrade'

export type LeagueValueAdjustmentKind = 'scoring' | 'need'

export type LeagueValueAdjustment = {
  kind: LeagueValueAdjustmentKind
  /** Multiplier on the market value. 1 means "looked, no effect" and is never stored. */
  factor: number
  /** One sentence, in a manager's words, naming the rule or the roster fact behind the factor. */
  reason: string
}

export type LeagueValuedLine = {
  /** The market value for this league's format (dynasty/redraft, 1QB/SF, size, PPR). Null = unpriced. */
  base: number | null
  /** `base` after this league's adjustments. Null exactly when `base` is. */
  leagueValue: number | null
  adjustments: LeagueValueAdjustment[]
}

/*
 * ⚠ THE PRODUCT IS CAPPED, NOT ONLY EACH FACTOR. Scoring can reach 2.0 and need 1.6 on their own;
 * stacked, a tight end in a big TE-premium league with an empty wire could otherwise read as more
 * than three times his market price, which no trade market would pay. The cap keeps the combined
 * move inside the range either helper is individually trusted with.
 */
export const LEAGUE_FACTOR_MIN = 0.5
export const LEAGUE_FACTOR_MAX = 2.0

/** Apply this league's adjustments to one line's market value. Factors of exactly 1 are dropped. */
export function applyLeagueAdjustments(
  base: number | null | undefined,
  adjustments: ReadonlyArray<LeagueValueAdjustment | null | undefined>,
): LeagueValuedLine {
  const kept = adjustments.filter(
    (a): a is LeagueValueAdjustment => a != null && Number.isFinite(a.factor) && a.factor > 0 && a.factor !== 1,
  )
  if (base == null || !Number.isFinite(base)) return { base: null, leagueValue: null, adjustments: kept }
  const product = kept.reduce((p, a) => p * a.factor, 1)
  const factor = Math.min(LEAGUE_FACTOR_MAX, Math.max(LEAGUE_FACTOR_MIN, product))
  return { base: Math.round(base), leagueValue: Math.round(base * factor), adjustments: kept }
}

export type LeagueTradeTotals = {
  giveBase: number
  getBase: number
  giveLeague: number
  getLeague: number
  /**
   * Signed from the viewer's side, on the LEAGUE values: + means the viewer receives more.
   * The same formula the console has always used, so every letter band keeps its meaning.
   */
  percentDiff: number
  /** How many lines on each side had no price at all — left out of the totals, and said so. */
  unpriced: number
}

export function leagueTradeTotals(
  give: ReadonlyArray<LeagueValuedLine>,
  get: ReadonlyArray<LeagueValuedLine>,
): LeagueTradeTotals {
  const sum = (lines: ReadonlyArray<LeagueValuedLine>, key: 'base' | 'leagueValue') =>
    lines.reduce((s, l) => s + (l[key] ?? 0), 0)
  const giveLeague = sum(give, 'leagueValue')
  const getLeague = sum(get, 'leagueValue')
  // The same rounding as the grade itself (`signedGapPct`), so the figure shown and the letter agree.
  const percentDiff = giveLeague > 0 ? signedGapPct(giveLeague, getLeague) : 0
  return {
    giveBase: sum(give, 'base'),
    getBase: sum(get, 'base'),
    giveLeague,
    getLeague,
    percentDiff,
    unpriced: [...give, ...get].filter((l) => l.base == null).length,
  }
}

/**
 * What the chart underneath this league's values IS, in a manager's words — shown beside every
 * league-graded verdict, so a number never appears without the rules it was priced under.
 */
export function describeValueBasis(args: {
  dynasty: boolean
  superflex: boolean
  teams: number | null
  ppr: number
  tePremium?: number | null
}): string {
  const parts = [
    args.dynasty ? 'Dynasty' : 'Redraft',
    args.superflex ? 'Superflex' : '1QB',
    args.teams ? `${args.teams} teams` : null,
    args.ppr === 1 ? 'PPR' : args.ppr === 0.5 ? 'Half PPR' : 'Standard',
    args.tePremium && args.tePremium > 0 ? `TE premium +${Number(args.tePremium.toFixed(2))}` : null,
  ]
  return parts.filter(Boolean).join(' · ')
}
