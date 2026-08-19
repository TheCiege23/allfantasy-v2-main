/**
 * Fantasy OS Suite — Phase OS-B1: Commissioner Multi-League Command Center.
 *
 * Aggregates Decision OS's already-real, already-cut-over Mission Control snapshot across every
 * league a session user commissions — the first genuinely multi-league Decision OS composition
 * consumed directly by a Commissioner-facing UI (as opposed to `platformOs.ts`'s operator/admin-
 * scoped, arbitrary-league-list surface).
 *
 * Sibling, not wrapper: like `platformOs.ts`, this composition calls the same, already-real
 * `resolveMissionControlSnapshot` per league — it does NOT call `resolvePlatformOsSnapshot` itself,
 * to avoid fetching the same per-league snapshot twice on one page load (Platform OS's own
 * composition discards per-league detail after summing; this one needs to KEEP it, for ranking and
 * the attention queue). Both compositions independently derive from the same underlying primitive,
 * matching the "sibling not wrapper" discipline already established across every Decision OS surface
 * in this codebase (Mission Control / League Analytics / Platform OS all do the same).
 *
 * Provider-agnostic and id-only, matching every other Decision OS composition's own contract: this
 * module never accepts or returns a league display name — that's ordinary AF/dashboard data, already
 * resolved by `getDashboardLeagueListForUser` at the route layer, and is zipped onto this
 * composition's id-keyed output by the caller. Decision OS itself stays provider/display-agnostic.
 *
 * Explicit-list only, matching `platformOs.ts`'s own precedent: the caller supplies the exact league
 * IDs to aggregate (here, always the session user's own commissioner leagues, resolved server-side —
 * never a client-supplied arbitrary list, so no admin gate is needed, unlike Platform OS).
 *
 * Phase OS-B2: the attention queue is now real Decision OS Attention Signals
 * (`DecisionOsAttentionSignal`, see `attentionSignals.ts`), not an ad hoc relabeling of Mission
 * Control's `recommendedActions`. This loop derives signals INLINE using the `MissionControlSnapshot`
 * it already fetched per league — it deliberately does NOT call the standalone
 * `resolveAttentionQueueSnapshot` (`attentionQueue.ts`), which would fetch Mission Control a second
 * time for the same league on the same page load. It DOES reuse that module's small
 * `loadUpcomingDraftDates` batched lookup and fetches League Context per league (both genuinely new
 * I/O for this composition, not duplicates of anything already fetched here).
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

const RECENT_CHANGES_CAP = 20

/** Mirrors `platformOs.ts`'s own (module-private, unexported) status bucketing exactly — duplicated
 * rather than imported since `platformOs.ts` doesn't export these Sets; see that file if the
 * definition of "healthy" vs "at risk" ever needs to change, and change both together. */
const HEALTHY_STATUSES = new Set(['excellent', 'healthy'])
const AT_RISK_STATUSES = new Set(['watch', 'at_risk', 'critical'])

export interface CommissionerCommandCenterLeagueSummary {
  leagueId: string
  available: boolean
  overallStatus: string | null
  leagueHealthScore: number | null
  activeManagers: number
  inactiveManagers: number
  retentionRiskCount: number
  urgentActionCount: number
  tradeCount: number
  waiverClaimCount: number
  draftPickCount: number
  rosterActivityCount: number
}

export interface CommissionerRecentChangeEntry {
  leagueId: string
  direction: 'increasing' | 'decreasing' | 'flat'
  eventCountDelta: number
}

export interface CommissionerCommandCenterSnapshot {
  generatedAt: string
  totalLeagues: number
  healthyLeagueCount: number
  atRiskLeagueCount: number
  unavailableLeagueCount: number
  totalActiveManagers: number
  totalInactiveManagers: number
  totalRetentionRiskManagers: number
  leagueSummaries: CommissionerCommandCenterLeagueSummary[]
  attentionQueue: DecisionOsAttentionSignal[]
  recentChanges: CommissionerRecentChangeEntry[]
  warnings: string[]
}

function emptySnapshot(now: Date, warnings: string[]): CommissionerCommandCenterSnapshot {
  return {
    generatedAt: now.toISOString(),
    totalLeagues: 0,
    healthyLeagueCount: 0,
    atRiskLeagueCount: 0,
    unavailableLeagueCount: 0,
    totalActiveManagers: 0,
    totalInactiveManagers: 0,
    totalRetentionRiskManagers: 0,
    leagueSummaries: [],
    attentionQueue: [],
    recentChanges: [],
    warnings,
  }
}

