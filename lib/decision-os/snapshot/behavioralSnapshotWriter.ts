/**
 * Decision OS — Phase A Increment 5: snapshot capture → store orchestrator.
 *
 * The single entry point a scheduled job calls: capture (pure) → upsert (idempotent) for the
 * league snapshot and every active manager's snapshot. No Prisma, no provider parsing — mirrors
 * the Increment 2 `writeImportedActivity` shape for architectural consistency.
 */

import {
  captureBehavioralSnapshots,
  type CaptureBehavioralSnapshotInput,
} from './behavioralSnapshotCapture'
import type { BehavioralSnapshotStore, SnapshotUpsertResult } from './behavioralSnapshotStore'

export interface WriteBehavioralSnapshotsSummary {
  league: SnapshotUpsertResult
  managers: SnapshotUpsertResult[]
  created: number
  updated: number
  /** Distinct manager count captured this run (0 is honest for a quiet period, never invented). */
  managerCount: number
}

export async function captureAndWriteBehavioralSnapshots(
  input: CaptureBehavioralSnapshotInput,
  store: BehavioralSnapshotStore,
): Promise<WriteBehavioralSnapshotsSummary> {
  const { league, managers } = captureBehavioralSnapshots(input)

  const leagueResult = await store.upsertByPeriod(league)
  const managerResults: SnapshotUpsertResult[] = []
  for (const managerSnapshot of managers) {
    managerResults.push(await store.upsertByPeriod(managerSnapshot))
  }

  const all = [leagueResult, ...managerResults]
  return {
    league: leagueResult,
    managers: managerResults,
    created: all.filter((r) => r.status === 'created').length,
    updated: all.filter((r) => r.status === 'updated').length,
    managerCount: managers.length,
  }
}
