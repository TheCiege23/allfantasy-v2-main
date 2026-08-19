/**
 * Fantasy OS Suite — Phase V2.6: Draft OS Executive Analytics Workspace.
 *
 * Provider-agnostic view models for the Draft OS flagship (Draft Decision Ladder) and its supporting
 * graphs. Built purely from the `draft_preparation` Phase 6.4 `Recommendation`s already carried by
 * `ManagerCommandCenterSnapshot` (fetched by the Manager Hub) plus its already-computed
 * `draftsApproachingCount`. No new Decision OS logic, no new fetch/contract, no raw provider/draft
 * payloads, no player-level records, no provider identifiers.
 *
 * ── Step 1 audit outcome (drives the flagship's form) ────────────────────────────────────────────────
 * Available (current-snapshot / ordinal, customer-facing): `draft_preparation` recommendation `priority`,
 * `confidence`, `expectedImpact`, `recommendedActions`, `evidence`, `completeness`; and
 * `draftsApproachingCount` (real, derived from `LeagueSettings.draftDateUtc`).
 *
 * NOT available to any customer-facing surface (→ deferred, never fabricated):
 *   • Draft value / ADP / value-over-expected / tiers / positional scarcity / best-available /
 *     position runs / projected availability / current+upcoming picks / draft stage — these DO exist,
 *     but only inside the live draft-room runtime contract (`DraftRuntimeIntelligenceResult`, tied to
 *     `CanonicalDraftRuntimeState`, player-level) which NO route exposes; surfacing it would require
 *     backend expansion and a live draft session.
 *   • historical draft picks / historical recommendation snapshots / draft trends — do not exist as
 *     provider-agnostic contracts.
 *
 * TRUTHFULNESS DECISION (Step 2): no legitimate continuous value series or pick/timing data is reachable,
 * so the signature visualization is an ordered **Draft Decision Ladder** (priority order of the existing
 * recommendations), NOT a "Draft Value Curve". Recommendation ordering is never labeled as value movement
 * or pick chronology.
 */
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import type { Recommendation, RecommendationPriority, RecommendationCategory } from '@/lib/decision-os/phase6/recommendations/types'
import type { ExecutiveHealthStatus, ExecutiveBarDatum, ExecutiveSupportingChart } from './commissionerLeagueHealthViewModel'
import { PRIORITY_RANK, statusFromPriority, titleCase } from './recommendationPresentation'

const DRAFT_CATEGORIES = new Set<RecommendationCategory>(['draft_preparation'])

function draftRecommendations(snapshot: ManagerCommandCenterSnapshot | null | undefined): Recommendation[] {
  if (!snapshot) return []
  return snapshot.recommendations.filter((e) => DRAFT_CATEGORIES.has(e.recommendation.category)).map((e) => e.recommendation)
}

function isUrgent(priority: RecommendationPriority): boolean {
  return priority === 'critical' || priority === 'high'
}

// ─── Flagship: Draft Decision Ladder (ordered, NOT a value curve) ──────────────

export type DraftDecision = {
  key: string
  label: string
  detail: string
  priorityLabel: string
  confidenceLabel: string
  status: ExecutiveHealthStatus
  urgent: boolean
}

export type DraftDecisionLadderViewModel = {
  available: boolean
  /** Ordered by existing recommendation priority — a ladder, never a value curve or pick timeline. */
  decisions: DraftDecision[]
  urgentCount: number
  totalCount: number
  headline: string
  /** Always false: no reachable value-series contract. Asserted by tests. */
  hasValueSeries: false
  /** Always false: no reachable pick/timing contract. Asserted by tests. */
  hasPickData: false
}

function toDecision(rec: Recommendation): DraftDecision {
  const action = rec.recommendedActions[0]?.action
  const why = rec.expectedImpact
  const detail = action && why ? `${why} ${action}` : action || why || 'Review this draft preparation step.'
  return {
    key: rec.id,
    label: titleCase(rec.category),
    detail,
    priorityLabel: titleCase(rec.priority),
    confidenceLabel: `${titleCase(rec.confidence)} confidence`,
    status: statusFromPriority(rec.priority),
    urgent: isUrgent(rec.priority),
  }
}

export function buildDraftDecisionLadder(
  snapshot: ManagerCommandCenterSnapshot | null | undefined,
): DraftDecisionLadderViewModel {
  const recs = draftRecommendations(snapshot)
  const decisions = [...recs]
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
    .slice(0, 8)
    .map(toDecision)
  const urgentCount = decisions.filter((d) => d.urgent).length
  const totalCount = decisions.length

  const headline =
    totalCount === 0
      ? 'No draft preparation is open right now — nothing needs your attention before your next selection.'
      : urgentCount > 0
        ? `${urgentCount} of ${totalCount} draft ${totalCount === 1 ? 'step' : 'steps'} ${urgentCount === 1 ? 'is' : 'are'} high priority; work the ladder in order.`
        : `${totalCount} draft preparation ${totalCount === 1 ? 'step' : 'steps'} to work through, in priority order.`

  return {
    available: Boolean(snapshot),
    decisions,
    urgentCount,
    totalCount,
    headline,
    hasValueSeries: false,
    hasPickData: false,
  }
}

