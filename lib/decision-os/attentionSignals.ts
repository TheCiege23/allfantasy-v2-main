/**
 * Fantasy OS Suite — Phase OS-B2: Decision OS Attention Queue.
 *
 * The reusable Decision OS Attention Signal model. "Decision OS owns signal generation, Commissioner
 * OS owns presentation" (this phase's own architectural rule): every signal here is derived from
 * data ALREADY produced by an existing, already-real Decision OS/AF source — the league health
 * engine's own status/score/alerts (`missionControl.ts`), League Context's financial status
 * (`leagueContext.ts`), and AF-native `LeagueSettings.draftDateUtc`. Nothing here computes a new
 * intelligence layer; it only interprets outputs that already exist into a uniform, prioritized shape.
 *
 * Pure and zero-I/O by design, exactly like `leagueFinancialContext.ts` — every function here takes
 * already-resolved inputs and returns a plain value. This keeps the priority/severity rules fully
 * unit-testable without mocking Prisma or any Decision OS resolver, and keeps this module reusable by
 * ANY future consumer (Commissioner OS's `commissionerCommandCenter.ts`, the standalone
 * `attentionQueue.ts` resolver, a future Notification Engine, a future Daily Brief, Platform OS, or a
 * mobile client) without those consumers duplicating the actual severity/ordering rules themselves.
 *
 * Provider-agnostic and id-only, matching every other Decision OS output's own contract: a signal
 * never carries a league display name — only `leagueId`. Resolving a human-readable league name is
 * ordinary AF/dashboard data, zipped on by the caller at the UI boundary (the exact same
 * `leagueNameById` convention every sibling Commissioner OS component already uses).
 *
 * Deliberately narrow signal set (this phase's own instruction: "use only existing data already
 * available... do not invent new backend intelligence"). Two of the originally-suggested types are
 * intentionally NOT implemented here: "Trade Activity Change" and "Waiver Activity Change" would need
 * a PER-TYPE historical trend (was trade volume up or down since last period), and no such per-type
 * trend exists anywhere in this codebase today — `LeagueActivityTrendSummary` (`dashboard-intelligence.ts`)
 * only tracks an AGGREGATE event-count delta across every activity type combined, which would make a
 * signal claiming "trade activity increased" a fabrication. Omitted per this phase's own instruction
 * ("Otherwise omit"), not an oversight.
 */

import type { LeagueFinancialStatus } from './leagueFinancialContext'
import type { ManagerRetentionRisk } from './behavioral/manager-intelligence'
import type { Recommendation } from './phase6/recommendations/types'

export type AttentionSignalSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational'

export type AttentionSignalType =
  | 'draft_approaching'
  | 'league_context_incomplete'
  | 'low_league_health'
  | 'high_league_health'
  | 'league_requires_review'
  /** Phase OS-C1: manager-facing signal types, added for `deriveManagerAttentionSignals` below. Same
   * model, same severity/sort infrastructure — these are presentation labels for already-real,
   * already-computed manager-tier values (`UserOsSnapshot.teamHealth`/`recommendations`), not a new
   * judgment layer. */
  | 'manager_engagement_risk'
  | 'manager_recommendation'

export type AttentionSignalSource =
  | 'league_health_engine'
  | 'league_context'
  | 'league_settings_draft_date'
  /** Phase OS-C1: `resolveUserOsSnapshot` (`userOs.ts`) — the single-manager, single-league Decision OS
   * composition `deriveManagerAttentionSignals` reads from. */
  | 'user_os'

export interface DecisionOsAttentionSignal {
  /** Stable and deterministic — the same underlying condition always produces the same id, so a
   * future consumer (e.g. the Notification Engine) can dedupe "have I already alerted on this?" by id
   * alone, with no hidden randomness or wall-clock component. */
  id: string
  leagueId: string
  type: AttentionSignalType
  severity: AttentionSignalSeverity
  /** Deterministic numeric ordering key — purely a function of `severity` today (see
   * `SEVERITY_RANK`). Exposed on the signal itself (not just used internally by `sortAttentionSignals`)
   * so a future consumer can re-sort a filtered subset without re-deriving severity from a string. */
  priorityScore: number
  title: string
  explanation: string
  /** `null` when the explanation itself already IS the actionable statement (e.g. a league-health
   * engine alert like "URGENT: Unresolved disputes accumulating. Commissioner action required.") or
   * when there is genuinely nothing to do (an informational positive signal) — never a fabricated
   * paraphrase of the explanation. */
  recommendedAction: string | null
  /** ISO timestamp. For most signal types this is "when Decision OS detected this condition" (`now`,
   * since no per-signal historical detection timestamp is tracked anywhere yet); for
   * `draft_approaching` this is the real, underlying draft date itself — the one case where a more
   * meaningful real timestamp already exists. */
  timestamp: string
  source: AttentionSignalSource
}

