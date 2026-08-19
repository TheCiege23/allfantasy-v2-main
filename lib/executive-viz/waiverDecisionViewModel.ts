/**
 * Fantasy OS Suite — Phase V2.5: Waiver OS Executive Analytics Workspace.
 *
 * Provider-agnostic view models for the Waiver OS flagship (Waiver Impact Sequence) and its supporting
 * graphs. Built purely from the trade-free, waiver-category Phase 6.4 `Recommendation`s already carried by
 * `ManagerCommandCenterSnapshot` (fetched by the Manager Hub), plus its `attentionQueue` severities. No
 * new Decision OS logic, no new fetch/contract, no raw provider/waiver payloads, no player-level records,
 * no provider identifiers.
 *
 * ── Step 1 audit outcome (drives the flagship's form) ────────────────────────────────────────────────
 * Available (current-snapshot / ordinal): waiver recommendation `priority`, `confidence`, `expectedImpact`
 * (plain language), `recommendedActions`, `evidence`, `completeness`; attention-signal `severity`.
 *
 * NOT available to any customer-facing surface:
 *   • FAAB remaining/budget, `faabPressure`, `waiverPriority`, claim limits — these DO exist as a real
 *     normalized contract (`WaiverResourceIntel` in `lib/decision-os/waiver/world.ts`) but NO route
 *     exposes them, so surfacing them would require backend expansion. → Resource Strategy is DEFERRED,
 *     never fabricated.
 *   • `nextProcessAtIso` processing deadlines (`WaiverSubmissionState`) — same: real but unexposed.
 *     → NO deadlines are shown and NO opportunity-expiration is invented.
 *   • waiver-impact history, pickup success, waiver competition, positional demand, league pickup trends,
 *     available-player lists — these do not exist as provider-agnostic contracts at all.
 *
 * MANDATORY HONESTY RULE applied: because no legitimate temporal waiver data is reachable, the flagship is
 * an ordered **Waiver Impact Sequence** (action order by existing recommendation priority), NOT a
 * time-series "timeline". Recommendation ordering is never labeled as historical movement.
 */
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import type { Recommendation, RecommendationPriority, RecommendationConfidence, RecommendationCategory } from '@/lib/decision-os/phase6/recommendations/types'
import type { ExecutiveHealthStatus, ExecutiveBarDatum, ExecutiveSupportingChart } from './commissionerLeagueHealthViewModel'
import { PRIORITY_RANK, statusFromPriority, titleCase } from './recommendationPresentation'

const WAIVER_CATEGORIES = new Set<RecommendationCategory>(['waiver_opportunity', 'waiver_activation'])

function waiverRecommendations(snapshot: ManagerCommandCenterSnapshot | null | undefined): Recommendation[] {
  if (!snapshot) return []
  return snapshot.recommendations.filter((e) => WAIVER_CATEGORIES.has(e.recommendation.category)).map((e) => e.recommendation)
}

/** A decision "cannot wait" when the engine itself rated it critical or high. */
function isUrgent(priority: RecommendationPriority): boolean {
  return priority === 'critical' || priority === 'high'
}

// ─── Flagship: Waiver Impact Sequence (ordered, NOT a timeline) ────────────────

export type WaiverOpportunity = {
  key: string
  /** Plain-language label. Never a provider waiver status or internal identifier. */
  label: string
  /** Why it matters + the required action — the decision, not the player card. */
  detail: string
  priorityLabel: string
  confidenceLabel: string
  status: ExecutiveHealthStatus
  urgent: boolean
}

export type WaiverImpactSequenceViewModel = {
  available: boolean
  /** Explicitly ordered by existing recommendation priority — order, not chronology. */
  opportunities: WaiverOpportunity[]
  urgentCount: number
  totalCount: number
  headline: string
  /** Always false: no reachable temporal contract. Asserted by tests. */
  hasTemporalData: false
}

