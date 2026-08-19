/**
 * Fantasy OS Suite — Phase V2.7: Platform OS Executive Analytics Workspace.
 *
 * Provider-agnostic view models for the Platform OS flagship (Platform Focus) and its supporting graphs.
 * Platform OS is the executive layer ABOVE the individual Operating Systems — it SUMMARIZES them, it does
 * not duplicate them. Built purely from the cross-league `ManagerCommandCenterSnapshot` (the signed-in
 * user's entire footprint, already fetched by the Manager Hub) plus its `draftsApproachingCount`. No new
 * Decision OS logic, no new fetch/contract, no raw provider payloads, no player-level records, no provider
 * identifiers.
 *
 * ── Step 1 audit outcome (drives the flagship's form) ────────────────────────────────────────────────
 * Available (current-snapshot / ordinal, cross-league, customer-facing): recommendations by category
 * (lineup/waiver/trade/draft/engagement/participation) with priority; `attentionQueue` severities; league
 * counts (total / healthy / at-risk / unavailable) and per-league `retentionRisk`; `draftsApproachingCount`.
 *
 * NOT available (→ deferred, never fabricated): platform historical snapshots / momentum / trend series
 * (only per-league `leagueTrends` direction + `PlatformOsSnapshot.trendCoverage` COUNTS exist — no
 * platform-level series), adoption/usage/growth analytics, sync-health scores, recommendation
 * effectiveness, predictive workload, and any platform KPI history. The operator-scoped `PlatformOsSnapshot`
 * (admin route, explicit-league-list) is a different scope and is not used here.
 *
 * TRUTHFULNESS DECISION (Step 2): no platform history/trend is reachable, so the flagship is a current-state
 * **Platform Focus** (where to focus first across the footprint), NOT a fabricated "Platform Pulse".
 */
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import type { RecommendationCategory, RecommendationPriority } from '@/lib/decision-os/phase6/recommendations/types'
import type { AttentionSignalSeverity } from '@/lib/decision-os/attentionSignals'
import type { ExecutiveHealthStatus, ExecutiveBarDatum, ExecutiveSupportingChart } from './commissionerLeagueHealthViewModel'
import { PRIORITY_RANK, statusFromPriority, statusFromSeverity } from './recommendationPresentation'

const SEVERITY_RANK: Record<ExecutiveHealthStatus, number> = {
  critical: 5,
  at_risk: 4,
  watch: 3,
  unavailable: 2,
  healthy: 1,
  excellent: 0,
}

/** Which recommendation categories roll up into each customer-facing Operating System focus area. */
const FOCUS_AREAS: { key: string; label: string; categories: RecommendationCategory[] }[] = [
  { key: 'lineups', label: 'Lineups', categories: ['lineup_discipline'] },
  { key: 'waivers', label: 'Waivers', categories: ['waiver_opportunity'] },
  { key: 'trades', label: 'Trades', categories: ['trade_coaching'] },
  { key: 'draft', label: 'Draft prep', categories: ['draft_preparation'] },
  { key: 'engagement', label: 'Engagement', categories: ['engagement_boost', 'league_participation'] },
]

// ─── Flagship: Platform Focus ──────────────────────────────────────────────────

export type PlatformFocusArea = {
  key: string
  label: string
  openCount: number
  /** Highest priority open in this area, driving the status color. */
  status: ExecutiveHealthStatus
  urgentCount: number
  detail: string
}

export type PlatformFocusViewModel = {
  available: boolean
  areas: PlatformFocusArea[]
  totalOpenDecisions: number
  totalLeagues: number
  leaguesNeedingAttention: number
  draftsApproaching: number
  headline: string
  /** Always false: no reachable platform history/trend series. Asserted by tests. */
  hasPlatformHistory: false
}

export function buildPlatformFocus(
  snapshot: ManagerCommandCenterSnapshot | null | undefined,
  draftsApproachingCount: number,
): PlatformFocusViewModel {
  if (!snapshot) {
    return {
      available: false,
      areas: [],
      totalOpenDecisions: 0,
      totalLeagues: 0,
      leaguesNeedingAttention: 0,
      draftsApproaching: 0,
      headline: 'Your platform overview appears once you belong to at least one connected, synced league.',
      hasPlatformHistory: false,
    }
  }

  const byCategory = new Map<RecommendationCategory, { count: number; topPriority: RecommendationPriority; urgent: number }>()
  for (const entry of snapshot.recommendations) {
    const cat = entry.recommendation.category
    const priority = entry.recommendation.priority
    const cur = byCategory.get(cat) ?? { count: 0, topPriority: 'low', urgent: 0 }
    cur.count += 1
    if (PRIORITY_RANK[priority] > PRIORITY_RANK[cur.topPriority]) cur.topPriority = priority
    if (priority === 'critical' || priority === 'high') cur.urgent += 1
    byCategory.set(cat, cur)
  }

  const areas: PlatformFocusArea[] = FOCUS_AREAS.map((area): PlatformFocusArea => {
    let openCount = 0
    let urgentCount = 0
    let topPriority: RecommendationPriority = 'low'
    for (const cat of area.categories) {
      const c = byCategory.get(cat)
      if (!c) continue
      openCount += c.count
      urgentCount += c.urgent
      if (PRIORITY_RANK[c.topPriority] > PRIORITY_RANK[topPriority]) topPriority = c.topPriority
    }
    const status: ExecutiveHealthStatus = openCount === 0 ? 'excellent' : statusFromPriority(topPriority)
    const detail =
      openCount === 0
        ? 'Nothing open here.'
        : urgentCount > 0
          ? `${openCount} open · ${urgentCount} high priority`
          : `${openCount} open`
    return { key: area.key, label: area.label, openCount, status, urgentCount, detail }
  }).filter((a) => a.openCount > 0)

  areas.sort((a, b) => SEVERITY_RANK[b.status] - SEVERITY_RANK[a.status] || b.openCount - a.openCount)

  const totalOpenDecisions = areas.reduce((sum, a) => sum + a.openCount, 0)
  const leaguesNeedingAttention = snapshot.atRiskLeagueCount
  const draftsApproaching = Math.max(0, draftsApproachingCount)

  let headline: string
  if (totalOpenDecisions === 0 && leaguesNeedingAttention === 0) {
    headline = `Nothing needs your attention across your ${snapshot.totalLeagues} ${snapshot.totalLeagues === 1 ? 'league' : 'leagues'} right now.`
  } else {
    const top = areas[0]
    const focusPart = top ? `${top.label} ${top.label === 'Lineups' || top.label === 'Trades' || top.label === 'Waivers' ? 'need' : 'needs'} the most attention` : 'League health needs attention'
    headline = `${focusPart} — ${totalOpenDecisions} open ${totalOpenDecisions === 1 ? 'decision' : 'decisions'} across ${snapshot.totalLeagues} ${snapshot.totalLeagues === 1 ? 'league' : 'leagues'}${leaguesNeedingAttention > 0 ? `, ${leaguesNeedingAttention} needing attention` : ''}.`
  }

  return {
    available: true,
    areas,
    totalOpenDecisions,
    totalLeagues: snapshot.totalLeagues,
    leaguesNeedingAttention,
    draftsApproaching,
    headline,
    hasPlatformHistory: false,
  }
}

