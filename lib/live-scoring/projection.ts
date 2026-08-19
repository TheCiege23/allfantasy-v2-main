/**
 * Live Scoring — pace-based live projection (Phase 2/3).
 *
 * The audited matchup service used `max(currentPoints, staticPositionAverage)` as
 * a "projection", which never tracks game pace. This replaces it with the
 * rest-of-game model used by ESPN/Yahoo: a player's live projected final is their
 * current points plus their pre-game projection scaled by the fraction of game
 * remaining. Pure and sport/concept-agnostic.
 */

import type { LiveGameStatus } from '@/lib/live-scoring/types'

export type LivePlayerProjectionInput = {
  /** Pre-game projected fantasy points for the full game. */
  preGameProjection: number
  /** Points scored so far this game. */
  currentPoints: number
  /** Canonical game status for the player's NFL game. */
  status: LiveGameStatus
  /** Fraction of regulation elapsed in [0,1]; null when no clock is available. */
  fractionElapsed?: number | null
}

export type LivePlayerProjectionResult = {
  /** Projected final fantasy points (current + remaining). */
  projectedFinal: number
  /** Projected points still to come (>= 0). */
  projectedRemaining: number
  /** Difference of current pace vs pre-game projection (over/under-performing). */
  paceDelta: number
}

function clampFraction(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Project a single player's live final score.
 *
 * - `scheduled` → the full pre-game projection (nothing scored yet).
 * - `final` → exactly the current points (game over, no remaining).
 * - live (in_progress/halftime/overtime) → current + preGameProjection × fraction
 *   remaining. Overtime keeps the remaining floor at a small slice so a player in
 *   OT isn't projected to stop scoring.
 *
 * Never projects negative remaining (a player already past their projection keeps
 * their current points as the floor — they don't lose projected production).
 */
export function projectLivePlayerFinal(
  input: LivePlayerProjectionInput,
): LivePlayerProjectionResult {
  const pre = Number.isFinite(input.preGameProjection) ? input.preGameProjection : 0
  const current = Number.isFinite(input.currentPoints) ? input.currentPoints : 0

  if (input.status === 'scheduled') {
    return { projectedFinal: round2(Math.max(pre, 0)), projectedRemaining: round2(Math.max(pre, 0)), paceDelta: 0 }
  }
  if (input.status === 'final' || input.status === 'postponed') {
    return { projectedFinal: round2(current), projectedRemaining: 0, paceDelta: round2(current - pre) }
  }

  // Live (in_progress/halftime/overtime/suspended). In overtime the clock has
  // run out of regulation, but a player can still score — cap elapsed below 1 so
  // a small remaining slice is always projected.
  const elapsed =
    input.status === 'overtime'
      ? Math.min(clampFraction(input.fractionElapsed) || 0.9, 0.9)
      : clampFraction(input.fractionElapsed)
  const remainingFraction = Math.max(0, 1 - elapsed)
  const projectedRemaining = Math.max(0, pre * remainingFraction)
  const projectedFinal = current + projectedRemaining

  // Pace delta: where the player would land extrapolating current pace vs the
  // pre-game line (positive = outperforming). Guard against tiny elapsed values.
  const pacedFull = elapsed > 0.05 ? current / elapsed : current
  const paceDelta = round2(pacedFull - pre)

  return {
    projectedFinal: round2(projectedFinal),
    projectedRemaining: round2(projectedRemaining),
    paceDelta,
  }
}
