/**
 * Fantasy OS Suite — Phase V2.0: Executive Visualization Engine.
 *
 * Provider-agnostic view model for the Commissioner OS signature visualization (the League Health Map).
 *
 * This is the boundary the phase's data-integrity rules require: the visual layer consumes THIS
 * role-specific, provider-agnostic shape — never a raw Sleeper/ESPN/Yahoo/Fantrax payload, never an
 * internal DB row, never a provider-specific identifier. `CommissionerLeagueHealthSnapshot` is already a
 * normalized Commissioner OS contract (`lib/commissioner-hub/commissionerHubHealth.ts`) computed from
 * `monitorLeagueHealth()`; this file only reshapes it into the executive dimensions the chart renders and
 * attaches plain-language, customer-facing copy. No new intelligence is computed here — every number
 * already existed in the snapshot. Nothing here fabricates history, a trend direction, or sample points:
 * the snapshot is a current-moment reading, so the view model is too.
 */
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
// Phase V4.0: `statusFromScore` is re-exported here for backward compatibility, but its single source of
// truth now lives in `recommendationPresentation.ts` alongside the other status mappings.
import { statusFromScore } from './recommendationPresentation'

/** 5 real health tiers (from the canonical `OverallStatus` domain) plus an explicit `unavailable` for
 * dimensions whose backing data genuinely isn't present, rather than silently drawing them as "good". */
export type ExecutiveHealthStatus = 'excellent' | 'healthy' | 'watch' | 'at_risk' | 'critical' | 'unavailable'

export type CommissionerHealthDimension = {
  /** Stable key for React lists / tests — never rendered to the customer. */
  key: string
  /** Plain-language, provider-agnostic label ("Manager activity", not an API/resolver/signal name). */
  label: string
  status: ExecutiveHealthStatus
  /** 0–100 "how healthy is this area" fill for the bar, where higher is always better, so one bar
   * direction reads consistently across every dimension. `null` only when the data is unavailable. */
  score: number | null
  /** The real underlying figure shown as text ("8 of 12 active", "3 open"), so the honest metric is
   * always visible even though the bar is a normalized readiness fill. */
  valueLabel: string
  /** One sentence, no jargon: why a commissioner should care about this area. */
  whyItMatters: string
  /** Direct path to the appropriate Commissioner OS action, only when a real enabled action exists. */
  actionHref?: string
  actionLabel?: string
}

export type CommissionerAttentionSummary = {
  needsAttentionCount: number
  monitorCount: number
  stableCount: number
  worstStatus: ExecutiveHealthStatus
  /** Non-visual, screen-reader-first sentence describing the whole map. */
  headline: string
}

export type CommissionerLeagueHealthViewModel = {
  leagueId: string
  leagueName: string
  /** "NFL redraft · Week 5 · 12 teams" — provider-agnostic context, no provider or DB identifiers. */
  contextLabel: string
  overallStatus: ExecutiveHealthStatus
  overallScore: number
  updatedAt: string
  dataConfidence: 'high' | 'medium' | 'low'
  dimensions: CommissionerHealthDimension[]
  attention: CommissionerAttentionSummary
  /** False when there is genuinely no snapshot to render — the map must show its unavailable state,
   * never invent placeholder dimensions. */
  available: boolean
}

const STATUS_SEVERITY: Record<ExecutiveHealthStatus, number> = {
  critical: 5,
  at_risk: 4,
  watch: 3,
  unavailable: 2,
  healthy: 1,
  excellent: 0,
}

/** Rank worst-first, so the areas that need the commissioner's attention rise to the top of the map. */
export function compareDimensionSeverity(a: CommissionerHealthDimension, b: CommissionerHealthDimension): number {
  return STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}


function normalizeOverallStatus(status: string): ExecutiveHealthStatus {
  switch (status) {
    case 'excellent':
    case 'healthy':
    case 'watch':
    case 'at_risk':
    case 'critical':
      return status
    default:
      return 'unavailable'
  }
}

