/**
 * Fantasy OS Suite — Phase D Increment 4; migrated onto the shared Attention Signal model in
 * Phase OS-B4.5.
 *
 * Platform OS / Client Intelligence: the minimum operator-facing aggregation, built the same way
 * Mission Control and League Analytics were — compose over already-real, already-tested Decision OS
 * outputs, add zero new derivation. Answers a different question from either sibling surface:
 * "across the leagues I'm monitoring, how healthy is the platform, and where does it need
 * attention?" — not one commissioner's or one manager's view of a single league.
 *
 * Deliberately does NOT use the richer, shadow-gated Phase 5.4 `derivePlatformBehavioralIntelligence`
 * (`lib/decision-os/behavioral/platform-intelligence.ts`). That function is real and fully tested,
 * and is even already wired end-to-end inside `real-data-provider.ts` — but reaching it means
 * crossing a STACKED cutover-ADR gate sequence (Phase 5.3's own ADR: shadow-only until a Phase 5.4
 * cutover ADR; Phase 5.4's own ADR: shadow-only until a SEPARATE Phase 5.5 cutover ADR), one level
 * higher than the Phase 5.3 gate already deliberately avoided for Mission Control's recommended
 * actions (see `docs/os/PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md` §1/§10). Crossing that gate is a
 * real architecture decision, not something to do silently as a side effect of a demo surface — so
 * this module aggregates the ALREADY-CUT-OVER, already-live Mission Control composition across an
 * explicit set of leagues instead. This gives up the Phase 5.4 activity heatmap and its
 * recency-based momentum signal in exchange for staying entirely on already-shipped ground.
 *
 * Explicit-list only, by design (matches Increment 4's cron route precedent): the caller supplies
 * the exact league IDs to monitor. There is no "discover every league on the platform" mode here —
 * that is a separate, larger scope decision this module does not make.
 *
 * Phase OS-B4.5: `attentionQueue` (renamed from the older, bespoke `interventionQueue`) is now the
 * SAME `DecisionOsAttentionSignal[]` shape Commissioner OS's own `attentionQueue` uses — real signals
 * across all 5 types (draft approaching, league context incomplete, low/high league health, league
 * requires review), not just a hand-filtered subset of `recommendedActions` with `priority === 'urgent'`.
 * Found via `docs/os/OS_B_ARCHITECTURE_AUDIT.md` §3: this module predates the Attention Signal model
 * (Phase D vs. OS-B2) and had never been migrated onto it. Signals are derived INLINE using the
 * `MissionControlSnapshot` this loop already fetches per league — deliberately does NOT call the
 * standalone `resolveAttentionQueueSnapshot` (`attentionQueue.ts`), which would fetch Mission Control a
 * second time per league on this ALREADY-LIVE admin route's every real request (unlike OS-B2–B4's own
 * standalone resolvers, which currently have no live caller, this module backs a real, already-shipped
 * endpoint — the double-fetch cost here is not hypothetical). Reuses the shared
 * `loadUpcomingDraftDates`/`resolveLeagueFinancialContextSafely` helpers instead of duplicating them a
 * third time. Notification Engine (`notifications.ts`/`notificationResolver.ts`) is UNCHANGED by this
 * migration — Platform OS does not (yet) produce or consume `DecisionOsNotification`.
 */

import { resolveMissionControlSnapshot } from './missionControl'
import type { MissionControlSnapshot } from './missionControl'
import { resolveLeagueFinancialContextSafely } from './leagueContext'
import { loadUpcomingDraftDates } from './attentionQueue'
import {
  ATTENTION_QUEUE_CAP,
  deriveLeagueAttentionSignals,
  sortAttentionSignals,
  type DecisionOsAttentionSignal,
} from './attentionSignals'

/** Mirrors `OverallStatus` from `lib/league-health`, classified into two buckets for this surface. */
const HEALTHY_STATUSES = new Set(['excellent', 'healthy'])
/** 'watch' is bucketed as at-risk, not healthy — an operator surface should flag early rather than
 * bucket a league already trending toward trouble as "healthy". */
const AT_RISK_STATUSES = new Set(['watch', 'at_risk', 'critical'])

export interface PlatformOsTrendCoverage {
  /** Leagues with a real, 2+ period trend (`available: true`). */
  available: number
  /** Leagues with zero captured snapshots. */
  noSnapshots: number
  /** Leagues with exactly one captured snapshot. */
  insufficientHistory: number
  /** Leagues whose League Health itself was unavailable, so trend couldn't even be read. */
  unavailable: number
}

export interface PlatformOsProvenance {
  source: 'commissioner_os_composition'
  requestedLeagueCount: number
  resolvedLeagueCount: number
  unavailableLeagueCount: number
}

export interface PlatformOsSnapshot {
  generatedAt: string
  totalMonitoredLeagues: number
  healthyLeagueCount: number
  atRiskLeagueCount: number
  unavailableLeagueCount: number
  totalActiveManagers: number
  totalInactiveManagers: number
  totalTrades: number
  totalWaiverClaims: number
  totalDraftPicks: number
  totalRosterActivity: number
  totalRetentionRiskManagers: number
  attentionQueue: DecisionOsAttentionSignal[]
  trendCoverage: PlatformOsTrendCoverage
  provenance: PlatformOsProvenance
  /** Honest notes about the snapshot as a whole (e.g. no leagues were specified). */
  warnings: string[]
}

function emptyTrendCoverage(): PlatformOsTrendCoverage {
  return { available: 0, noSnapshots: 0, insufficientHistory: 0, unavailable: 0 }
}

