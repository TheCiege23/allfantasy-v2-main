/**
 * Fantasy OS Suite — Phase OS-B3: Daily Brief Composition Engine.
 *
 * A reusable, deterministic composition layer over already-produced Decision OS outputs — NOT a new
 * intelligence layer. This module never recomputes a health score, a ranking, or an Attention Signal;
 * it only reshapes signals + a handful of already-aggregated counts (the exact same numbers
 * `commissionerCommandCenter.ts` already produces) into a "what happened, why does it matter, what
 * should I do today" digest shape. Future consumers: a Notification Engine (OS-B4), an email digest, a
 * mobile home screen, an AI Coach context feed, or (as of this phase) the Commissioner Hub's own
 * "Today's Brief" card.
 *
 * Pure and zero-I/O, exactly like `attentionSignals.ts` — every function here takes already-resolved
 * inputs and returns a plain value. This is deliberate and load-bearing: it means this module is safe
 * to import directly into a CLIENT component (`CommissionerCommandCenterSection.tsx` already does,
 * composing a brief from data it fetched for its own other cards — zero additional network request),
 * and equally safe to import into a future server-only job (`dailyBriefResolver.ts`, this phase) with
 * no risk of a Prisma/server-only leak either direction.
 *
 * Deliberately narrow "positive highlights" source: ONLY `high_league_health` signals (the one real,
 * already-existing positive Decision OS signal). "Completed drafts" and a generic "strong engagement"
 * threshold (both suggested in this phase's own instructions) were NOT added — no existing Decision OS
 * output already computes either as a derived, thresholded signal anywhere in this codebase, and
 * inventing a brand-new threshold (e.g. "engagementScore >= 80") that nothing else in the suite uses
 * would be exactly the kind of new-intelligence generation this phase's own instructions prohibit
 * ("It never recomputes health scores, rankings, or attention signals... consume existing Decision OS
 * outputs only"). Omitted per that instruction, not an oversight — see `docs/os/DAILY_BRIEF.md` §2.
 */

import {
  sortAttentionSignals,
  type DecisionOsAttentionSignal,
} from './attentionSignals'

const TOP_PRIORITY_CAP = 5

export interface DailyBriefOverview {
  leaguesMonitored: number
  leaguesNeedingAttention: number
  healthyLeagueCount: number
  draftsApproachingCount: number
}

/** Same shape as `CommissionerRecentChangeEntry` (`commissionerCommandCenter.ts`) — a real trend this
 * module consumes as-is, never re-derives. `'flat'` is excluded from the caller's `leagueTrends` input
 * being surfaced as a highlight ("meaningful activity" means the trend actually moved). */
export interface DailyBriefLeagueHighlight {
  leagueId: string
  direction: 'increasing' | 'decreasing'
  eventCountDelta: number
}

export interface DailyBriefPositiveHighlight {
  leagueId: string
  title: string
  detail: string
}

export interface DailyBrief {
  generatedAt: string
  overview: DailyBriefOverview
  /** Highest-severity Attention Signals, capped and ordered by `sortAttentionSignals` — the SAME
   * canonical ordering the Attention Queue itself uses, never a Daily-Brief-specific reordering. */
  topPriorityItems: DecisionOsAttentionSignal[]
  leagueHighlights: DailyBriefLeagueHighlight[]
  positiveHighlights: DailyBriefPositiveHighlight[]
  /** Deduplicated, order-preserving `recommendedAction` strings already attached to `topPriorityItems`
   * — never a new, invented recommendation, and never sourced from signals outside the top-priority
   * cut (a signal that didn't make the brief doesn't get its recommendation surfaced either). */
  recommendedActions: string[]
  /** True only when there is truly nothing above informational severity — the same bar
   * `leaguesNeedingAttention` uses. */
  isHealthy: boolean
  /** A single, deterministic, template-composed sentence — never AI-generated, never a claim this
   * object's own fields don't already support. */
  summary: string
}

