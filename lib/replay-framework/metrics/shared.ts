/**
 * Decision OS Replay Framework — decision-type-agnostic metrics primitives.
 * Per Phase 11's generalization audit (docs/DECISION_OS_REPLAY_FRAMEWORK_GENERALIZATION_ADR.md):
 * extracted from `tradeReplayMetrics.ts` unchanged (same behavior, same
 * function bodies) so any future `{decisionType}ReplayMetrics.ts` module
 * (waiver, draft, lineup, commissioner_action, roster_move, recommendation)
 * reuses the same histogram/average primitives instead of re-implementing
 * them. Neither function reads or assumes anything trade-specific.
 */

/** Even 10-bucket histogram over a 0–1 (default) or 0–100 (`scaleTo100`) range. */
export function bucketize(values: number[], scaleTo100 = false): Array<{ bucket: string; count: number }> {
  const dist: Array<{ bucket: string; count: number }> = []
  for (let i = 0; i < 10; i++) {
    const min = scaleTo100 ? i * 10 : i * 0.1
    const max = scaleTo100 ? (i + 1) * 10 : (i + 1) * 0.1
    const count = values.filter((v) => (i === 9 ? v >= min && v <= max : v >= min && v < max)).length
    const label = scaleTo100 ? `${min}–${max}` : `${Math.round(min * 100)}–${Math.round(max * 100)}%`
    dist.push({ bucket: label, count })
  }
  return dist
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

/**
 * Magnitude-based buckets for any signed, unbounded delta metric (not
 * naturally 0–100 scaled like `bucketize()`'s inputs) — e.g. trade's
 * `deltaThem` (PPG), or a future decision type's own signed real-valued
 * output (e.g. a Lineup Replay's realized-vs-optimal PPG delta).
 */
export function bucketizeSignedMagnitude(values: number[]): Array<{ bucket: string; count: number }> {
  const buckets: Array<[string, (v: number) => boolean]> = [
    ['zero', (v) => v === 0],
    ['0 to 2 (abs)', (v) => v !== 0 && Math.abs(v) < 2],
    ['2 to 5 (abs)', (v) => Math.abs(v) >= 2 && Math.abs(v) < 5],
    ['5 to 10 (abs)', (v) => Math.abs(v) >= 5 && Math.abs(v) < 10],
    ['10+ (abs)', (v) => Math.abs(v) >= 10],
  ]
  return buckets.map(([bucket, test]) => ({ bucket, count: values.filter(test).length }))
}