function emptySnapshot(now: Date, requestedLeagueCount: number, warnings: string[]): PlatformOsSnapshot {
  return {
    generatedAt: now.toISOString(),
    totalMonitoredLeagues: 0,
    healthyLeagueCount: 0,
    atRiskLeagueCount: 0,
    unavailableLeagueCount: 0,
    totalActiveManagers: 0,
    totalInactiveManagers: 0,
    totalTrades: 0,
    totalWaiverClaims: 0,
    totalDraftPicks: 0,
    totalRosterActivity: 0,
    totalRetentionRiskManagers: 0,
    attentionQueue: [],
    trendCoverage: emptyTrendCoverage(),
    provenance: {
      source: 'commissioner_os_composition',
      requestedLeagueCount,
      resolvedLeagueCount: 0,
      unavailableLeagueCount: 0,
    },
    warnings,
  }
}

/** Resolve one league's Mission Control snapshot, defensively — never lets one league's failure
 * throw out of the aggregation loop, mirroring every other Decision OS composition's own contract. */
async function resolveLeagueSafely(leagueId: string, now: Date): Promise<MissionControlSnapshot | null> {
  try {
    return await resolveMissionControlSnapshot(leagueId, now)
  } catch {
    return null
  }
}

/**
 * Resolve the Platform OS snapshot for an EXPLICIT set of leagues. Never throws — a failure for one
 * league marks it unavailable and excludes it from health/activity aggregates (counted in
 * `unavailableLeagueCount`); it never fails the whole snapshot. An empty `leagueIds` list degrades
 * to an honest all-zero snapshot with `warnings: ['no_leagues_specified']`.
 */
export async function resolvePlatformOsSnapshot(
  leagueIds: readonly string[],
  now: Date = new Date(),
): Promise<PlatformOsSnapshot> {
  if (leagueIds.length === 0) {
    return emptySnapshot(now, 0, ['no_leagues_specified'])
  }

  let healthyLeagueCount = 0
  let atRiskLeagueCount = 0
  let unavailableLeagueCount = 0
  let totalActiveManagers = 0
  let totalInactiveManagers = 0
  let totalTrades = 0
  let totalWaiverClaims = 0
  let totalDraftPicks = 0
  let totalRosterActivity = 0
  let totalRetentionRiskManagers = 0
  const trendCoverage = emptyTrendCoverage()
  const attentionSignals: DecisionOsAttentionSignal[] = []

  // Batched once, up front — the same shared lookup `attentionQueue.ts`/`commissionerCommandCenter.ts`
  // already use, not a per-league query.
  const draftDates = await loadUpcomingDraftDates(leagueIds)

  for (const leagueId of leagueIds) {
    const [snapshot, financialContext] = await Promise.all([
      resolveLeagueSafely(leagueId, now),
      resolveLeagueFinancialContextSafely(leagueId).catch(() => null),
    ])
    const financialStatus = financialContext?.financialStatus ?? 'UNKNOWN'
    const draftDateUtc = draftDates.get(leagueId) ?? null

    if (!snapshot || !snapshot.leagueHealth.available) {
      unavailableLeagueCount += 1
      trendCoverage.unavailable += 1
      // League health being unavailable doesn't mean EVERY signal source is unavailable — League
      // Context and the real draft date are independent tables (same reasoning
      // `commissionerCommandCenter.ts` already applies).
      attentionSignals.push(
        ...deriveLeagueAttentionSignals({
          leagueId,
          now,
          overallStatus: null,
          leagueHealthScore: null,
          recommendedActions: [],
          financialStatus,
          draftDateUtc,
        }),
      )
      continue
    }

    const engine = snapshot.leagueHealth.result.engine
    const status = engine.overallStatus
    if (HEALTHY_STATUSES.has(status)) healthyLeagueCount += 1
    else if (AT_RISK_STATUSES.has(status)) atRiskLeagueCount += 1

    totalActiveManagers += snapshot.managerCounts.activeManagers
    totalInactiveManagers += snapshot.managerCounts.inactiveManagers
    totalTrades += snapshot.activity.tradeCount
    totalWaiverClaims += snapshot.activity.waiverClaimCount
    totalDraftPicks += snapshot.activity.draftPickCount
    totalRosterActivity += snapshot.activity.rosterActivityCount
    totalRetentionRiskManagers += snapshot.managersAtRetentionRisk.length

    if (snapshot.trend.available) trendCoverage.available += 1
    else if (snapshot.trend.reason === 'no_snapshots') trendCoverage.noSnapshots += 1
    else trendCoverage.insufficientHistory += 1

    const leagueHealthScore = typeof engine.leagueHealthScore === 'number' ? engine.leagueHealthScore : null
    attentionSignals.push(
      ...deriveLeagueAttentionSignals({
        leagueId,
        now,
        overallStatus: status,
        leagueHealthScore,
        recommendedActions: snapshot.recommendedActions,
        financialStatus,
        draftDateUtc,
      }),
    )
  }

  // Highest severity first across ALL monitored leagues, capped only after the full comparison — same
  // "never crowd out a later league's more urgent signal" discipline every sibling composition follows.
  const attentionQueue = sortAttentionSignals(attentionSignals).slice(0, ATTENTION_QUEUE_CAP)

  const resolvedLeagueCount = leagueIds.length - unavailableLeagueCount

  return {
    generatedAt: now.toISOString(),
    totalMonitoredLeagues: leagueIds.length,
    healthyLeagueCount,
    atRiskLeagueCount,
    unavailableLeagueCount,
    totalActiveManagers,
    totalInactiveManagers,
    totalTrades,
    totalWaiverClaims,
    totalDraftPicks,
    totalRosterActivity,
    totalRetentionRiskManagers,
    attentionQueue,
    trendCoverage,
    provenance: {
      source: 'commissioner_os_composition',
      requestedLeagueCount: leagueIds.length,
      resolvedLeagueCount,
      unavailableLeagueCount,
    },
    warnings: [],
  }
}
