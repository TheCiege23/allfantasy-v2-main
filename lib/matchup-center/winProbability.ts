/**
 * Matchup win-probability honesty gate (Decision OS Truth Phase 1).
 *
 * The displayed number is a clamped projected-points ratio — an ESTIMATE, not a modeled
 * probability — and it may only be computed when BOTH teams' projected totals are built
 * entirely from real per-player projections. If either total includes the flat per-position
 * fallback, the honest answer is null (rendered as an explicit unavailable state), not a
 * percentage that looks measured.
 */
export type WinProbabilitySide = {
  projectedTotal: number
  projectedTotalIncludesFallback: boolean
}

export function computeMatchupWinProbability(
  left: WinProbabilitySide,
  right: WinProbabilitySide
): number | null {
  if (left.projectedTotalIncludesFallback || right.projectedTotalIncludesFallback) return null
  const totalProj = left.projectedTotal + right.projectedTotal
  if (!(totalProj > 0)) return null
  return Math.max(0.05, Math.min(0.95, left.projectedTotal / totalProj))
}
