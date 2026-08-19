/**
 * Fantasy OS Suite — Phase OS-C1: Manager Operating System Foundation.
 *
 * Aggregates the already-real, single-league `resolveUserOsSnapshot` (`userOs.ts`) across every
 * league one signed-in user belongs to — commissioner AND member AND imported, unlike Commissioner
 * OS's own command center (`commissionerCommandCenter.ts`), which filters to commissioned leagues
 * only. This is Manager OS's own "Multi-League Overview": the first genuinely cross-league Decision
 * OS composition built for the person PLAYING in leagues, not running them.
 *
 * Sibling, not wrapper, matching every other Decision OS multi-league composition's own precedent
 * (`commissionerCommandCenter.ts`, `platformOs.ts`): this calls `resolveUserOsSnapshot` directly per
 * league rather than wrapping a sibling composition. Zero new derivation — every field below is
 * either a direct pass-through of `UserOsSnapshot`'s own already-real output or a signal produced by
 * `deriveManagerAttentionSignals` (`attentionSignals.ts`), which itself only relabels
 * `UserOsSnapshot` fields, never recomputes them.
 *
 * Provider-agnostic and id-only — never accepts/returns a league display name, matching every other
 * Decision OS composition's own contract; that's ordinary AF/dashboard data zipped on by the caller.
 */
import { resolveUserOsSnapshot } from './userOs'
import type { UserOsSnapshot } from './userOs'
import type { ManagerRetentionRisk, ParticipationTier } from './behavioral/manager-intelligence'
import {
  ATTENTION_QUEUE_CAP,
  deriveManagerAttentionSignals,
  sortAttentionSignals,
  type DecisionOsAttentionSignal,
} from './attentionSignals'
import type { DailyBriefLeagueTrend } from './dailyBrief'
import type { Recommendation } from './phase6/recommendations/types'

/** Phase OS-C2: same cap discipline as `ATTENTION_QUEUE_CAP` — a safety ceiling on payload size, not a
 * UX limit (each Priority Module caps its own displayed count independently). */
const MANAGER_RECOMMENDATIONS_CAP = 60

/** `'low'` retention risk + active participation is the only "healthy" bucket — mirrors
 * `commissionerCommandCenter.ts`'s own `HEALTHY_STATUSES`/`AT_RISK_STATUSES` bucketing pattern, just
 * over `ManagerRetentionRisk` instead of the league-health engine's `overallStatus`.
 *
 * Phase OS-C3: found during live validation — this originally only included `high`/`critical`, while
 * `attentionSignals.ts`'s `MANAGER_RETENTION_SEVERITY` (the set that actually fires a real
 * `manager_engagement_risk` Attention Queue signal) also includes `medium`. That mismatch meant a
 * `medium`-risk league could show a real signal in the Attention Queue while the "Need attention" stat
 * chip and `healthyLeagueCount` both counted it as healthy — two real numbers on the same screen
 * silently contradicting each other. Commissioner OS's own `HEALTHY_STATUSES`/`AT_RISK_STATUSES` are
 * kept in exact sync with `LOW_HEALTH_SEVERITY`'s 3 severities for the identical reason; this now
 * matches that same discipline. */
const AT_RISK_RETENTION = new Set<ManagerRetentionRisk>(['medium', 'high', 'critical'])

export interface ManagerCommandCenterLeagueSummary {
  leagueId: string
  available: boolean
  participationTier: ParticipationTier | null
  engagementScore: number | null
  retentionRisk: ManagerRetentionRisk | null
  isInactive: boolean
  recommendationCount: number
}

/** Phase OS-C2: a real, already-computed Phase 6.4 manager-tier `Recommendation`, tagged with the
 * league it belongs to (a `Recommendation`'s own `entityId` is the managerId, not a leagueId — this
 * wrapper is the same "id-only pairing, zipped on by the composition" pattern every other multi-league
 * aggregation in this codebase already uses). Exposed alongside `attentionQueue` — the SAME source
 * data `deriveManagerAttentionSignals` already reads to produce `manager_recommendation` signals, not
 * a second derivation. See `docs/os/OS_C2_PRIORITIES_ARCHITECTURE_AUDIT.md` for why this is the
 * canonical source for Lineup/Trade/Waiver Priorities. */
export interface ManagerCommandCenterRecommendation {
  leagueId: string
  recommendation: Recommendation
}

export interface ManagerCommandCenterSnapshot {
  generatedAt: string
  totalLeagues: number
  healthyLeagueCount: number
  atRiskLeagueCount: number
  /** Phase 36: leagues whose retention risk cannot be assessed (no recorded events) — never bucketed as at-risk. */
  insufficientDataLeagueCount: number
  unavailableLeagueCount: number
  leagueSummaries: ManagerCommandCenterLeagueSummary[]
  attentionQueue: DecisionOsAttentionSignal[]
  recommendations: ManagerCommandCenterRecommendation[]
  leagueTrends: DailyBriefLeagueTrend[]
  warnings: string[]
}

function emptySnapshot(now: Date, warnings: string[]): ManagerCommandCenterSnapshot {
  return {
    generatedAt: now.toISOString(),
    totalLeagues: 0,
    healthyLeagueCount: 0,
    atRiskLeagueCount: 0,
    insufficientDataLeagueCount: 0,
    unavailableLeagueCount: 0,
    leagueSummaries: [],
    attentionQueue: [],
    recommendations: [],
    leagueTrends: [],
    warnings,
  }
}

