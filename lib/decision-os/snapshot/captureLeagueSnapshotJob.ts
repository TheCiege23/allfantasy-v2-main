/**
 * Commissioner OS Surface Alignment — Phase B Increment 4.
 *
 * The reusable job unit a scheduler (or an on-demand verification call) invokes to capture one
 * league's behavioral snapshot. Pure orchestration — zero new derivation logic: reuses
 * `loadLeagueEvents`/`lookbackDays`/`sinceDate` (Increment 1/3's exported composition, which
 * already merges imported/external-league activity) and `captureAndWriteBehavioralSnapshots`
 * (Phase A Increment 5's writer, unchanged). This is the SAME event stream `dashboard-intelligence.ts`
 * and `leagueHealthAlignment.ts` already use — one source of truth for "what happened in this
 * league," now also feeding trend history.
 *
 * Mirrors this repo's existing automation-job shape (`lib/automation/jobs/waivers/
 * processLeagueWaiversJob.ts`): one function per league, isolated failure (a batch caller can run
 * many leagues and one failure never aborts the rest), an honest `ok`/`error` result — never throws.
 */

import { loadLeagueEvents, lookbackDays, sinceDate } from '../dashboard-intelligence'
import { buildLeaguePipeline } from '../behavioral/api/real-data-provider'
import { captureLeagueSnapshotHistory } from '../behavioral/history/snapshots'
import { captureAndWriteBehavioralSnapshots } from './behavioralSnapshotWriter'
import type { WriteBehavioralSnapshotsSummary } from './behavioralSnapshotWriter'
import type { BehavioralSnapshotStore } from './behavioralSnapshotStore'

export interface CaptureLeagueSnapshotJobDeps {
  store: BehavioralSnapshotStore
  now?: Date
  lookbackDays?: number
  /**
   * Writes the trend-history row. Injectable for the same reason `store` is: without it a test
   * exercises a real Prisma write, which the vitest DB guard pins to an unreachable host — so the
   * write would fail, the catch below would swallow it, and the suite would stay green while
   * proving nothing about the behaviour this dependency exists for.
   */
  writeHistory?: typeof captureLeagueSnapshotHistory
}

export type CaptureLeagueSnapshotJobResult =
  | {
      leagueId: string
      ok: true
      summary: WriteBehavioralSnapshotsSummary
      /** Set when the behavioral snapshot was written but the trend-history row was not. */
      historyError?: string
    }
  | { leagueId: string; ok: false; error: string }

/** Capture + persist one league's behavioral snapshot for "now". Never throws. */
export async function captureLeagueSnapshotJob(
  leagueId: string,
  deps: CaptureLeagueSnapshotJobDeps,
): Promise<CaptureLeagueSnapshotJobResult> {
  try {
    const now = deps.now ?? new Date()
    const lookback = deps.lookbackDays ?? lookbackDays()
    const since = sinceDate(lookback)
    const events = await loadLeagueEvents(leagueId, since)
    const summary = await captureAndWriteBehavioralSnapshots(
      { leagueId, events, capturedAt: now, lookbackDays: lookback },
      deps.store,
    )

    /*
     * 🛑 THE HEADER ABOVE HAS CLAIMED "NOW ALSO FEEDING TREND HISTORY" SINCE THIS FILE WAS
     * WRITTEN, AND UNTIL THIS LINE IT DID NOT. There are two snapshot stores, and this job wrote
     * only one of them:
     *
     *   - `decision_os_behavioral_snapshot` — written by `captureAndWriteBehavioralSnapshots`
     *     above. 19,166 rows on prod, 26 daily periods, fresh.
     *   - `intelligence_league_snapshot_history` — the ONLY store
     *     `/api/v1/intelligence/league/trend` reads. **0 rows.** Its only writer was a hand-run
     *     script with no scheduled caller.
     *
     * So every trend in the product — the direction arrow on Mission Control, League Analytics'
     * `trends` series, every "vs last period" comparison — returned
     * `insufficient_historical_data` in every environment, permanently, while a month of the
     * same measurements sat in the table next to it. `computeLeagueTrend` needs two points.
     *
     * Derived through the exported `buildLeaguePipeline` so the score written here is the same
     * number the intelligence API serves, computed from the same events by the same code. A
     * second derivation would drift, and a trend built from a different scale than the current
     * value is worse than no trend.
     *
     * Deliberately NOT fatal: history is additive, and a league whose behavioral snapshot was
     * captured should not be reported as a failed capture because the extra write failed. The
     * failure is returned in the result rather than swallowed, so a caller can see it.
     */
    let historyError: string | undefined
    try {
      const { leagueIntelligence } = buildLeaguePipeline(leagueId, events, lookback)
      await (deps.writeHistory ?? captureLeagueSnapshotHistory)(leagueIntelligence)
    } catch (error) {
      historyError = error instanceof Error ? error.message : 'unknown_error'
    }

    return historyError ? { leagueId, ok: true, summary, historyError } : { leagueId, ok: true, summary }
  } catch (error) {
    return { leagueId, ok: false, error: error instanceof Error ? error.message : 'unknown_error' }
  }
}

export interface CaptureLeagueSnapshotsBatchResult {
  ok: boolean
  results: CaptureLeagueSnapshotJobResult[]
}

/**
 * Capture an explicit list of leagues, one at a time, isolating each league's failure (matches
 * `app/api/cron/waivers/route.ts`'s per-league try/catch isolation — one bad league never aborts
 * the batch). Deliberately NOT a platform-wide "discover every league" job — that is a separate,
 * larger scope decision; this only ever touches the leagues explicitly passed in.
 */
export async function captureLeagueSnapshotsBatchJob(
  leagueIds: readonly string[],
  deps: CaptureLeagueSnapshotJobDeps,
): Promise<CaptureLeagueSnapshotsBatchResult> {
  const results: CaptureLeagueSnapshotJobResult[] = []
  for (const leagueId of leagueIds) {
    results.push(await captureLeagueSnapshotJob(leagueId, deps))
  }
  return { ok: results.every((r) => r.ok), results }
}
