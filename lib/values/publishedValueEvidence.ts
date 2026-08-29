/**
 * The measurements AllFantasy publishes about the three positions no market prices.
 *
 * 🛑 THIS IS THE PUBLIC RECORD, AND IT MUST NOT DRIFT FROM THE MODEL. Every number here was
 * measured against production and is the JUSTIFICATION for how the valuation code behaves. A
 * page that claims a correlation the code no longer acts on is worse than no page: it is a
 * confident public statement backed by nothing.
 *
 * `__tests__/values/publishedValueEvidence.test.ts` asserts the shares below against
 * `kickerShareAtRank` — the function the pricing actually calls — so the two cannot separate
 * silently. If you change one, that test fails until you change the other.
 *
 * ⚠ EVERY FIGURE CARRIES ITS SAMPLE AND ITS DATE ON PURPOSE. "Kicker rank does not persist" is
 * an opinion; "negative in all six measured season pairs, 2019-2025, n=4,482 games" is a claim
 * someone can check and argue with. Only the second kind belongs on a public page.
 */

/** When these were measured, and against what. */
export const EVIDENCE_MEASURED_ON = '2026-08-29'

export interface SeasonPair {
  label: string
  rho: number
}

/**
 * Kicker rank, year over year, under a real league's own scoring.
 *
 * Not merely unpredictable — INVERTED. Six pairs, all negative.
 */
export const KICKER_YEAR_OVER_YEAR: readonly SeasonPair[] = [
  { label: '2019 → 2020', rho: -0.802 },
  { label: '2020 → 2021', rho: -0.584 },
  { label: '2021 → 2022', rho: -0.349 },
  { label: '2022 → 2023', rho: -0.368 },
  { label: '2023 → 2024', rho: -0.28 },
  { label: '2024 → 2025', rho: -0.348 },
]

/** Weeks 1-9 against weeks 10+, same seasons. Effectively nothing. */
export const KICKER_WITHIN_SEASON: readonly SeasonPair[] = [
  { label: '2019', rho: -0.23 },
  { label: '2020', rho: 0.033 },
  { label: '2021', rho: -0.177 },
  { label: '2022', rho: -0.232 },
  { label: '2023', rho: -0.038 },
  { label: '2024', rho: 0.007 },
  { label: '2025', rho: 0.018 },
]

/**
 * ⚠ MEAN OF THE PER-SEASON FIGURES, NOT ONE CORRELATION OVER POOLED PAIRS. Pooling rank pairs
 * across seasons reports ~+0.97 and is an artefact — ranks restart at 1 every season, so
 * concatenating them manufactures agreement. That error was made and caught while measuring
 * this, and it is stated here so nobody "improves" the number back to the wrong one.
 */
export const KICKER_YOY_MEAN_RHO = -0.455
export const KICKER_WITHIN_MEAN_RHO = -0.088

/** Kicker games behind every figure above. */
export const KICKER_SAMPLE = { games: 4482, seasons: '2019–2025' } as const

/**
 * Share of K1's points per game, averaged over the seven measured seasons.
 *
 * ⚠ MUST EQUAL `kickerShareAtRank` AT THESE RANKS. The test named in the header enforces it.
 */
export const KICKER_FLATNESS: readonly { rank: number; share: number }[] = [
  { rank: 3, share: 0.899 },
  { rank: 6, share: 0.829 },
  { rank: 12, share: 0.768 },
  { rank: 18, share: 0.699 },
  { rank: 24, share: 0.647 },
  { rank: 30, share: 0.529 },
]

/** What the ladder this replaced claimed, for contrast. Both are real numbers. */
export const KICKER_OLD_LADDER = { topValue: 1200, floorValue: 100, impliedSpread: '12×' } as const
export const KICKER_MEASURED_SPREAD = '1.55×'

/**
 * How well value over replacement orders OFFENSIVE players against the market — the control
 * that justifies using it to order defenders, who no market prices.
 *
 * Rank correlation is high at every position; the PRICE per point of VORP is not, which is
 * why VORP supplies the ordering and a separate curve supplies the units.
 */
export const IDP_VORP_CONTROL: readonly { position: string; n: number; spearman: number }[] = [
  { position: 'QB', n: 27, spearman: 0.868 },
  { position: 'RB', n: 47, spearman: 0.933 },
  { position: 'WR', n: 71, spearman: 0.885 },
  { position: 'TE', n: 25, spearman: 0.891 },
]

/**
 * The one number in the IDP stack that is not measured and cannot be.
 *
 * Stated publicly rather than buried, because a reader deserves to know which part of a
 * defender's price is measurement and which is a decision.
 */
export const IDP_CEILING_NOTE =
  'What an elite defender is worth against an elite wide receiver is a product decision, not a ' +
  'measurement. No market prices defenders, so there is no exchange rate to discover. ' +
  'Everything below that ceiling — who outranks whom, and how steeply value decays — is measured.'

/**
 * The two devy signals, and how little they agree.
 *
 * The rank-blend used for offensive values requires sources that agree on ORDER (FantasyCalc
 * against DynastyProcess: 0.939). These do not, so the disagreement is reported rather than
 * averaged away.
 */
export const DEVY_SIGNAL_AGREEMENT: readonly { position: string; n: number; spearman: number }[] = [
  { position: 'WR', n: 134, spearman: 0.348 },
  { position: 'RB', n: 90, spearman: 0.333 },
  { position: 'TE', n: 52, spearman: 0.328 },
  { position: 'QB', n: 51, spearman: 0.58 },
]

export const DEVY_OVERALL_AGREEMENT = { n: 327, spearman: 0.38 } as const
export const DEVY_BLEND_THRESHOLD = { source: 'FantasyCalc vs DynastyProcess', spearman: 0.939 } as const
export const DEVY_COVERAGE = { withAdp: 337, pool: 1720 } as const
