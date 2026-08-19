/**
 * Query Service — the only read path out of the Knowledge Graph (Knowledge
 * Graph spec Part 14). Orchestrates: privacy gate → aggregate computation →
 * versioned persistence → return. No caller should read SignalStore/
 * SnapshotStore directly; this is the boundary every future OS module
 * (Trade OS, Manager OS, etc.) will eventually call through.
 *
 * ⚠️ VERIFIED 2026-08-09 (Slice 16) — THE GRAPH HAS NO WRITERS IN PRODUCTION.
 *
 * `SignalIngestionService`, `TradeSignalHook` and `WaiverSignalHook` exist but
 * are referenced by nothing outside this package and its tests. A repo-wide
 * search for callers returns zero. Consequently every read through this
 * service resolves against an EMPTY signal store, and manager-behavior /
 * player-exposure profiles are permanently unavailable in production.
 *
 * This is not currently a correctness bug: every live consumer degrades
 * honestly (`DraftShadowService.resolveManagerTendency` returns
 * `status: 'unavailable'` and pushes a real uncertainty line rather than
 * fabricating tendencies). It IS a capability gap, and the important thing is
 * that nobody builds a feature assuming these profiles carry real data.
 *
 * To make the graph real, the ingestion hooks must be invoked from the live
 * trade-accept / trade-reject / waiver-processed paths. Until then, treat any
 * "manager tendency" signal in this codebase as structurally absent.
 */

import { defaultSignalStore, type SignalStore } from './SignalStore'
import { defaultSnapshotStore, type SnapshotStore } from './SnapshotStore'
import { checkPrivacyGate } from './PrivacyGate'
import { computeManagerBehaviorMetrics, buildManagerBehaviorConfidenceEnvelope } from './ManagerBehaviorProfileEngine'
import {
  computePlayerExposureMetrics,
  buildPlayerExposureConfidenceEnvelope,
} from './PlayerExposureEngine'
import { countDistinctLeaguesWithRosterData, loadManagerRosterSnapshots } from './RosterSnapshotLoader'
import type { ManagerBehaviorProfile, ManagerKey, PlayerExposure, QueryVisibility, SignalType } from './types'

const MANAGER_BEHAVIOR_SIGNAL_TYPES: SignalType[] = [
  'trade_accepted',
  'trade_rejected',
  'trade_cancelled',
  'trade_vetoed',
  'waiver_claim_won',
  'waiver_claim_lost',
]

export type QueryResult<T> = { status: 'ok'; data: T } | { status: 'gated'; reason: string }

export interface QueryOptions {
  /**
   * Threaded through for forward compatibility with the spec's visibility
   * model (own/commissioner/aggregate) — NOT yet used to vary gate behavior
   * in this phase. See PrivacyGate.ts's docstring for the disclosed
   * interpretation choice: the gate is currently unconditional regardless of
   * visibility, pending real auth/permission wiring.
   */
  visibility?: QueryVisibility
  signalStore?: SignalStore
  snapshotStore?: SnapshotStore
}

export interface PlayerExposureQueryOptions extends QueryOptions {
  /** Injectable for tests — defaults to the real Prisma-backed roster loader. */
  rosterLoader?: typeof loadManagerRosterSnapshots
  /** Injectable for tests — defaults to the real Prisma-backed league-count query. */
  cohortLoader?: typeof countDistinctLeaguesWithRosterData
}

export async function getManagerBehaviorProfile(
  managerKey: ManagerKey,
  options: QueryOptions = {}
): Promise<QueryResult<ManagerBehaviorProfile>> {
  const signalStore = options.signalStore ?? defaultSignalStore
  const snapshotStore = options.snapshotStore ?? defaultSnapshotStore

  const cohortSize = await signalStore.distinctLeagueCount()
  const gate = checkPrivacyGate(cohortSize)
  if (!gate.allowed) {
    return { status: 'gated', reason: gate.reason ?? 'Privacy gate not satisfied.' }
  }

  const signals = await signalStore.findByManager(managerKey, MANAGER_BEHAVIOR_SIGNAL_TYPES)
  const value = computeManagerBehaviorMetrics(signals)
  const confidenceEnvelope = buildManagerBehaviorConfidenceEnvelope(signals)
  const now = new Date()
  const profile: ManagerBehaviorProfile = { asOf: now, computedAt: now, value, confidenceEnvelope }

  await snapshotStore.appendManagerBehaviorProfile(managerKey, profile)
  return { status: 'ok', data: profile }
}

export async function getPlayerExposure(
  managerKey: ManagerKey,
  playerId: string,
  options: PlayerExposureQueryOptions = {}
): Promise<QueryResult<PlayerExposure>> {
  const snapshotStore = options.snapshotStore ?? defaultSnapshotStore
  const rosterLoader = options.rosterLoader ?? loadManagerRosterSnapshots
  const cohortLoader = options.cohortLoader ?? countDistinctLeaguesWithRosterData

  const cohortSize = await cohortLoader()
  const gate = checkPrivacyGate(cohortSize)
  if (!gate.allowed) {
    return { status: 'gated', reason: gate.reason ?? 'Privacy gate not satisfied.' }
  }

  const rosters = await rosterLoader(managerKey)
  const value = computePlayerExposureMetrics(playerId, rosters)
  const confidenceEnvelope = buildPlayerExposureConfidenceEnvelope(value, {
    source: 'af_native',
    emittedFrom: 'RosterSnapshotLoader.loadManagerRosterSnapshots',
    recordedAt: new Date(),
  })
  const now = new Date()
  const exposure: PlayerExposure = { asOf: now, computedAt: now, value, confidenceEnvelope }

  await snapshotStore.appendPlayerExposure(managerKey, exposure)
  return { status: 'ok', data: exposure }
}
