/**
 * Phase 2C Batch 4 — Projection layer (pure helpers, no DB).
 *
 * Real fantasy-projection infrastructure shared by chimmy-context providers
 * and (later) the recommendation prioritizer. Mirrors the keys / fallback
 * constants used by `server/services/matchupCenterService.ts` so behaviour
 * stays consistent across surfaces.
 *
 * Rules (Phase 2C Batch 4 constraints):
 *   - Pure: no Prisma, no fetch, no I/O.
 *   - Never throws on any input shape.
 *   - Floor / ceiling / volatility / winProbability stay `null` until the
 *     final formulas are approved. We expose them as nullable hooks so
 *     downstream code can wire to the shape today.
 *   - Token-efficient: numeric outputs are rounded to 2 decimals.
 */

const STAT_LINE_PROJECTION_KEYS: ReadonlyArray<string> = [
  "projectedPoints",
  "projected_fantasy_points",
  "projection",
  "proj",
  "pprProjection",
  "halfPprProjection",
] as const

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Extract a numeric projection from a stat-line JSON blob, honouring the
 * same key precedence as `matchupCenterService.projectionFromStatLine`.
 */
export function extractProjectionFromStatLine(statLine: unknown): number | null {
  if (!statLine || typeof statLine !== "object" || Array.isArray(statLine)) {
    return null
  }
  const obj = statLine as Record<string, unknown>
  for (const key of STAT_LINE_PROJECTION_KEYS) {
    const value = obj[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

/**
 * Position-level neutral projection fallback. Mirrors
 * `matchupCenterService.positionProjectionFallback`.
 */
export function positionProjectionFallback(position: string | null | undefined): number {
  const p = (position ?? "").toUpperCase()
  if (p === "QB") return 17
  if (p === "RB") return 12
  if (p === "WR" || p === "TE") return 10
  if (p === "K") return 8
  if (p === "DST" || p === "DEF") return 9
  if (p === "FLEX" || p === "SUPER_FLEX" || p === "SFLX" || p === "SFLEX") return 11
  return 10
}

/**
 * Resolve the projected points for a single player.
 *
 * `actualPoints` acts as the floor (scored points are a guaranteed minimum).
 * Stat-line projection wins when present; otherwise we fall back to the
 * position-neutral baseline.
 */
export function resolveProjectedPoints(
  actualPoints: number | null | undefined,
  statLine: unknown,
  position: string | null | undefined
): number {
  const actual =
    typeof actualPoints === "number" && Number.isFinite(actualPoints)
      ? actualPoints
      : 0
  const fromLine = extractProjectionFromStatLine(statLine)
  if (fromLine != null) return Math.max(actual, fromLine)
  return Math.max(actual, positionProjectionFallback(position ?? null))
}

export type RosterProjectionPlayer = {
  playerId: string
  position: string | null
  actualPoints: number | null
  statLine?: unknown
  /** When true, player counts toward the team total (starters only). */
  isStarter: boolean
}

type RosterProjectionSummary = {
  projectedTotal: number
  /** Floor projection — `null` until formulas land. */
  floor: number | null
  /** Ceiling projection — `null` until formulas land. */
  ceiling: number | null
  /** Volatility / std-dev placeholder — `null` until formulas land. */
  volatility: number | null
  /** Per-position projected totals (starters only). */
  byPosition: Record<string, number>
  /** Per-player resolved projection (starters only). */
  perPlayer: Array<{ playerId: string; position: string | null; projected: number }>
}

export function summarizeRosterProjection(args: {
  players: RosterProjectionPlayer[]
}): RosterProjectionSummary {
  const byPosition: Record<string, number> = {}
  const perPlayer: RosterProjectionSummary["perPlayer"] = []
  let total = 0

  for (const player of args.players ?? []) {
    if (!player || !player.isStarter) continue
    const projected = resolveProjectedPoints(
      player.actualPoints,
      player.statLine ?? null,
      player.position ?? null
    )
    const safe = Number.isFinite(projected) ? projected : 0
    total += safe
    const posKey = (player.position ?? "UNK").toUpperCase()
    byPosition[posKey] = round2((byPosition[posKey] ?? 0) + safe)
    perPlayer.push({
      playerId: player.playerId,
      position: player.position ?? null,
      projected: round2(safe),
    })
  }

  return {
    projectedTotal: round2(total),
    // TODO(Phase 2C Batch 5+): derive floor/ceiling from per-player stat-line
    // distributions (e.g. min/max of available projection sources) and
    // volatility from historical std-dev once approved.
    floor: null,
    ceiling: null,
    volatility: null,
    byPosition,
    perPlayer,
  }
}

type MatchupProjectionInput = {
  yourTeamId: string | null
  opponentTeamId: string | null
  yourActualPoints: number | null
  opponentActualPoints: number | null
  yourProjectedTotal: number | null
  opponentProjectedTotal: number | null
  /** Matchup status from TeamWeekResult. */
  status: "scheduled" | "in_progress" | "final" | "unknown"
}

type MatchupProjectionOutput = {
  /** Projected margin = yourProjected - opponentProjected (rounded). */
  projectedMargin: number | null
  /** Actual margin so far when both sides have actuals. */
  actualMargin: number | null
  /** 0-1 win probability; `null` until formula lands. */
  projectedWinProbability: number | null
  /** Categorical leader: 'you' | 'opponent' | 'even' | 'unknown'. */
  leader: "you" | "opponent" | "even" | "unknown"
  inputs: MatchupProjectionInput
}

export function computeMatchupProjection(
  input: MatchupProjectionInput
): MatchupProjectionOutput {
  const yp = input.yourProjectedTotal
  const op = input.opponentProjectedTotal
  const projectedMargin =
    yp != null && op != null && Number.isFinite(yp) && Number.isFinite(op)
      ? round2(yp - op)
      : null

  const ya = input.yourActualPoints
  const oa = input.opponentActualPoints
  const actualMargin =
    ya != null && oa != null && Number.isFinite(ya) && Number.isFinite(oa)
      ? round2(ya - oa)
      : null

  let leader: MatchupProjectionOutput["leader"] = "unknown"
  // Prefer actual margin when matchup is in progress / final.
  const decisionMargin =
    (input.status === "in_progress" || input.status === "final") &&
    actualMargin != null
      ? actualMargin
      : projectedMargin
  if (decisionMargin != null) {
    if (decisionMargin > 0.05) leader = "you"
    else if (decisionMargin < -0.05) leader = "opponent"
    else leader = "even"
  }

  return {
    projectedMargin,
    actualMargin,
    // TODO(Phase 2C Batch 5+): map (projectedMargin, status, volatility) to
    // a calibrated 0-1 win probability once the model is approved.
    projectedWinProbability: null,
    leader,
    inputs: input,
  }
}