function formatContextLabel(snapshot: CommissionerLeagueHealthSnapshot): string {
  const parts = [snapshot.sport, snapshot.leagueType].filter(Boolean).join(' ')
  const week = Number.isFinite(snapshot.currentWeek) && snapshot.currentWeek > 0 ? `Week ${snapshot.currentWeek}` : null
  const teams = snapshot.teamCount > 0 ? `${snapshot.teamCount} teams` : null
  return [parts || 'League', week, teams].filter(Boolean).join(' · ')
}

/** Attach a real, enabled commissioner action to a dimension when one is directly relevant. Returns
 * `{}` (no action) rather than a disabled/placeholder link when nothing appropriate is available. */
function actionFor(
  snapshot: CommissionerLeagueHealthSnapshot,
  key: string,
): { actionHref?: string; actionLabel?: string } {
  const action = snapshot.actions.find((a) => a.key === key && a.enabled)
  if (!action) return {}
  return { actionHref: action.href, actionLabel: action.label }
}

/**
 * Map a normalized Commissioner OS health snapshot into the executive dimensions the League Health Map
 * renders. Pure and provider-agnostic: identical output whether the snapshot originated from Sleeper,
 * ESPN, Yahoo, Fantrax, MFL, Fleaflicker, or native AllFantasy data.
 */