function toOpportunity(rec: Recommendation): WaiverOpportunity {
  const action = rec.recommendedActions[0]?.action
  const why = rec.expectedImpact
  const detail = action && why ? `${why} ${action}` : action || why || 'Review this waiver opportunity.'
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

export function buildWaiverImpactSequence(
  snapshot: ManagerCommandCenterSnapshot | null | undefined,
): WaiverImpactSequenceViewModel {
  const recs = waiverRecommendations(snapshot)
  const opportunities = [...recs]
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
    .slice(0, 8)
    .map(toOpportunity)
  const urgentCount = opportunities.filter((o) => o.urgent).length
  const totalCount = opportunities.length

  const headline =
    totalCount === 0
      ? 'No waiver opportunities are open right now — nothing on the wire would materially improve your team.'
      : urgentCount > 0
        ? `${urgentCount} of ${totalCount} waiver ${totalCount === 1 ? 'decision' : 'decisions'} cannot wait; work the list in order.`
        : `${totalCount} waiver ${totalCount === 1 ? 'opportunity' : 'opportunities'} to weigh, in priority order — none are urgent.`

  return {
    available: Boolean(snapshot),
    opportunities,
    urgentCount,
    totalCount,
    headline,
    hasTemporalData: false,
  }
}

// ─── Supporting: Opportunity Impact (priority distribution — no invented scores) ─

const PRIORITY_TIERS: RecommendationPriority[] = ['critical', 'high', 'medium', 'low']

export function buildWaiverOpportunityImpact(
  snapshot: ManagerCommandCenterSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveBarDatum> {
  if (!snapshot) {
    return { headline: 'Waiver opportunities appear once a league is connected and synced.', items: [], available: false }
  }
  const recs = waiverRecommendations(snapshot)
  if (recs.length === 0) {
    return { headline: 'No waiver opportunities to weigh right now.', items: [], available: true }
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
      ? `1 ${top.label.toLowerCase()} opportunity leads the board (${recs.length} total).`
      : `${top.value} ${top.label.toLowerCase()} opportunities lead the board (${recs.length} total).`
  return { headline, items, available: true }
}

// ─── Supporting: Waiver Urgency (share that cannot wait) ───────────────────────

export type WaiverUrgencyViewModel = {
  available: boolean
  urgentCount: number
  totalCount: number
  /** Share of open waiver decisions the engine rated critical/high. 0 when none are open. */
  urgentPct: number
  status: ExecutiveHealthStatus
  headline: string
  /** Highest-severity waiver-related attention signals, when any exist. */
  urgentLabels: string[]
}

export function buildWaiverUrgency(
  snapshot: ManagerCommandCenterSnapshot | null | undefined,
): WaiverUrgencyViewModel {
  if (!snapshot) {
    return { available: false, urgentCount: 0, totalCount: 0, urgentPct: 0, status: 'unavailable', headline: 'Waiver urgency appears once a league is connected and synced.', urgentLabels: [] }
  }
  const recs = waiverRecommendations(snapshot)
  const urgent = recs.filter((r) => isUrgent(r.priority))
  const totalCount = recs.length
  const urgentCount = urgent.length
  const urgentPct = totalCount > 0 ? Math.round((urgentCount / totalCount) * 100) : 0

  const status: ExecutiveHealthStatus =
    totalCount === 0 ? 'excellent' : urgentCount === 0 ? 'healthy' : urgentPct >= 50 ? 'critical' : 'at_risk'

  const headline =
    totalCount === 0
      ? 'Nothing on the waiver wire needs your attention right now.'
      : urgentCount === 0
        ? totalCount === 1
          ? 'Your one waiver opportunity is not urgent.'
          : `None of your ${totalCount} waiver opportunities are urgent.`
        : `${urgentCount} of ${totalCount} waiver ${totalCount === 1 ? 'decision' : 'decisions'} cannot wait.`

  return {
    available: true,
    urgentCount,
    totalCount,
    urgentPct,
    status,
    headline,
    urgentLabels: urgent.map((r) => titleCase(r.category)).slice(0, 3),
  }
}

/** Exposed so a test can assert Resource Strategy is deliberately deferred rather than fabricated. */
export const WAIVER_RESOURCE_STRATEGY_DEFERRED = {
  deferred: true,
  reason:
    'FAAB budget/remaining, faabPressure, waiverPriority, claim limits and processing deadlines exist in the real WaiverWorld contract but are not exposed by any customer-facing route; surfacing them would require backend expansion.',
} as const
