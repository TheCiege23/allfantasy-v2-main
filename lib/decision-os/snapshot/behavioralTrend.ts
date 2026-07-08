/**
 * Decision OS — Phase A Increment 5: trend derivation over captured snapshots.
 *
 * Deliberately minimal: a chronological time series of each snapshot's own top-level metrics.
 * This is the raw signal a future Mission Control / League Analytics surface would chart — NOT
 * a dashboard, NOT a UI, NOT a forecast. No visualization, scoring, or presentation logic here
 * (out of scope this increment).
 */

import type { BehavioralSnapshotRecord } from './behavioralSnapshotCapture'

export interface BehavioralTrendPoint {
  periodKey: string
  capturedAt: string
  eventCount: number
  completeness: number
}

/**
 * Chronological (oldest → newest) trend points from a set of snapshot records. Pure and
 * deterministic. Dedupes by `periodKey` (last write wins — matches the store's upsert
 * semantics, so a re-run never appears as two points for the same period). Empty input yields
 * an empty trend — never a fabricated point.
 */
export function deriveBehavioralTrend(records: readonly BehavioralSnapshotRecord[]): BehavioralTrendPoint[] {
  const byPeriod = new Map<string, BehavioralSnapshotRecord>()
  for (const r of records) byPeriod.set(r.periodKey, r) // last write wins, same as the store's upsert
  return [...byPeriod.values()]
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    .map((r) => ({
      periodKey: r.periodKey,
      capturedAt: r.capturedAt,
      eventCount: r.eventCount,
      completeness: r.completeness,
    }))
}

/** Simple, honest delta between the first and last trend points. `null` when fewer than 2 points exist. */
export function deriveEventCountDelta(trend: readonly BehavioralTrendPoint[]): number | null {
  if (trend.length < 2) return null
  return trend[trend.length - 1].eventCount - trend[0].eventCount
}
