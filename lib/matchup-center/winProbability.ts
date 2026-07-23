/**
 * Matchup win-probability honesty gate (Decision OS Truth Phase 1).
 *
 * The displayed number is a clamped projected-points ratio — an ESTIMATE, not a modeled
 * probability — and it may only be computed when BOTH teams' projected totals are built
 * entirely from real per-player projections. If either total includes the flat per-position
 * fallback, or either total is missing/malformed/negative, the honest answer is null
 * (rendered as an explicit unavailable state), never a percentage that looks measured.
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
  const l = left.projectedTotal
  const r = right.projectedTotal
  // Malformed evidence (NaN/Infinity) and negative totals are not evidence.
  if (!Number.isFinite(l) || !Number.isFinite(r) || l < 0 || r < 0) return null
  const totalProj = l + r
  if (!(totalProj > 0)) return null
  return Math.max(0.05, Math.min(0.95, l / totalProj))
}

/**
 * Render helper: converts a 0–1 probability into the two displayed integer percentages.
 * Null in → null out (the caller renders an explicit unavailable state, never 50/50).
 */
export function formatWinProbabilityPercents(
  probabilityLeft: number | null
): { leftPct: number; rightPct: number } | null {
  if (probabilityLeft == null || !Number.isFinite(probabilityLeft)) return null
  const leftPct = Math.round(probabilityLeft * 100)
  return { leftPct, rightPct: 100 - leftPct }
}

/**
 * Sort key on the SAME 0–1 unit as rendering: distance from a coin flip, unknowns last.
 */
export function winProbabilitySortDistance(probabilityLeft: number | null): number {
  const pcts = formatWinProbabilityPercents(probabilityLeft)
  return pcts ? Math.abs(pcts.leftPct - 50) : 999
}
