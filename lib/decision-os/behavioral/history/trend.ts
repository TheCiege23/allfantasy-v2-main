/**
 * Decision OS — Phase 3.3 Historical Intelligence: trend comparison.
 *
 * Pure — no IO, no DB, no Date.now() (`snapshots.ts` handles capture/
 * retrieval). Compares two real, already-persisted snapshots; never
 * estimates, interpolates, or fabricates a point that wasn't captured.
 * `insufficient_historical_data` is a first-class result, not an error —
 * the expected, honest state until at least 2 snapshots exist for a league.
 */
import type { LeagueHistoryPoint } from './snapshots'

type TrendDirection = 'up' | 'down' | 'flat'

interface LeagueTrend {
  direction: TrendDirection
  /** Absolute point change in leagueEngagementScore. */
  magnitude: number
  /** Signed point change (current − previous). */
  scoreDelta: number
  previousScore: number
  currentScore: number
  /** ISO timestamp of the snapshot this trend treats as "current". */
  capturedAt: string
  /** ISO timestamp of the snapshot compared against. */
  comparedToCapturedAt: string
}

type LeagueTrendResult =
  | { available: true; trend: LeagueTrend }
  | { available: false; reason: 'insufficient_historical_data'; snapshotCount: number }

/** Score deltas smaller than this are reported as 'flat', not noise-level up/down. */
const FLAT_THRESHOLD = 2

/**
 * `points` must be ordered most-recent-first (index 0 = current), matching
 * `getRecentLeagueSnapshots`'s contract. Needs at least 2 points — with
 * fewer, there is nothing honest to compare against.
 */
export function computeLeagueTrend(points: LeagueHistoryPoint[]): LeagueTrendResult {
  if (points.length < 2) {
    return { available: false, reason: 'insufficient_historical_data', snapshotCount: points.length }
  }

  const [current, previous] = points
  const scoreDelta = current.leagueEngagementScore - previous.leagueEngagementScore
  const magnitude = Math.abs(scoreDelta)
  const direction: TrendDirection = magnitude < FLAT_THRESHOLD ? 'flat' : scoreDelta > 0 ? 'up' : 'down'

  return {
    available: true,
    trend: {
      direction,
      magnitude,
      scoreDelta,
      previousScore: previous.leagueEngagementScore,
      currentScore: current.leagueEngagementScore,
      capturedAt: current.capturedAt,
      comparedToCapturedAt: previous.capturedAt,
    },
  }
}