/** Phase OS-B4.5: the shared cap every Decision OS composition that surfaces a signal LIST applies
 * before returning it (`attentionQueue.ts`, `commissionerCommandCenter.ts`, `platformOs.ts` as of this
 * phase). Previously each file re-declared its own local `= 20` constant — moved here once a third
 * occurrence made that duplication worth consolidating (the same "rule of three" reasoning
 * `SEVERITY_DOT_CLASS` was consolidated under in OS-B4). */
export const ATTENTION_QUEUE_CAP = 20

/** Large, sparse gaps by design — leaves room for future finer-grained severities without renumbering. */
export const SEVERITY_RANK: Record<AttentionSignalSeverity, number> = {
  critical: 500,
  high: 400,
  medium: 300,
  low: 200,
  informational: 100,
}

export interface LeagueAttentionSignalInputs {
  leagueId: string
  now: Date
  /** `null` when league health is unavailable for this league (e.g. Mission Control couldn't resolve
   * it) — `low_league_health`/`high_league_health` simply don't fire in that case, while
   * `league_context_incomplete`/`draft_approaching` (independent data sources) still can. */
  overallStatus: string | null
  leagueHealthScore: number | null
  /** Mission Control's own already-deduplicated `recommendedActions` (urgent + standard, with any
   * standard message that duplicates an urgent one already filtered out by `missionControl.ts`) — this
   * module does not re-derive or re-filter that list, only relabels each entry as a signal. */
  recommendedActions: { priority: 'urgent' | 'standard'; message: string }[]
  financialStatus: LeagueFinancialStatus
  /** The real, unfiltered draft date if one exists — this module applies its own approaching-window
   * logic, so callers should NOT pre-filter by date range (a single source of truth for what counts as
   * "approaching," rather than splitting that rule across a caller's query and this module). */
  draftDateUtc: Date | null
}

const DRAFT_APPROACHING_WINDOW_DAYS = 14
const DRAFT_HIGH_URGENCY_DAYS = 3
const DRAFT_MEDIUM_URGENCY_DAYS = 7

const LOW_HEALTH_SEVERITY: Partial<Record<string, AttentionSignalSeverity>> = {
  critical: 'critical',
  at_risk: 'high',
  watch: 'medium',
}

function daysUntil(target: Date, now: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
}

function draftApproachingSignal(input: LeagueAttentionSignalInputs): DecisionOsAttentionSignal | null {
  if (!input.draftDateUtc) return null
  const days = daysUntil(input.draftDateUtc, input.now)
  if (days < 0 || days > DRAFT_APPROACHING_WINDOW_DAYS) return null

  const severity: AttentionSignalSeverity =
    days <= DRAFT_HIGH_URGENCY_DAYS ? 'high' : days <= DRAFT_MEDIUM_URGENCY_DAYS ? 'medium' : 'low'
  const title = days === 0 ? 'Draft is today' : days === 1 ? 'Draft is tomorrow' : `Draft in ${days} days`

  return {
    id: `draft_approaching:${input.leagueId}`,
    leagueId: input.leagueId,
    type: 'draft_approaching',
    severity,
    priorityScore: SEVERITY_RANK[severity],
    title,
    explanation: `This league's draft is scheduled for ${input.draftDateUtc.toISOString()}.`,
    recommendedAction: 'Confirm draft settings, roster rules, and pick order before draft day.',
    timestamp: input.draftDateUtc.toISOString(),
    source: 'league_settings_draft_date',
  }
}

