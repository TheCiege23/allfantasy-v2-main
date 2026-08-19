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
import { captureAndWriteBehavioralSnapshots } from './behavioralSnapshotWriter'
import type { WriteBehavioralSnapshotsSummary } from './behavioralSnapshotWriter'
import type { BehavioralSnapshotStore } from './behavioralSnapshotStore'

export interface CaptureLeagueSnapshotJobDeps {
  store: BehavioralSnapshotStore
  now?: Date
  lookbackDays?: number
}

export type CaptureLeagueSnapshotJobResult =
  | { leagueId: string; ok: true; summary: WriteBehavioralSnapshotsSummary }
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
    return { leagueId, ok: true, summary }
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
