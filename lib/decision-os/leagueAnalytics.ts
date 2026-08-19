/**
 * Commissioner OS Demo Breadth — Phase C Increment 4.
 *
 * League Analytics: a second, sibling surface to Mission Control (`missionControl.ts`), composed
 * from the SAME already-federated League Health result (`resolveDecisionOsLeagueHealth`, Increment
 * 3) — but reshaped for a different question. Mission Control answers "what should the
 * commissioner do right now?" (health status, named at-risk managers, recommended actions).
 * League Analytics answers "what is happening in this league over time?" (activity counts,
 * manager counts, activity trend, and a bare retention-risk count — no names, no actions).
 *
 * Zero new derivation logic — this is composition, not a new intelligence layer, exactly like
 * Mission Control. Both are independent, parallel readers of `resolveDecisionOsLeagueHealth`; one
 * does not depend on the other, so either can degrade or evolve without affecting its sibling.
 */

import { resolveDecisionOsLeagueHealth } from './leagueHealthAlignment'
import type { LeagueActivityTrendSummary } from './dashboard-intelligence'

export interface LeagueAnalyticsActivity {
  tradeCount: number
  waiverClaimCount: number
  draftPickCount: number
  rosterActivityCount: number
}

export interface LeagueAnalyticsManagerCounts {
  activeManagers: number
  inactiveManagers: number
}

export type LeagueAnalyticsSnapshot =
  | {
      leagueId: string
      generatedAt: string
      available: true
      trend: LeagueActivityTrendSummary
      managerCounts: LeagueAnalyticsManagerCounts
      activity: LeagueAnalyticsActivity
      /** Count only — named managers + reasons are Mission Control's job, not this surface's. */
      retentionRiskCount: number
    }
  | {
      leagueId: string
      generatedAt: string
      available: false
      reason: 'league_health_unavailable'
    }

function emptySnapshot(leagueId: string, now: Date): LeagueAnalyticsSnapshot {
  return { leagueId, generatedAt: now.toISOString(), available: false, reason: 'league_health_unavailable' }
}

/**
 * Resolve the League Analytics snapshot for one league. Never throws — degrades to an explicit
 * `available: false` state (defense-in-depth over `resolveDecisionOsLeagueHealth`'s own
 * never-throws contract), mirroring `resolveMissionControlSnapshot`'s own failure-isolation design.
 */
export async function resolveLeagueAnalyticsSnapshot(
  leagueId: string,
  now: Date = new Date(),
): Promise<LeagueAnalyticsSnapshot> {
  try {
    const result = await resolveDecisionOsLeagueHealth(leagueId)
    return {
      leagueId,
      generatedAt: now.toISOString(),
      available: true,
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
      retentionRiskCount: result.decisionOs.managersAtRetentionRisk.length,
    }
  } catch {
    return emptySnapshot(leagueId, now)
  }
}
