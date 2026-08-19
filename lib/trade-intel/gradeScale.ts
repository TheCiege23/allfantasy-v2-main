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
