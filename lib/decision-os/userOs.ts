/**
 * Fantasy OS Suite — Phase D Increment 5.
 *
 * User OS / Manager OS: the minimum single-manager surface, answering a different question from
 * Commissioner OS ("what should this commissioner do?") and Platform OS ("which leagues need
 * attention?") — "what should THIS manager know about their own team, whether or not they
 * commission this league?"
 *
 * Zero new derivation — composed entirely from already-real Decision OS pieces:
 *   - `assembleManagerBehavioralFacts` + `deriveManagerBehavioralIntelligence` (Phase 5.2) for team
 *     health (participation tier, retention risk + reasons, engagement score) and an activity
 *     summary (per-dimension event counts) — the SAME function Mission Control's
 *     `managersAtRetentionRisk` list already calls (via `leagueHealthAlignment.ts`), just showing
 *     more of its already-tested output to the manager themselves instead of an aggregate count to
 *     their commissioner. (Phase 5.2's own module docstring says "shadow-only, not surfaced in
 *     production routes" — that describes the module's original build-time scope; Commissioner OS
 *     Surface Alignment Increments 1-3 already cut a subset of this exact function's output into
 *     live production (retentionRisk/retentionRiskReasons/isInactive, via Mission Control's
 *     managersAtRetentionRisk). This module extends that already-proven-safe exposure to more of
 *     the same function's fields, for a different audience — it does not open a new gate the way
 *     Phase 5.3/5.4 remain closed; those have zero live usage anywhere, unlike Phase 5.2.)
 *   - `resolveManagerIntelligencePayload` (Increments 1/2) for Manager DNA, manager-tier
 *     Recommendations, and League Trend — already provider-agnostic, already role-agnostic, already
 *     reachable without a commissioner gate on `LeagueTab.tsx` (see
 *     `docs/os/USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md` §4A/§11 for the confirmed reachability
 *     finding this increment resolves).
 *
 * Known, accepted tradeoff: this calls `loadLeagueEvents` twice per invocation (once directly, once
 * inside `resolveManagerIntelligencePayload`) — both are read-only and idempotent, so this is a
 * minor efficiency cost, not a correctness issue. Left as-is to avoid changing
 * `resolveManagerIntelligencePayload`'s existing, live contract as a side effect of this increment.
 */

import { loadLeagueEvents, lookbackDays, sinceDate, resolveManagerIntelligencePayload } from './dashboard-intelligence'
import type { LeagueActivityTrendSummary } from './dashboard-intelligence'
import { assembleManagerBehavioralFacts } from './behavioral/assemble'
import { deriveManagerBehavioralIntelligence } from './behavioral/manager-intelligence'
import type { ParticipationTier, ManagerRetentionRisk } from './behavioral/manager-intelligence'
import type { ManagerDnaProfile } from './phase6/dna/types'
import type { RecommendationSet } from './phase6/recommendations/types'

export interface UserOsTeamHealth {
  participationTier: ParticipationTier
  overallEngagementScore: number
  retentionRisk: ManagerRetentionRisk
  retentionRiskReasons: string[]
  isInactive: boolean
  daysSinceLastActivity: number | null
}

export interface UserOsActivitySummary {
  tradeEventCount: number
  waiverEventCount: number
  lineupEventCount: number
  draftEventCount: number
}

export type UserOsSnapshot =
  | {
      leagueId: string
      managerId: string
      generatedAt: string
      available: true
      teamHealth: UserOsTeamHealth
      activitySummary: UserOsActivitySummary
      /** Same league-wide trend contract Commissioner OS already shows — reused, not re-derived. */
      leagueTrend: LeagueActivityTrendSummary
      managerDna: ManagerDnaProfile | null
      recommendations: RecommendationSet | null
    }
  | {
      leagueId: string
      managerId: string
      generatedAt: string
      available: false
      reason: 'user_os_unavailable'
    }

function unavailableSnapshot(leagueId: string, managerId: string, now: Date): UserOsSnapshot {
  return {
    leagueId,
    managerId,
    generatedAt: now.toISOString(),
    available: false,
    reason: 'user_os_unavailable',
  }
}

/**
 * Resolve the User OS snapshot for one manager in one league — regardless of whether that manager
 * commissions the league. Never throws — degrades to an explicit `available: false` state (defense
 * in depth, matching every other Decision OS composition's own contract) rather than crashing.
 *
 * Honest degradation inherited from the composed pieces, not re-implemented:
 *   - No events for this manager → an honest zero-activity team health/activity summary
 *     (`participationTier: 'inactive'`, `overallEngagementScore: 0`) — never fabricated.
 *   - No captured league snapshots → `leagueTrend: { available: false, reason: 'no_snapshots' }`;
 *     exactly one snapshot → `'insufficient_history'` (both Increment 2/3's unchanged contract).
 *   - Imported/external activity unavailable for this provider/league → `loadLeagueEvents` already
 *     degrades that source to `[]` honestly; this manager's facts reflect only what's real.
 */
export async function resolveUserOsSnapshot(
  leagueId: string,
  managerId: string,
  now: Date = new Date(),
): Promise<UserOsSnapshot> {
  try {
    const lookback = lookbackDays()
    const since = sinceDate(lookback)
    const events = await loadLeagueEvents(leagueId, since)

    const facts = assembleManagerBehavioralFacts({ managerId, leagueId, events, lookbackDays: lookback })
    const intelligence = deriveManagerBehavioralIntelligence(facts, events, now)

    const payload = await resolveManagerIntelligencePayload({ leagueId, managerId, now })

    return {
      leagueId,
      managerId,
      generatedAt: now.toISOString(),
      available: true,
      teamHealth: {
        participationTier: intelligence.participationTier,
        overallEngagementScore: intelligence.overallEngagementScore,
        retentionRisk: intelligence.retentionRisk,
        retentionRiskReasons: intelligence.retentionRiskReasons,
        isInactive: intelligence.isInactive,
        daysSinceLastActivity: intelligence.daysSinceLastActivity,
      },
      activitySummary: {
        tradeEventCount: intelligence.tradeEngagement.eventCount,
        waiverEventCount: intelligence.waiverEngagement.eventCount,
        lineupEventCount: intelligence.lineupEngagement.eventCount,
        draftEventCount: intelligence.draftEngagement.eventCount,
      },
      leagueTrend: payload.leagueTrend,
      managerDna: payload.managerDna,
      recommendations: payload.recommendations,
    }
  } catch {
    return unavailableSnapshot(leagueId, managerId, now)
  }
}
