/**
 * Decision OS — Phase A Increment 5: deterministic behavioral snapshot capture.
 *
 * Pure, provider-agnostic point-in-time capture of the behavioral pipeline's own outputs
 * (`LeagueBehavioralFacts` / `ManagerBehavioralFacts` from Increments 1–4's event stream) into a
 * durable record shape. No IO here — capture is a pure function of
 * (events, capturedAt, lookbackDays): the same inputs ALWAYS produce the same snapshot record
 * (this is the deterministic-idempotency property the tests prove).
 *
 * Cadence assumption (explicit, documented, minimal): snapshots are bucketed by **UTC calendar
 * day** (`cadence: 'daily'`). `derivePeriodKey` is written as a small switch so a coarser/finer
 * cadence can be added later without redesigning the capture or store layers — but daily is the
 * only supported cadence right now, per the "keep this increment minimal" scope.
 *
 * Honest degradation: an empty event stream produces a valid, honestly-zeroed league snapshot
 * (never skipped, never fabricated — matches `assembleLeagueBehavioralFacts`'s own invariants) and
 * ZERO manager snapshots (no manager was active, so none is snapshotted — never invented).
 */

import type { BehavioralEvent } from '../behavioral/events/types'
import type { LeagueBehavioralFacts, ManagerBehavioralFacts } from '../behavioral/facts'
import { assembleLeagueBehavioralFacts, assembleManagerBehavioralFacts } from '../behavioral/assemble'

export type SnapshotCadence = 'daily'

export interface LeagueBehavioralSnapshotRecord {
  scope: 'league'
  leagueId: string
  managerId: null
  cadence: SnapshotCadence
  periodKey: string
  capturedAt: string
  lookbackDays: number | null
  eventCount: number
  completeness: number
  facts: LeagueBehavioralFacts
}

export interface ManagerBehavioralSnapshotRecord {
  scope: 'manager'
  leagueId: string
  managerId: string
  cadence: SnapshotCadence
  periodKey: string
  capturedAt: string
  lookbackDays: number | null
  eventCount: number
  completeness: number
  facts: ManagerBehavioralFacts
}

export type BehavioralSnapshotRecord = LeagueBehavioralSnapshotRecord | ManagerBehavioralSnapshotRecord

/** UTC-calendar-day bucket for `capturedAt`, e.g. `2026-07-08`. The sole idempotency-period unit today. */
export function derivePeriodKey(capturedAt: Date, cadence: SnapshotCadence = 'daily'): string {
  switch (cadence) {
    case 'daily':
      return capturedAt.toISOString().slice(0, 10)
    default: {
      const _exhaustive: never = cadence
      return _exhaustive
    }
  }
}

export interface CaptureBehavioralSnapshotInput {
  leagueId: string
  events: readonly BehavioralEvent[]
  capturedAt: Date
  lookbackDays?: number
  cadence?: SnapshotCadence
}

/** Capture the league-level snapshot. Pure and deterministic — never IO, never fabricates. */
export function captureLeagueBehavioralSnapshot(
  input: CaptureBehavioralSnapshotInput,
): LeagueBehavioralSnapshotRecord {
  const cadence = input.cadence ?? 'daily'
  const facts = assembleLeagueBehavioralFacts({
    leagueId: input.leagueId,
    events: [...input.events],
    lookbackDays: input.lookbackDays,
  })
  return {
    scope: 'league',
    leagueId: input.leagueId,
    managerId: null,
    cadence,
    periodKey: derivePeriodKey(input.capturedAt, cadence),
    capturedAt: input.capturedAt.toISOString(),
    lookbackDays: input.lookbackDays ?? null,
    eventCount: facts.eventCount,
    completeness: facts.completeness,
    facts,
  }
}

/**
 * Capture one snapshot per manager who had ≥1 event in the window (`activeManagerIds`).
 * A league with zero events yields zero manager snapshots — honest, not an error.
 */
export function captureManagerBehavioralSnapshots(
  input: CaptureBehavioralSnapshotInput,
): ManagerBehavioralSnapshotRecord[] {
  const cadence = input.cadence ?? 'daily'
  const events = [...input.events]
  const leagueFacts = assembleLeagueBehavioralFacts({
    leagueId: input.leagueId,
    events,
    lookbackDays: input.lookbackDays,
  })
  const periodKey = derivePeriodKey(input.capturedAt, cadence)
  const capturedAtIso = input.capturedAt.toISOString()

  return leagueFacts.activeManagerIds.map((managerId) => {
    const facts = assembleManagerBehavioralFacts({
      managerId,
      leagueId: input.leagueId,
      events,
      lookbackDays: input.lookbackDays,
    })
    return {
      scope: 'manager',
      leagueId: input.leagueId,
      managerId,
      cadence,
      periodKey,
      capturedAt: capturedAtIso,
      lookbackDays: input.lookbackDays ?? null,
      eventCount: facts.eventCount,
      completeness: facts.completeness,
      facts,
    }
  })
}

/** Capture both the league snapshot and every active manager's snapshot in one call. */
export function captureBehavioralSnapshots(
  input: CaptureBehavioralSnapshotInput,
): { league: LeagueBehavioralSnapshotRecord; managers: ManagerBehavioralSnapshotRecord[] } {
  return {
    league: captureLeagueBehavioralSnapshot(input),
    managers: captureManagerBehavioralSnapshots(input),
  }
}