/** Defense-in-depth — `resolveUserOsSnapshot` already never throws on its own (it degrades to
 * `available: false` internally), matching every other Decision OS composition's identical
 * precedent (`commissionerCommandCenter.ts`'s own `resolveLeagueSafely`). */
async function resolveManagerLeagueSafely(
  leagueId: string,
  userId: string,
  now: Date,
): Promise<UserOsSnapshot | null> {
  try {
    return await resolveUserOsSnapshot(leagueId, userId, now)
  } catch {
    return null
  }
}

/**
 * Resolves the manager command-center snapshot for an EXPLICIT set of league IDs the caller has
 * already confirmed the user belongs to. Never throws — a failure for one league marks it
 * unavailable and excludes it from aggregate counts; it never fails the whole snapshot. An empty
 * `leagueIds` list degrades to an honest all-zero snapshot with `warnings: ['no_leagues_specified']`.
 */
export async function resolveManagerCommandCenterSnapshot(
  userId: string,
  leagueIds: readonly string[],
  now: Date = new Date(),
): Promise<ManagerCommandCenterSnapshot> {
  if (leagueIds.length === 0) {
    return emptySnapshot(now, ['no_leagues_specified'])
  }

  let healthyLeagueCount = 0
  let atRiskLeagueCount = 0
  let insufficientDataLeagueCount = 0
  let unavailableLeagueCount = 0
  const leagueSummaries: ManagerCommandCenterLeagueSummary[] = []
  const attentionSignals: DecisionOsAttentionSignal[] = []
  const recommendationEntries: ManagerCommandCenterRecommendation[] = []
  const leagueTrends: DailyBriefLeagueTrend[] = []

  // Phase OS-C6: resolve every league's snapshot in parallel, matching the pattern every sibling
  // multi-league composition already uses (`commissionerCommandCenter.ts`, `platformOs.ts`,
  // `attentionQueue.ts`) — a real, verified inconsistency found during the production-readiness
  // audit, not a premature optimization. Fetch is deliberately separated from accumulation: the
  // accumulation loop below stays synchronous and unchanged, only the I/O is parallelized.
  const resolvedSnapshots = await Promise.all(
    leagueIds.map((leagueId) => resolveManagerLeagueSafely(leagueId, userId, now)),
  )

  for (let i = 0; i < leagueIds.length; i += 1) {
    const leagueId = leagueIds[i]
    const snapshot = resolvedSnapshots[i]

    if (!snapshot || !snapshot.available) {
      unavailableLeagueCount += 1
      leagueSummaries.push({
        leagueId,
        available: false,
        participationTier: null,
        engagementScore: null,
        retentionRisk: null,
        isInactive: false,
        recommendationCount: 0,
      })
      continue
    }

    const { teamHealth, recommendations, leagueTrend } = snapshot
    // Phase 36: insufficient_data wins over isInactive — isInactive is legitimately
    // computed but derives from the SAME empty event stream, so bucketing it as
    // at-risk would defeat the whole insufficient_data fix (real 8-league user
    // showed 8/8 at-risk until this was corrected).
    if (teamHealth.retentionRisk === 'insufficient_data') {
      insufficientDataLeagueCount += 1
    } else if (AT_RISK_RETENTION.has(teamHealth.retentionRisk) || teamHealth.isInactive) {
      atRiskLeagueCount += 1
    } else {
      healthyLeagueCount += 1
    }

    const managerRecommendations = (recommendations?.recommendations ?? []).filter(
      (r) => r.tier === 'manager',
    )
    leagueSummaries.push({
      leagueId,
      available: true,
      participationTier: teamHealth.participationTier,
      engagementScore: teamHealth.overallEngagementScore,
      retentionRisk: teamHealth.retentionRisk,
      isInactive: teamHealth.isInactive,
      recommendationCount: managerRecommendations.length,
    })

    attentionSignals.push(
      ...deriveManagerAttentionSignals({
        leagueId,
        now,
        retentionRisk: teamHealth.retentionRisk,
        retentionRiskReasons: teamHealth.retentionRiskReasons,
        isInactive: teamHealth.isInactive,
        recommendations: managerRecommendations,
      }),
    )
    recommendationEntries.push(...managerRecommendations.map((recommendation) => ({ leagueId, recommendation })))

    if (leagueTrend.available) {
      leagueTrends.push({
        leagueId,
        direction: leagueTrend.direction,
        eventCountDelta: leagueTrend.eventCountDelta,
      })
    }
  }

  // Highest severity first across ALL leagues together, capped only after the full comparison —
  // matching `commissionerCommandCenter.ts`'s identical rationale (never crowd out a more urgent
  // signal from a later league by capping incrementally).
  const attentionQueue = sortAttentionSignals(attentionSignals).slice(0, ATTENTION_QUEUE_CAP)

  return {
    generatedAt: now.toISOString(),
    totalLeagues: leagueIds.length,
    healthyLeagueCount,
    atRiskLeagueCount,
    insufficientDataLeagueCount,
    unavailableLeagueCount,
    leagueSummaries,
    attentionQueue,
    recommendations: recommendationEntries.slice(0, MANAGER_RECOMMENDATIONS_CAP),
    leagueTrends,
    warnings: [],
  }
}