/** The focus areas as ranked bars for the flagship's core visualization. */
export function platformFocusBars(model: PlatformFocusViewModel): ExecutiveBarDatum[] {
  const scale = Math.max(1, ...model.areas.map((a) => a.openCount))
  return model.areas.map((a): ExecutiveBarDatum => ({
    key: a.key,
    label: a.label,
    value: a.openCount,
    max: scale,
    status: a.status,
    valueLabel: a.detail,
  }))
}

// ─── Supporting: Executive Workload (all open decisions by priority) ───────────

const PRIORITY_TIERS: RecommendationPriority[] = ['critical', 'high', 'medium', 'low']

export function buildExecutiveWorkload(
  snapshot: ManagerCommandCenterSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveBarDatum> {
  if (!snapshot) {
    return { headline: 'Your workload appears once a league is connected and synced.', items: [], available: false }
  }
  const recs = snapshot.recommendations
  if (recs.length === 0) {
    return { headline: 'No open decisions across your footprint right now.', items: [], available: true }
  }
  const counts = new Map<RecommendationPriority, number>()
  for (const e of recs) counts.set(e.recommendation.priority, (counts.get(e.recommendation.priority) ?? 0) + 1)

  const items: ExecutiveBarDatum[] = PRIORITY_TIERS.map((tier): ExecutiveBarDatum => ({
    key: tier,
    label: `${tier[0].toUpperCase()}${tier.slice(1)} priority`,
    value: counts.get(tier) ?? 0,
    max: recs.length,
    status: statusFromPriority(tier),
    valueLabel: `${counts.get(tier) ?? 0}`,
  })).filter((i) => i.value > 0)

  const urgent = (counts.get('critical') ?? 0) + (counts.get('high') ?? 0)
  const headline =
    urgent > 0
      ? `${recs.length} open ${recs.length === 1 ? 'decision' : 'decisions'} across your footprint; ${urgent} high priority.`
      : `${recs.length} open ${recs.length === 1 ? 'decision' : 'decisions'} across your footprint; none are urgent.`
  return { headline, items, available: true }
}

// ─── Supporting: Attention Summary (flagged signals by severity) ───────────────

const SEVERITY_TIERS: AttentionSignalSeverity[] = ['critical', 'high', 'medium', 'low', 'informational']

export function buildAttentionSummary(
  snapshot: ManagerCommandCenterSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveBarDatum> {
  if (!snapshot) {
    return { headline: 'Attention signals appear once a league is connected and synced.', items: [], available: false }
  }
  const signals = snapshot.attentionQueue
  if (signals.length === 0) {
    return { headline: 'No attention signals across your footprint right now.', items: [], available: true }
  }
  const counts = new Map<AttentionSignalSeverity, number>()
  for (const s of signals) counts.set(s.severity, (counts.get(s.severity) ?? 0) + 1)

  const items: ExecutiveBarDatum[] = SEVERITY_TIERS.map((tier): ExecutiveBarDatum => ({
    key: tier,
    label: `${tier[0].toUpperCase()}${tier.slice(1)}`,
    value: counts.get(tier) ?? 0,
    max: signals.length,
    status: statusFromSeverity(tier),
    valueLabel: `${counts.get(tier) ?? 0}`,
  })).filter((i) => i.value > 0)

  const critical = counts.get('critical') ?? 0
  const headline =
    critical > 0
      ? `${signals.length} attention ${signals.length === 1 ? 'signal' : 'signals'} flagged; ${critical} critical.`
      : `${signals.length} attention ${signals.length === 1 ? 'signal' : 'signals'} flagged across your footprint.`
  return { headline, items, available: true }
}

/** Exposed so a test can assert platform history/trend analytics are deferred, not fabricated. */
export const PLATFORM_TREND_ANALYTICS_DEFERRED = {
  deferred: true,
  reason:
    'No platform-level historical snapshot or trend/momentum series exists as a provider-agnostic contract (only per-league leagueTrends direction + PlatformOsSnapshot.trendCoverage counts). Adoption/usage/growth, sync-health scores, recommendation effectiveness, and predictive workload are likewise unavailable; surfacing any would be fabrication or backend expansion.',
} as const
