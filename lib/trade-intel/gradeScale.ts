/**
 * The trade grade scale, on its own so both the realized grade and any
 * projection score on identical bands.
 *
 * Deliberately dependency-free — no 'server-only', no prisma, no fetch. The
 * grading service is server-only because it talks to providers and the database;
 * the scale itself is arithmetic, and a pure renderer (the email template) must
 * be able to reach it without dragging a server module into its import graph.
 *
 * Note that C spans -40 to 40, so a trade that has produced nothing lands mid-C.
 * That is why "no data" must be detected explicitly rather than read off the
 * letter — see hasNoSignal() in tradeGradeEmail.
 */

export type GradeLetter = 'A' | 'B' | 'C' | 'D' | 'F'

/** Cumulative net within this band of zero reads as a tie rather than a win. */
export const TIE_BAND = 60

export const GRADE_THRESHOLDS: { letter: GradeLetter; minAvgNetPerSeason: number | null }[] = [
  { letter: 'A', minAvgNetPerSeason: 100 },
  { letter: 'B', minAvgNetPerSeason: 40 },
  { letter: 'C', minAvgNetPerSeason: -40 },
  { letter: 'D', minAvgNetPerSeason: -100 },
  { letter: 'F', minAvgNetPerSeason: null },
]

export function letterFor(avgNetPerSeason: number): GradeLetter {
  if (avgNetPerSeason >= 100) return 'A'
  if (avgNetPerSeason >= 40) return 'B'
  if (avgNetPerSeason > -40) return 'C'
  if (avgNetPerSeason > -100) return 'D'
  return 'F'
}

/* ── Projected grades ──────────────────────────────────────────────────────
 *
 * ⚠ A PROJECTED GRADE IS NOT A REALIZED ONE AND MUST NOT USE THE BANDS ABOVE.
 * `GRADE_THRESHOLDS` are `avgNetPerSeason` — points a completed trade actually
 * produced. A deal a manager is still building has produced nothing, so running
 * it through `letterFor` would grade a market-value gap on a scale calibrated
 * for realized fantasy points. The two numbers are not in the same units and the
 * result would be arbitrary.
 *
 * So projections get their own function, in this file rather than beside the UI,
 * so nobody meets one without the other.
 */

/** Value gap, as a percentage, inside which a deal reads as even. */
export const PROJECTED_EVEN_BAND = 10
export const PROJECTED_STRONG_BAND = 25

/**
 * A letter for a deal that has not happened yet.
 *
 * `percentDiff` is the console's own figure, signed from the VIEWER's side:
 * positive means they are receiving more value than they send.
 *
 * ⚠ RETURNS NULL WITHOUT SIGNAL, AND THAT IS THE POINT. `gradeScale`'s own
 * header warns that C spans a wide band, so a trade nobody can price lands
 * mid-C and reads identically to a genuinely even one. Rather than trusting a
 * caller to remember that, this refuses to produce a letter at all when the
 * deal could not be priced — a missing badge is unmistakable in a way a C is
 * not.
 */
export function projectedLetterFor(args: {
  percentDiff: number | null
  /** False when the deal is unpriced or the analyzer reported it degraded. */
  hasSignal: boolean
}): GradeLetter | null {
  if (!args.hasSignal) return null
  const d = args.percentDiff
  if (d == null || !Number.isFinite(d)) return null

  if (d >= PROJECTED_STRONG_BAND) return 'A'
  if (d >= PROJECTED_EVEN_BAND) return 'B'
  if (d > -PROJECTED_EVEN_BAND) return 'C'
  if (d > -PROJECTED_STRONG_BAND) return 'D'
  return 'F'
}
