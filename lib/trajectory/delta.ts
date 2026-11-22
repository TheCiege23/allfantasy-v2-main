/**
 * Trajectory Foundation — the Delta Engine (Deliverable 4).
 *
 * Pure: no IO, no DB, no `Date.now()`. Given two REAL points it computes the
 * change; given a series it derives the trajectory core. It never estimates,
 * interpolates, or fabricates a point that was not actually captured.
 *
 * This generalizes the existing (league-engagement-specific) `computeLeagueTrend`
 * in `lib/decision-os/behavioral/history/trend.ts` — same philosophy
 * (`'up' | 'down' | 'flat'`, a flat-threshold epsilon, honest handling of
 * < 2 points), lifted to any metric and enriched with percentage + confidence +
 * change timestamp as this phase requires.
 */
import type { Trajectory, TrajectoryDelta, TrajectoryDirection, TrajectoryPoint } from './types'

/**
 * Changes with `|absolute| <= flatEpsilon` are reported as `'flat'` rather than
 * noise-level up/down. Made per-call because metrics differ in natural scale
 * (percent-odds vs. a raw 0–100 score). Default `0` → any nonzero change has a
 * direction, and an exactly-zero change is `'flat'`.
 */
const DEFAULT_FLAT_EPSILON = 0

export interface DeltaOptions {
  /** `|change|` at or below this is reported as `'flat'`. Default `0`. */
  flatEpsilon?: number
}

/**
 * Compares two REAL points (previous → current). Callers must pass points that
 * were actually captured; this never manufactures a missing one.
 */
export function computeDelta(
  previous: TrajectoryPoint,
  current: TrajectoryPoint,
  options: DeltaOptions = {},
): TrajectoryDelta {
  const flatEpsilon = options.flatEpsilon ?? DEFAULT_FLAT_EPSILON
  const absolute = current.value - previous.value
  const magnitude = Math.abs(absolute)
  const direction: TrajectoryDirection =
    magnitude <= flatEpsilon ? 'flat' : absolute > 0 ? 'up' : 'down'
  // Percentage is only honest when there is a nonzero base to divide by.
  const percent = previous.value !== 0 ? (absolute / Math.abs(previous.value)) * 100 : null
  // Confidence is the source's own confidence on the current point, or null.
  const confidence = typeof current.confidence === 'number' ? current.confidence : null
  return { absolute, percent, direction, confidence, changedAt: current.timestamp }
}

/**
 * Pure. Given a metric id and its raw points, produce the trajectory core
 * (`current` / `previous` / `delta` / `history`) with no IO. Sorts oldest →
 * newest by ISO timestamp, treats the last point as "current", and only emits a
 * delta when at least two real points exist.
 *
 * Returns everything except `supported` / `whyChanged`, which the service layer
 * attaches (they depend on the adapter, not on the math).
 */
export function deriveTrajectoryCore(
  metricId: string,
  points: TrajectoryPoint[],
  options: DeltaOptions = {},
): Pick<Trajectory, 'metricId' | 'current' | 'previous' | 'delta' | 'history'> {
  const history = [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const current = history.length > 0 ? history[history.length - 1] : null
  const previous = history.length > 1 ? history[history.length - 2] : null
  const delta = current && previous ? computeDelta(previous, current, options) : null
  return { metricId, current, previous, delta, history }
}
