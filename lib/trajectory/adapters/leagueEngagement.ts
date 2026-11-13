/**
 * Trajectory Foundation — League Engagement adapter (Deliverable 3,
 * SUPPORTED-WHEN-POPULATED).
 *
 * WRAPS the existing, merged decision-os league-history reader
 * (`lib/decision-os/behavioral/history/snapshots.ts`, backed by the INSERT-only
 * `IntelligenceLeagueSnapshotHistory` ledger). It does NOT reimplement or
 * redesign that module — this phase's job is to normalize its output into the
 * common trajectory shape, not to duplicate its capture/retrieval.
 *
 * `supported: true` because a real store backs it — but it honestly returns `[]`
 * (→ `delta: null`) until the Decision OS intelligence capture path has written
 * at least one row for the league. No fabricated trend before then.
 */
import {
  getRecentLeagueSnapshots,
  type LeagueHistoryPoint,
  type LeagueSnapshotHistoryDeps,
} from '@/lib/decision-os/behavioral/history/snapshots'
import type { TrajectoryAdapter, TrajectoryPoint } from '../types'

/** Numeric fields on the league-history ledger that form a real series. */
type LeagueEngagementMetricField =
  | 'leagueEngagementScore'
  | 'tradeActivityRate'
  | 'waiverActivityRate'
  | 'draftActivityRate'

const LEAGUE_ENGAGEMENT_METRIC_IDS: Record<LeagueEngagementMetricField, string> = {
  leagueEngagementScore: 'league.engagementScore',
  tradeActivityRate: 'league.tradeActivityRate',
  waiverActivityRate: 'league.waiverActivityRate',
  draftActivityRate: 'league.draftActivityRate',
}

interface LeagueEngagementTrajectoryParams {
  leagueId: string
  /** How many recent snapshots to pull (default 12). */
  take?: number
}

/**
 * Pure. Maps league-history points → trajectory points for one field. The source
 * reports no confidence, so none is attached (never invented). For the score
 * metric the engagement tier travels along as the point label.
 */
export function mapLeagueEngagementPoints(
  points: LeagueHistoryPoint[],
  field: LeagueEngagementMetricField,
): TrajectoryPoint[] {
  return points.map((p) => ({
    value: p[field],
    timestamp: p.capturedAt,
    label: field === 'leagueEngagementScore' ? p.leagueEngagementTier : undefined,
  }))
}

/**
 * Creates an adapter over the existing decision-os league-engagement history
 * ledger. `deps` is forwarded straight to `getRecentLeagueSnapshots` for
 * DB-free testing.
 */
export function createLeagueEngagementAdapter(
  field: LeagueEngagementMetricField,
  deps?: LeagueSnapshotHistoryDeps,
): TrajectoryAdapter<LeagueEngagementTrajectoryParams> {
  return {
    metricId: LEAGUE_ENGAGEMENT_METRIC_IDS[field],
    supported: true,
    async load({ leagueId, take = 12 }) {
      const points = await getRecentLeagueSnapshots(leagueId, take, deps)
      return mapLeagueEngagementPoints(points, field)
    },
    explainChange: () => null,
  }
}
