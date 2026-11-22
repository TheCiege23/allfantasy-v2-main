/**
 * Trajectory Foundation — current-state (UNSUPPORTED) adapter.
 *
 * The honest home for metrics that have NO historical store — only a value for
 * "now" (league health / fairness / sustainability, matchup projected margin,
 * injury impact, recommendation count, lineup confidence; see AUDIT.md). It
 * yields at most one real point, so `getTrajectory` returns `delta: null` and
 * `supported: false`. The value can be surfaced; movement can never be implied.
 *
 * This is the guiding principle made mechanical: *current state is not history.*
 * When a real per-time store later exists for one of these metrics, swap in a
 * supported adapter — nothing downstream changes shape.
 */
import type { TrajectoryAdapter, TrajectoryPoint } from '../types'

interface CurrentStateParams {
  /** The single, real, current value. */
  value: number
  /** ISO-8601 timestamp of the observation. */
  timestamp: string
  /** Source-provided confidence in [0, 1], only if the engine reports one. */
  confidence?: number
  label?: string
}

/**
 * Creates an UNSUPPORTED adapter for a current-state-only metric. Always returns
 * exactly one point (or none), guaranteeing `delta: null` / `supported: false`.
 */
export function createCurrentStateAdapter(
  metricId: string,
): TrajectoryAdapter<CurrentStateParams> {
  return {
    metricId,
    supported: false,
    async load(params): Promise<TrajectoryPoint[]> {
      return [
        {
          value: params.value,
          timestamp: params.timestamp,
          confidence: params.confidence,
          label: params.label,
        },
      ]
    },
  }
}