export function buildCommissionerLeagueHealthViewModel(
  snapshot: CommissionerLeagueHealthSnapshot | null | undefined,
): CommissionerLeagueHealthViewModel | null {
  if (!snapshot) return null

  const m = snapshot.metrics
  const dimensions: CommissionerHealthDimension[] = []

  // 1. Overall health — the canonical OverallStatus, shown as-is (no re-derivation).
  dimensions.push({
    key: 'overall_health',
    label: 'Overall league health',
    status: normalizeOverallStatus(snapshot.overallStatus),
    score: clamp(snapshot.healthScore, 0, 100),
    valueLabel: `${snapshot.healthScore}/100`,
    whyItMatters: 'A single read on whether this league is thriving or drifting toward trouble.',
    ...actionFor(snapshot, 'settings'),
  })

  // 2. Manager activity — active vs. total, status driven by how many teams have gone inactive.
  const activePct = snapshot.teamCount > 0 ? Math.round((m.activeManagers / snapshot.teamCount) * 100) : null
  const activityStatus: ExecutiveHealthStatus =
    activePct === null
      ? 'unavailable'
      : m.inactiveTeams === 0
        ? statusFromScore(activePct)
        : m.inactiveTeams >= 3
          ? 'critical'
          : m.inactiveTeams >= 2
            ? 'at_risk'
            : 'watch'
  dimensions.push({
    key: 'manager_activity',
    label: 'Manager activity',
    status: activityStatus,
    score: activePct,
    valueLabel:
      activePct === null
        ? 'Not available'
        : `${m.activeManagers} of ${snapshot.teamCount} active${m.inactiveTeams > 0 ? ` · ${m.inactiveTeams} inactive` : ''}`,
    whyItMatters: 'Inactive managers stall trades, waivers, and lineups for everyone else in the league.',
    ...actionFor(snapshot, 'settings'),
  })

  // 3. Lineup readiness — submission rate (0–1 fraction in the snapshot), missed lineups as context.
  const lineupPct = Math.round(clamp(m.lineupSubmissionRate, 0, 1) * 100)
  const lineupStatus: ExecutiveHealthStatus = m.missedLineups > 0 && lineupPct >= 50 ? 'watch' : statusFromScore(lineupPct)
  dimensions.push({
    key: 'lineup_readiness',
    label: 'Lineup readiness',
    status: lineupStatus,
    score: lineupPct,
    valueLabel: `${lineupPct}% submitted${m.missedLineups > 0 ? ` · ${m.missedLineups} missed` : ''}`,
    whyItMatters: 'Missed lineups quietly hand out wins and are the first sign a manager is checking out.',
    ...actionFor(snapshot, 'force_lineup'),
  })

  // 4. Competitive balance — the fairness sub-score.
  dimensions.push({
    key: 'competitive_balance',
    label: 'Competitive balance',
    status: statusFromScore(snapshot.fairnessScore),
    score: clamp(snapshot.fairnessScore, 0, 100),
    valueLabel: `${snapshot.fairnessScore}/100`,
    whyItMatters: 'Lopsided leagues lose their casual managers first; balance keeps everyone invested.',
  })

  // 5. Engagement — the engagement sub-score.
  dimensions.push({
    key: 'engagement',
    label: 'Engagement',
    status: statusFromScore(snapshot.engagementScore),
    score: clamp(snapshot.engagementScore, 0, 100),
    valueLabel: `${snapshot.engagementScore}/100`,
    whyItMatters: 'Trades, waivers, and chat are the heartbeat of a league that renews next season.',
  })

  // 6. Unresolved actions — a real count of things waiting on the commissioner; readiness is the inverse.
  const openCount = m.pendingWaiverClaims + m.pendingTrades + m.openAiAlerts + m.commissionerActions
  const unresolvedStatus: ExecutiveHealthStatus =
    openCount === 0 ? 'excellent' : openCount <= 2 ? 'watch' : openCount <= 5 ? 'at_risk' : 'critical'
  dimensions.push({
    key: 'unresolved_actions',
    label: 'Unresolved actions',
    status: unresolvedStatus,
    score: openCount === 0 ? 100 : clamp(100 - openCount * 15, 10, 90),
    valueLabel: openCount === 0 ? 'All clear' : `${openCount} open`,
    whyItMatters: 'Pending waivers, trades, and alerts left unattended erode trust in the commissioner.',
    ...actionFor(snapshot, 'process_waivers'),
  })

  // 7. Sustainability — the sustainability sub-score (will this league come back next season).
  dimensions.push({
    key: 'sustainability',
    label: 'Season sustainability',
    status: statusFromScore(snapshot.sustainabilityScore),
    score: clamp(snapshot.sustainabilityScore, 0, 100),
    valueLabel: `${snapshot.sustainabilityScore}/100`,
    whyItMatters: 'A read on whether this league has the momentum to finish the season and renew.',
  })

  // 8. Data readiness — projection coverage + confidence, so the map is honest about its own inputs.
  const coverage = clamp(m.projectionCoveragePct, 0, 100)
  const dataStatus: ExecutiveHealthStatus =
    snapshot.dataConfidence === 'low' ? 'at_risk' : coverage >= 70 ? statusFromScore(coverage) : 'watch'
  dimensions.push({
    key: 'data_readiness',
    label: 'Data readiness',
    status: dataStatus,
    score: coverage,
    valueLabel: `${coverage}% coverage · ${snapshot.dataConfidence} confidence`,
    whyItMatters: 'Thin data weakens every recommendation — the map flags its own confidence, not just the league.',
  })

  dimensions.sort(compareDimensionSeverity)

  const needsAttentionCount = dimensions.filter((d) => d.status === 'at_risk' || d.status === 'critical').length
  const monitorCount = dimensions.filter((d) => d.status === 'watch').length
  const stableCount = dimensions.filter((d) => d.status === 'excellent' || d.status === 'healthy').length
  const worstStatus = dimensions.reduce<ExecutiveHealthStatus>(
    (worst, d) => (STATUS_SEVERITY[d.status] > STATUS_SEVERITY[worst] ? d.status : worst),
    'excellent',
  )

  const headline =
    needsAttentionCount > 0
      ? `${needsAttentionCount} ${needsAttentionCount === 1 ? 'area needs' : 'areas need'} attention in ${snapshot.leagueName}; ${stableCount} stable.`
      : monitorCount > 0
        ? `No urgent issues in ${snapshot.leagueName}; ${monitorCount} ${monitorCount === 1 ? 'area' : 'areas'} to monitor, ${stableCount} stable.`
        : `${snapshot.leagueName} looks healthy across all ${dimensions.length} tracked areas.`

  return {
    leagueId: snapshot.leagueId,
    leagueName: snapshot.leagueName,
    contextLabel: formatContextLabel(snapshot),
    overallStatus: normalizeOverallStatus(snapshot.overallStatus),
    overallScore: clamp(snapshot.healthScore, 0, 100),
    updatedAt: snapshot.generatedAt,
    dataConfidence: snapshot.dataConfidence,
    dimensions,
    attention: { needsAttentionCount, monitorCount, stableCount, worstStatus, headline },
    available: true,
  }
}

/** Pick the snapshot that most needs the commissioner's attention (worst overall status, then lowest
 * score), so a multi-league commissioner sees their most at-risk league as the flagship. */