// ─── Supporting: Preparation Impact (priority distribution, no invented value) ──

const PRIORITY_TIERS: RecommendationPriority[] = ['critical', 'high', 'medium', 'low']

export function buildDraftPreparationImpact(
  snapshot: ManagerCommandCenterSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveBarDatum> {
  if (!snapshot) {
    return { headline: 'Draft preparation appears once a league is connected and synced.', items: [], available: false }
  }
  const recs = draftRecommendations(snapshot)
  if (recs.length === 0) {
    return { headline: 'No draft preparation steps to weigh right now.', items: [], available: true }
  }
  const counts = new Map<RecommendationPriority, number>()
  for (const r of recs) counts.set(r.priority, (counts.get(r.priority) ?? 0) + 1)

  const items: ExecutiveBarDatum[] = PRIORITY_TIERS.map((tier): ExecutiveBarDatum => ({
    key: tier,
    label: `${titleCase(tier)} priority`,
    value: counts.get(tier) ?? 0,
    max: recs.length,
    status: statusFromPriority(tier),
    valueLabel: `${counts.get(tier) ?? 0}`,
  })).filter((i) => i.value > 0)

  const top = items[0]
  const headline =
    top.value === 1
      ? `1 ${top.label.toLowerCase()} step leads your prep (${recs.length} total).`
      : `${top.value} ${top.label.toLowerCase()} steps lead your prep (${recs.length} total).`
  return { headline, items, available: true }
}

// ─── Supporting: Draft Readiness (drafts approaching + open prep, no fabricated %) ─

export type DraftReadinessViewModel = {
  available: boolean
  draftsApproaching: number
  prepItemsOpen: number
  urgentPrepCount: number
  status: ExecutiveHealthStatus
  readinessLabel: string
  headline: string
}

export function buildDraftReadiness(
  snapshot: ManagerCommandCenterSnapshot | null | undefined,
  draftsApproachingCount: number,
): DraftReadinessViewModel {
  if (!snapshot) {
    return { available: false, draftsApproaching: 0, prepItemsOpen: 0, urgentPrepCount: 0, status: 'unavailable', readinessLabel: 'Not available', headline: 'Draft readiness appears once a league is connected and synced.' }
  }
  const recs = draftRecommendations(snapshot)
  const draftsApproaching = Math.max(0, draftsApproachingCount)
  const prepItemsOpen = recs.length
  const urgentPrepCount = recs.filter((r) => isUrgent(r.priority)).length

  let status: ExecutiveHealthStatus
  let readinessLabel: string
  let headline: string
  if (draftsApproaching === 0 && prepItemsOpen === 0) {
    status = 'healthy'
    readinessLabel = 'No drafts on the horizon'
    headline = 'No drafts are approaching and no preparation is open.'
  } else if (draftsApproaching > 0 && prepItemsOpen === 0) {
    status = 'excellent'
    readinessLabel = 'Ready to draft'
    headline = `${draftsApproaching} ${draftsApproaching === 1 ? 'draft is' : 'drafts are'} approaching and nothing is left to prepare.`
  } else if (urgentPrepCount > 0) {
    status = 'at_risk'
    readinessLabel = 'Prep needed'
    headline = `${prepItemsOpen} preparation ${prepItemsOpen === 1 ? 'step' : 'steps'} open (${urgentPrepCount} high priority)${draftsApproaching > 0 ? ` with ${draftsApproaching} ${draftsApproaching === 1 ? 'draft' : 'drafts'} approaching` : ''}.`
  } else {
    status = 'watch'
    readinessLabel = 'Prep in progress'
    headline = `${prepItemsOpen} preparation ${prepItemsOpen === 1 ? 'step' : 'steps'} open${draftsApproaching > 0 ? `, ${draftsApproaching} ${draftsApproaching === 1 ? 'draft' : 'drafts'} approaching` : ' (no draft imminent)'}.`
  }

  return { available: true, draftsApproaching, prepItemsOpen, urgentPrepCount, status, readinessLabel, headline }
}

/** Exposed so a test can assert the value/pick analytics are deliberately deferred, not fabricated. */
export const DRAFT_VALUE_ANALYTICS_DEFERRED = {
  deferred: true,
  reason:
    'Draft value/ADP/tiers/best-available/position-runs/projected-availability and current+upcoming picks exist only in the live draft-room runtime contract (DraftRuntimeIntelligenceResult), which no customer-facing route exposes; surfacing them would require backend expansion. Historical draft picks and draft trends do not exist as provider-agnostic contracts at all.',
} as const
