/**
 * Trajectory Foundation — the Snapshot History Service (Deliverable 2).
 *
 * The one reusable entry point. Given ANY `TrajectoryAdapter` and its params it
 * returns the metric's current value, previous value, delta, timestamp, and full
 * history in the common `Trajectory` shape — the single, trustworthy source for
 * "what changed and why" across every Decision OS module.
 *
 * The service is deliberately thin and generic: it owns no metric-specific logic
 * (that lives in adapters) and no math (that lives in the pure delta engine). It
 * orchestrates: load → derive → explain, and propagates the adapter's honest
 * `supported` flag so a current-state-only metric can never masquerade as a trend.
 */
import { deriveTrajectoryCore, type DeltaOptions } from './delta'
import { resolveWhyChanged } from './explain'
import type { Trajectory, TrajectoryAdapter } from './types'

type GetTrajectoryOptions = DeltaOptions

export async function getTrajectory<Params>(
  adapter: TrajectoryAdapter<Params>,
  params: Params,
  options: GetTrajectoryOptions = {},
): Promise<Trajectory> {
  const points = await adapter.load(params)
  const core = deriveTrajectoryCore(adapter.metricId, points, options)
  // Only resolve a reason when there is an actual change (delta) to explain.
  const whyChanged = core.delta ? resolveWhyChanged(adapter, core.history) : null
  return { ...core, supported: adapter.supported, whyChanged }
}