export interface DailyBriefLeagueTrend {
  leagueId: string
  direction: 'increasing' | 'decreasing' | 'flat'
  eventCountDelta: number
}

export interface DailyBriefInput {
  leaguesMonitored: number
  /** Reused as-is from the caller's own already-computed aggregate (e.g.
   * `CommissionerCommandCenterSnapshot.healthyLeagueCount`) — not recomputed here. */
  healthyLeagueCount: number
  /** Reused as-is from the caller's own already-computed aggregate (e.g. the command-center route's
   * `draftsApproachingCount`) — not recomputed here. */
  draftsApproachingCount: number
  /** Already-derived Attention Signals (e.g. `CommissionerCommandCenterSnapshot.attentionQueue` or
   * `resolveAttentionQueueSnapshot`'s own output) — consumed wholesale, never re-derived. */
  signals: readonly DecisionOsAttentionSignal[]
  /** Already-derived per-league trends (e.g. `CommissionerCommandCenterSnapshot.recentChanges`). */
  leagueTrends: readonly DailyBriefLeagueTrend[]
}

function composeSummary(o: {
  leaguesNeedingAttention: number
  draftsApproachingCount: number
  isHealthy: boolean
}): string {
  const draftClause =
    o.draftsApproachingCount > 0
      ? ` ${o.draftsApproachingCount} draft${o.draftsApproachingCount === 1 ? '' : 's'} approaching.`
      : ''
  if (o.isHealthy) {
    return `Every league looks healthy today.${draftClause}`
  }
  return `${o.leaguesNeedingAttention} league${o.leaguesNeedingAttention === 1 ? '' : 's'} need${
    o.leaguesNeedingAttention === 1 ? 's' : ''
  } your attention today.${draftClause}`
}

/**
 * Composes a Daily Brief from already-resolved Decision OS outputs. Deterministic — the same input
 * (modulo `now`, which only affects `generatedAt`) always produces the same brief. Never throws — a
 * fully empty input (zero leagues, zero signals) composes an honest, valid "everything looks healthy"
 * brief rather than a special-cased error state.
 */
export function composeDailyBrief(input: DailyBriefInput, now: Date = new Date()): DailyBrief {
  const sortedSignals = sortAttentionSignals(input.signals)
  const topPriorityItems = sortedSignals.slice(0, TOP_PRIORITY_CAP)

  const leaguesNeedingAttention = new Set(
    sortedSignals.filter((s) => s.severity !== 'informational').map((s) => s.leagueId),
  ).size
  const isHealthy = leaguesNeedingAttention === 0

  const leagueHighlights: DailyBriefLeagueHighlight[] = input.leagueTrends
    .filter((t): t is DailyBriefLeagueTrend & { direction: 'increasing' | 'decreasing' } => t.direction !== 'flat')
    .map((t) => ({ leagueId: t.leagueId, direction: t.direction, eventCountDelta: t.eventCountDelta }))

  const positiveHighlights: DailyBriefPositiveHighlight[] = sortedSignals
    .filter((s) => s.type === 'high_league_health')
    .map((s) => ({ leagueId: s.leagueId, title: s.title, detail: s.explanation }))

  const recommendedActions: string[] = []
  for (const item of topPriorityItems) {
    if (item.recommendedAction && !recommendedActions.includes(item.recommendedAction)) {
      recommendedActions.push(item.recommendedAction)
    }
  }

  return {
    generatedAt: now.toISOString(),
    overview: {
      leaguesMonitored: input.leaguesMonitored,
      leaguesNeedingAttention,
      healthyLeagueCount: input.healthyLeagueCount,
      draftsApproachingCount: input.draftsApproachingCount,
    },
    topPriorityItems,
    leagueHighlights,
    positiveHighlights,
    recommendedActions,
    isHealthy,
    summary: composeSummary({
      leaguesNeedingAttention,
      draftsApproachingCount: input.draftsApproachingCount,
      isHealthy,
    }),
  }
}
