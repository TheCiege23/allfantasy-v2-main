/**
 * Commissioner OS Surface Alignment — Phase B Increment 5.
 *
 * Mission Control: the first minimal Mission Control surface, composed entirely from
 * ALREADY-REAL, already-tested Decision OS outputs — zero new derivation logic beyond a small,
 * honest reshaping of fields that already exist:
 *   - `resolveDecisionOsLeagueHealth` (Increment 3) — the federated League Health result
 *     (`engine` = the untouched `monitorLeagueHealth` scoring output; `decisionOs` = real
 *     trade/waiver/draft/roster/manager counts + trend + retention-risk managers).
 *
 * "Recommended commissioner actions" is deliberately NOT a new recommendation engine: the
 * federated `monitorLeagueHealth` engine (Increment 3) already produces real,
 * now-real-data-driven `urgentAlerts` + `interventionRecommendations` — this module only
 * relabels those two arrays with a priority tag. (Phase 5.3's `deriveLeagueBehavioralIntelligence`
 * recommendations and Phase 6.4's `assembleCommissionerRecommendations` were both deliberately
 * NOT used here: Phase 5.3 is explicitly shadow-gated behind its own "Phase 5.4 cutover ADR"
 * requirement per `ADR_F5_3_LEAGUE_BEHAVIORAL_INTELLIGENCE.md`, and Phase 6.4's commissioner tier
 * needs archetype/benchmark inputs this increment doesn't assemble — reusing the engine's own
 * already-federated recommendations avoids opening either of those separate scope questions.)
 *
 * Honest degradation: `resolveDecisionOsLeagueHealth` itself never throws (see
 * `leagueHealthAlignment.ts`), but this module wraps the call in its own outer try/catch anyway —
 * a defense-in-depth boundary so a future change to that dependency (or an unexpected failure
 * mode) degrades Mission Control to an explicit `leagueHealth: { available: false }` state rather
 * than crashing the surface. This is a different, additive failure mode from
 * `resolveDecisionOsLeagueHealth`'s own "available but all-zero" degradation.
 */

import {
  resolveDecisionOsLeagueHealth,
  type DecisionOsLeagueHealthResult,
  type FieldProvenance,
  type ManagerAtRetentionRisk,
} from './leagueHealthAlignment'
import type { LeagueActivityTrendSummary } from './dashboard-intelligence'

export type MissionControlLeagueHealth =
  | { available: true; result: DecisionOsLeagueHealthResult }
  | { available: false; reason: 'league_health_unavailable' }

export interface RecommendedCommissionerAction {
  priority: 'urgent' | 'standard'
  message: string
}

export interface MissionControlSnapshot {
  leagueId: string
  generatedAt: string
  leagueHealth: MissionControlLeagueHealth
  /** Same trend contract Increment 2 wired into dashboard-intelligence.ts — reused, not re-derived. */
  trend: LeagueActivityTrendSummary
  managerCounts: {
    activeManagers: number
    inactiveManagers: number
  }
  activity: {
    tradeCount: number
    waiverClaimCount: number
    draftPickCount: number
    rosterActivityCount: number
  }
  managersAtRetentionRisk: ManagerAtRetentionRisk[]
  /** Derived from the federated engine's own urgentAlerts + interventionRecommendations — no new recommendation logic. */
  recommendedActions: RecommendedCommissionerAction[]
  /** Which LeagueHealthInput fields behind `leagueHealth` are real vs schema-default. `null` only when leagueHealth itself is unavailable. */
  fieldProvenance: FieldProvenance | null
}

function toRecommendedActions(engine: DecisionOsLeagueHealthResult['engine']): RecommendedCommissionerAction[] {
  const urgent = engine.urgentAlerts.map((message) => ({ priority: 'urgent' as const, message }))
  const standard = engine.interventionRecommendations
    .filter((message) => !engine.urgentAlerts.includes(message))
    .map((message) => ({ priority: 'standard' as const, message }))
  return [...urgent, ...standard]
}

function emptySnapshot(leagueId: string, now: Date): MissionControlSnapshot {
  return {
    leagueId,
    generatedAt: now.toISOString(),
    leagueHealth: { available: false, reason: 'league_health_unavailable' },
    trend: { available: false, reason: 'no_snapshots' },
    managerCounts: { activeManagers: 0, inactiveManagers: 0 },
    activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
    managersAtRetentionRisk: [],
    recommendedActions: [],
    fieldProvenance: null,
  }
}

/**
 * Resolve the Mission Control snapshot for one league. Never throws — degrades to
 * `emptySnapshot` (an explicit `leagueHealth: { available: false }` state) on any failure.
 */
export async function resolveMissionControlSnapshot(
  leagueId: string,
  now: Date = new Date(),
): Promise<MissionControlSnapshot> {
  try {
    const result = await resolveDecisionOsLeagueHealth(leagueId)
    return {
      leagueId,
      generatedAt: now.toISOString(),
      leagueHealth: { available: true, result },
      trend: result.decisionOs.trend,
      managerCounts: {
        activeManagers: result.decisionOs.activeManagerCount,
        inactiveManagers: result.decisionOs.inactiveManagerCount,
      },
      activity: {
        tradeCount: result.decisionOs.tradeCount,
        waiverClaimCount: result.decisionOs.waiverClaimCount,
        draftPickCount: result.decisionOs.draftPickCount,
        rosterActivityCount: result.decisionOs.rosterActivityCount,
      },
      managersAtRetentionRisk: result.decisionOs.managersAtRetentionRisk,
      recommendedActions: toRecommendedActions(result.engine),
      fieldProvenance: result.fieldProvenance,
    }
  } catch {
    return emptySnapshot(leagueId, now)
  }
}