export function selectFlagshipSnapshot(
  snapshots: CommissionerLeagueHealthSnapshot[],
): CommissionerLeagueHealthSnapshot | null {
  if (snapshots.length === 0) return null
  return [...snapshots].sort((a, b) => {
    const severity = STATUS_SEVERITY[normalizeOverallStatus(b.overallStatus)] - STATUS_SEVERITY[normalizeOverallStatus(a.overallStatus)]
    if (severity !== 0) return severity
    return a.healthScore - b.healthScore
  })[0]
}

// ─── Phase V2.1 — supporting executive visualizations ──────────────────────────
// Each builder is pure and provider-agnostic, reshaping the SAME normalized snapshot into display data
// for one supporting graph that answers one commissioner question. No new intelligence, no history, no
// player-level records, no provider fields.

/** Structurally compatible with the chart layer's `ExecutiveBarItem`. */
export type ExecutiveBarDatum = {
  key: string
  label: string
  value: number
  max?: number
  status: ExecutiveHealthStatus
  valueLabel?: string
}

export type ExecutiveRingDatum = {
  key: string
  label: string
  value: number
  status: ExecutiveHealthStatus
  valueLabel?: string
}

export type ExecutiveSupportingChart<T> = {
  headline: string
  items: T[]
  available: boolean
}

function statusFromCount(count: number, watchAt: number, riskAt: number, criticalAt: number): ExecutiveHealthStatus {
  if (count <= 0) return 'excellent'
  if (count >= criticalAt) return 'critical'
  if (count >= riskAt) return 'at_risk'
  if (count >= watchAt) return 'watch'
  return 'healthy'
}

const SEVERITY_RANK: Record<ExecutiveHealthStatus, number> = STATUS_SEVERITY

/** "Where does manager attention need to go?" — a severity distribution of real manager-issue counts
 * (not per-manager identities, which this contract does not carry), ranked worst-first. */