function leagueContextIncompleteSignal(input: LeagueAttentionSignalInputs): DecisionOsAttentionSignal | null {
  if (input.financialStatus !== 'UNKNOWN') return null
  return {
    id: `league_context_incomplete:${input.leagueId}`,
    leagueId: input.leagueId,
    type: 'league_context_incomplete',
    severity: 'low',
    priorityScore: SEVERITY_RANK.low,
    title: 'Financial status not confirmed',
    explanation: "It isn't confirmed yet whether real money is involved in this league.",
    recommendedAction: 'Confirm this league is free or paid from the League Context card.',
    timestamp: input.now.toISOString(),
    source: 'league_context',
  }
}

function scoreSuffix(leagueHealthScore: number | null): string {
  return typeof leagueHealthScore === 'number' ? ` (health score ${leagueHealthScore})` : ''
}

/** Phase OS-B6: plain-English rendering of the internal status enum for user-facing explanation text
 * (e.g. `at_risk` -> `at risk`) — never changes the underlying status value itself, only how it reads
 * in a sentence a commissioner sees. */
function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

function lowLeagueHealthSignal(input: LeagueAttentionSignalInputs): DecisionOsAttentionSignal | null {
  if (!input.overallStatus) return null
  const severity = LOW_HEALTH_SEVERITY[input.overallStatus]
  if (!severity) return null
  return {
    id: `low_league_health:${input.leagueId}`,
    leagueId: input.leagueId,
    type: 'low_league_health',
    severity,
    priorityScore: SEVERITY_RANK[severity],
    title: 'League health needs attention',
    explanation: `This league's overall health status is "${humanizeStatus(input.overallStatus)}"${scoreSuffix(input.leagueHealthScore)}.`,
    recommendedAction: 'Review League Health and consider a commissioner intervention.',
    timestamp: input.now.toISOString(),
    source: 'league_health_engine',
  }
}

function highLeagueHealthSignal(input: LeagueAttentionSignalInputs): DecisionOsAttentionSignal | null {
  if (input.overallStatus !== 'excellent') return null
  return {
    id: `high_league_health:${input.leagueId}`,
    leagueId: input.leagueId,
    type: 'high_league_health',
    severity: 'informational',
    priorityScore: SEVERITY_RANK.informational,
    title: 'League health is excellent',
    explanation: `This league's overall health status is "excellent"${scoreSuffix(input.leagueHealthScore)}.`,
    recommendedAction: null,
    timestamp: input.now.toISOString(),
    source: 'league_health_engine',
  }
}

function leagueRequiresReviewSignals(input: LeagueAttentionSignalInputs): DecisionOsAttentionSignal[] {
  return input.recommendedActions.map((action, index) => {
    const severity: AttentionSignalSeverity = action.priority === 'urgent' ? 'high' : 'medium'
    return {
      id: `league_requires_review:${input.leagueId}:${index}`,
      leagueId: input.leagueId,
      type: 'league_requires_review',
      severity,
      priorityScore: SEVERITY_RANK[severity],
      title: action.priority === 'urgent' ? 'Requires immediate review' : 'Recommended review',
      explanation: action.message,
      recommendedAction: null,
      timestamp: input.now.toISOString(),
      source: 'league_health_engine',
    }
  })
}

/**
 * Phase OS-C1: manager-facing signal inputs — one manager, one league, sourced entirely from
 * `resolveUserOsSnapshot`'s (`userOs.ts`) already-real, already-computed output. `null`/empty fields
 * mean the underlying `UserOsSnapshot` was itself unavailable (`available: false`) or had nothing to
 * report — matching `LeagueAttentionSignalInputs`'s own "null overallStatus means unavailable"
 * convention.
 */
export interface ManagerAttentionSignalInputs {
  leagueId: string
  now: Date
  retentionRisk: ManagerRetentionRisk | null
  retentionRiskReasons: readonly string[]
  isInactive: boolean
  /** Real, already-computed Phase 6.4 manager-tier recommendations — reused verbatim, never
   * re-derived, re-scored, or re-prioritized. */
  recommendations: readonly Recommendation[]
}

/** `'low'` retention risk is the healthy default — never a signal, matching
 * `lowLeagueHealthSignal`'s own "healthy states don't queue" precedent. */
const MANAGER_RETENTION_SEVERITY: Partial<Record<ManagerRetentionRisk, AttentionSignalSeverity>> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
}