/** Never lets one league's failure throw out of the aggregation loop, mirroring every other Decision
 * OS composition's own contract (`resolveMissionControlSnapshot` already never throws on its own, but
 * this is defense-in-depth, matching `platformOs.ts`'s identical precedent). */
async function resolveLeagueSafely(leagueId: string, now: Date): Promise<MissionControlSnapshot | null> {
  try {
    return await resolveMissionControlSnapshot(leagueId, now)
  } catch {
    return null
  }
}

/**
 * Resolves the command-center snapshot for an EXPLICIT set of commissioner league IDs. Never throws —
 * a failure for one league marks it unavailable and excludes it from aggregate counts/ranking; it
 * never fails the whole snapshot. An empty `leagueIds` list degrades to an honest all-zero snapshot
 * with `warnings: ['no_leagues_specified']`.
 */
export async function resolveCommissionerCommandCenterSnapshot(
  leagueIds: readonly string[],
  now: Date = new Date(),
): Promise<CommissionerCommandCenterSnapshot> {
  if (leagueIds.length === 0) {
    return emptySnapshot(now, ['no_leagues_specified'])
  }

  let healthyLeagueCount = 0
  let atRiskLeagueCount = 0
  let unavailableLeagueCount = 0
  let totalActiveManagers = 0
  let totalInactiveManagers = 0
  let totalRetentionRiskManagers = 0
  const leagueSummaries: CommissionerCommandCenterLeagueSummary[] = []
  const attentionSignals: DecisionOsAttentionSignal[] = []
  const recentChanges: CommissionerRecentChangeEntry[] = []

  // Batched once, up front — not per league, matching `attentionQueue.ts`'s own resolver shape.
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
      leagueSummaries.push({
        leagueId,
        available: false,
        overallStatus: null,
        leagueHealthScore: null,
        activeManagers: 0,
        inactiveManagers: 0,
        retentionRiskCount: 0,
        urgentActionCount: 0,
        tradeCount: 0,
        waiverClaimCount: 0,
        draftPickCount: 0,
        rosterActivityCount: 0,
      })
      // League health being unavailable doesn't mean EVERY signal source is unavailable — League
      // Context and the real draft date come from independent tables, so a league can still surface a
      // genuine "draft approaching" or "financial status unconfirmed" signal here.
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
    totalRetentionRiskManagers += snapshot.managersAtRetentionRisk.length

    const urgentActions = snapshot.recommendedActions.filter((a) => a.priority === 'urgent')
    const leagueHealthScore = typeof engine.leagueHealthScore === 'number' ? engine.leagueHealthScore : null
    leagueSummaries.push({
      leagueId,
      available: true,
      overallStatus: status,
      leagueHealthScore,
      activeManagers: snapshot.managerCounts.activeManagers,
      inactiveManagers: snapshot.managerCounts.inactiveManagers,
      retentionRiskCount: snapshot.managersAtRetentionRisk.length,
      urgentActionCount: urgentActions.length,
      tradeCount: snapshot.activity.tradeCount,
      waiverClaimCount: snapshot.activity.waiverClaimCount,
      draftPickCount: snapshot.activity.draftPickCount,
      rosterActivityCount: snapshot.activity.rosterActivityCount,
    })

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

    if (snapshot.trend.available && recentChanges.length < RECENT_CHANGES_CAP) {
      recentChanges.push({
        leagueId,
        direction: snapshot.trend.direction,
        eventCountDelta: snapshot.trend.eventCountDelta,
      })
    }
  }

  // Highest severity first across ALL leagues together, capped only after the full comparison — never
  // capped incrementally per league (which could crowd out a more urgent signal from a later league).
  const attentionQueue = sortAttentionSignals(attentionSignals).slice(0, ATTENTION_QUEUE_CAP)

  return {
    generatedAt: now.toISOString(),
    totalLeagues: leagueIds.length,
    healthyLeagueCount,
    atRiskLeagueCount,
    unavailableLeagueCount,
    totalActiveManagers,
    totalInactiveManagers,
    totalRetentionRiskManagers,
    leagueSummaries,
    attentionQueue,
    recentChanges,
    warnings: [],
  }
}