export function buildManagerAttentionDistribution(
  snapshot: CommissionerLeagueHealthSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveBarDatum> {
  if (!snapshot || snapshot.teamCount <= 0) {
    return { headline: 'Manager activity is not available yet.', items: [], available: false }
  }
  const m = snapshot.metrics
  const scale = snapshot.teamCount
  const items: ExecutiveBarDatum[] = [
    {
      key: 'inactive',
      label: 'Inactive managers',
      value: m.inactiveTeams,
      max: scale,
      status: statusFromCount(m.inactiveTeams, 1, 2, 3),
      valueLabel: `${m.inactiveTeams} of ${scale}`,
    },
    {
      key: 'missed_lineups',
      label: 'Missed lineups',
      value: m.missedLineups,
      max: scale,
      status: statusFromCount(m.missedLineups, 1, 3, 5),
      valueLabel: `${m.missedLineups} of ${scale}`,
    },
    {
      key: 'injured_starters',
      label: 'Injured starters',
      value: m.injuredStarters,
      max: scale,
      status: m.injuredStarters > 0 ? 'watch' : 'excellent',
      valueLabel: `${m.injuredStarters}`,
    },
    {
      key: 'low_confidence',
      label: 'Low-confidence starters',
      value: m.lowConfidenceProjectionStarters,
      max: scale,
      status: m.lowConfidenceProjectionStarters > 0 ? 'watch' : 'excellent',
      valueLabel: `${m.lowConfidenceProjectionStarters}`,
    },
  ]
  items.sort((a, b) => SEVERITY_RANK[b.status] - SEVERITY_RANK[a.status] || b.value - a.value)
  const needAttention = m.inactiveTeams + m.missedLineups
  const headline =
    needAttention > 0
      ? `${m.activeManagers} of ${scale} managers active; ${needAttention} ${needAttention === 1 ? 'issue' : 'issues'} need attention.`
      : `All ${scale} managers are active and set.`
  return { headline, items, available: true }
}

/** "Which health dimensions are dragging the overall score?" — the four real sub-scores, ranked
 * weakest-first, each on a 0–100 scale. */
export function buildLeagueHealthBreakdown(
  snapshot: CommissionerLeagueHealthSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveBarDatum> {
  if (!snapshot) return { headline: 'League health breakdown is not available yet.', items: [], available: false }
  const items: ExecutiveBarDatum[] = [
    { key: 'overall', label: 'Overall health', value: clamp(snapshot.healthScore, 0, 100) },
    { key: 'engagement', label: 'Engagement', value: clamp(snapshot.engagementScore, 0, 100) },
    { key: 'competitive_balance', label: 'Competitive balance', value: clamp(snapshot.fairnessScore, 0, 100) },
    { key: 'sustainability', label: 'Sustainability', value: clamp(snapshot.sustainabilityScore, 0, 100) },
  ].map((d) => ({
    ...d,
    max: 100,
    status: statusFromScore(d.value),
    valueLabel: `${d.value}/100`,
  }))
  items.sort((a, b) => a.value - b.value)
  const weakest = items[0]
  const headline =
    weakest && weakest.value < 65
      ? `${weakest.label} is the weakest dimension at ${weakest.value}/100.`
      : 'All health dimensions are contributing strongly.'
  return { headline, items, available: true }
}

/** "What requires my action today?" — real open-item counts by category, ranked worst-first. */
export function buildCommissionerWorkload(
  snapshot: CommissionerLeagueHealthSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveBarDatum> {
  if (!snapshot) return { headline: 'Workload is not available yet.', items: [], available: false }
  const m = snapshot.metrics
  const items: ExecutiveBarDatum[] = [
    { key: 'pending_waivers', label: 'Pending waivers', value: m.pendingWaiverClaims, status: statusFromCount(m.pendingWaiverClaims, 1, 4, 8) },
    { key: 'pending_trades', label: 'Pending trades', value: m.pendingTrades, status: statusFromCount(m.pendingTrades, 1, 3, 5) },
    { key: 'open_alerts', label: 'Open alerts', value: m.openAiAlerts, status: statusFromCount(m.openAiAlerts, 1, 3, 5) },
    { key: 'commissioner_actions', label: 'Actions to review', value: m.commissionerActions, status: statusFromCount(m.commissionerActions, 1, 3, 5) },
  ].map((d) => ({ ...d, valueLabel: String(d.value) }))
  const total = m.pendingWaiverClaims + m.pendingTrades + m.openAiAlerts + m.commissionerActions
  items.sort((a, b) => SEVERITY_RANK[b.status] - SEVERITY_RANK[a.status] || b.value - a.value)
  const headline =
    total > 0
      ? `${total} ${total === 1 ? 'item needs' : 'items need'} your action today.`
      : 'Nothing requires your action right now.'
  return { headline, items, available: true }
}

/** "Is the league operationally ready?" — three genuine 0–100 readiness metrics as progress rings. Data
 * confidence is surfaced as a label, not turned into a fabricated ring value. */
export function buildLeagueReadiness(
  snapshot: CommissionerLeagueHealthSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveRingDatum> & { confidence: 'high' | 'medium' | 'low' | null } {
  if (!snapshot || snapshot.teamCount <= 0) {
    return { headline: 'League readiness is not available yet.', items: [], available: false, confidence: null }
  }
  const m = snapshot.metrics
  const lineupPct = Math.round(clamp(m.lineupSubmissionRate, 0, 1) * 100)
  const coveragePct = Math.round(clamp(m.projectionCoveragePct, 0, 100))
  const activePct = Math.round(clamp((m.activeManagers / snapshot.teamCount) * 100, 0, 100))
  const items: ExecutiveRingDatum[] = [
    { key: 'lineups', label: 'Lineups set', value: lineupPct, status: statusFromScore(lineupPct), valueLabel: `${lineupPct}%` },
    { key: 'projections', label: 'Projection coverage', value: coveragePct, status: statusFromScore(coveragePct), valueLabel: `${coveragePct}%` },
    { key: 'managers_active', label: 'Managers active', value: activePct, status: statusFromScore(activePct), valueLabel: `${activePct}%` },
  ]
  const lowest = items.reduce((min, r) => (r.value < min.value ? r : min), items[0])
  const headline =
    lowest.value < 65
      ? `${lowest.label} is the weakest readiness area at ${lowest.valueLabel}.`
      : 'The league is operationally ready.'
  return { headline, items, available: true, confidence: snapshot.dataConfidence }
}