function managerEngagementRiskSignal(input: ManagerAttentionSignalInputs): DecisionOsAttentionSignal | null {
  if (!input.retentionRisk) return null
  const severity = MANAGER_RETENTION_SEVERITY[input.retentionRisk]
  if (!severity) return null
  const reasonSuffix = input.retentionRiskReasons.length > 0 ? ` (${input.retentionRiskReasons.join(', ')})` : ''
  return {
    id: `manager_engagement_risk:${input.leagueId}`,
    leagueId: input.leagueId,
    type: 'manager_engagement_risk',
    severity,
    priorityScore: SEVERITY_RANK[severity],
    title: input.isInactive ? 'This team has gone inactive' : "This team's engagement needs attention",
    explanation: `Your retention risk for this team is "${input.retentionRisk}"${reasonSuffix}.`,
    recommendedAction: 'Check in on your lineup, waivers, and league activity to stay engaged.',
    timestamp: input.now.toISOString(),
    source: 'user_os',
  }
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value
}

/** One signal per real, already-scored manager-tier recommendation — reuses each recommendation's own
 * `priority` as the signal severity verbatim (every `RecommendationPriority` value is a valid
 * `AttentionSignalSeverity`), never re-deriving urgency from scratch. */
function managerRecommendationSignals(input: ManagerAttentionSignalInputs): DecisionOsAttentionSignal[] {
  return input.recommendations.map((rec) => {
    const severity: AttentionSignalSeverity = rec.priority
    return {
      id: `manager_recommendation:${input.leagueId}:${rec.id}`,
      leagueId: input.leagueId,
      type: 'manager_recommendation',
      severity,
      priorityScore: SEVERITY_RANK[severity],
      title: capitalize(humanizeStatus(rec.category)),
      explanation: rec.expectedImpact,
      recommendedAction: rec.recommendedActions[0]?.action ?? null,
      timestamp: input.now.toISOString(),
      source: 'user_os',
    }
  })
}

/**
 * Derives every real, explainable attention signal for ONE manager in ONE league from an
 * already-resolved `UserOsSnapshot`. Same "never fabricate, only omit" contract as
 * `deriveLeagueAttentionSignals`. Order is insertion order only; a multi-league caller should sort
 * with `sortAttentionSignals`.
 */
export function deriveManagerAttentionSignals(input: ManagerAttentionSignalInputs): DecisionOsAttentionSignal[] {
  const signals: DecisionOsAttentionSignal[] = []
  const engagement = managerEngagementRiskSignal(input)
  if (engagement) signals.push(engagement)
  signals.push(...managerRecommendationSignals(input))
  return signals
}

/**
 * Derives every real, explainable attention signal for ONE league from already-resolved inputs. Never
 * fabricates a signal from absent data — every branch above returns `null`/`[]` rather than a
 * placeholder when its underlying condition isn't met. Order of the returned array is insertion order
 * only; callers that aggregate across leagues should sort with `sortAttentionSignals`.
 */
export function deriveLeagueAttentionSignals(input: LeagueAttentionSignalInputs): DecisionOsAttentionSignal[] {
  const signals: DecisionOsAttentionSignal[] = []
  const draft = draftApproachingSignal(input)
  if (draft) signals.push(draft)
  const context = leagueContextIncompleteSignal(input)
  if (context) signals.push(context)
  const low = lowLeagueHealthSignal(input)
  if (low) signals.push(low)
  const high = highLeagueHealthSignal(input)
  if (high) signals.push(high)
  signals.push(...leagueRequiresReviewSignals(input))
  return signals
}

/**
 * Deterministic ordering: highest `priorityScore` (i.e. most severe) first; within an identical score,
 * newest `timestamp` first. `Array.prototype.sort` is spec-guaranteed stable (ES2019+), so an exact
 * tie on both score and timestamp preserves the caller's original (deterministic) insertion order —
 * never random, matching this phase's own explicit requirement.
 */
export function sortAttentionSignals(
  signals: readonly DecisionOsAttentionSignal[],
): DecisionOsAttentionSignal[] {
  return [...signals].sort((a, b) => {
    if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore
    return b.timestamp.localeCompare(a.timestamp)
  })
}
