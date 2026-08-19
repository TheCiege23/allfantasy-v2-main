/**
 * Fantasy OS Suite — Phase V2.3: League OS Executive Analytics Workspace.
 *
 * Provider-agnostic view models for the League OS flagship (League Momentum) and its supporting graphs.
 * Built purely from the existing `LeagueAnalyticsSnapshot` (`lib/decision-os/leagueAnalytics.ts`) — the
 * purpose-built, id-only "what is happening in this league over time" Decision OS composition — plus, for
 * Competitive Balance only, the already-loaded `fairnessScore` from the league's
 * `CommissionerLeagueHealthSnapshot`. No new Decision OS logic, no new fetch/contract, no raw provider
 * payloads, no player-level records, no provider identifiers.
 *
 * League OS speaks about the LEAGUE — the ecosystem — never an individual manager, commissioner, or
 * player. `LeagueActivityTrendSummary` carries LEGITIMATE history (periods tracked + event-count delta +
 * direction), so League Momentum uses real momentum when it exists and degrades to an honest current-
 * state snapshot when it doesn't — never a fabricated trend (per the Step 1 audit).
 */
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { ExecutiveHealthStatus, ExecutiveBarDatum, ExecutiveSupportingChart } from './commissionerLeagueHealthViewModel'
import { statusFromScore } from './recommendationPresentation'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// ─── Flagship: League Momentum ─────────────────────────────────────────────────

export type LeagueMomentumStatus = 'accelerating' | 'steady' | 'cooling' | 'current_snapshot' | 'unavailable'

export type LeagueMomentumViewModel = {
  status: LeagueMomentumStatus
  tone: ExecutiveHealthStatus
  headline: string
  /** True when a legitimate multi-period activity trend exists; false = current-state snapshot only. */
  hasHistory: boolean
  direction: 'increasing' | 'decreasing' | 'flat' | null
  eventCountDelta: number | null
  periodsTracked: number | null
  latestEventCount: number | null
  latestManagerCount: number | null
  totalActivity: number
  activeManagers: number
  updatedAt: string
  available: boolean
}

const MOMENTUM_LABEL: Record<LeagueMomentumStatus, string> = {
  accelerating: 'Accelerating',
  steady: 'Steady',
  cooling: 'Cooling',
  current_snapshot: 'Current snapshot',
  unavailable: 'Not available',
}

export function leagueMomentumLabel(status: LeagueMomentumStatus): string {
  return MOMENTUM_LABEL[status]
}

export function buildLeagueMomentum(
  snapshot: LeagueAnalyticsSnapshot | null | undefined,
): LeagueMomentumViewModel | null {
  if (!snapshot) return null
  if (!snapshot.available) {
    return {
      status: 'unavailable',
      tone: 'unavailable',
      headline: 'League momentum appears once this league has enough activity to summarize.',
      hasHistory: false,
      direction: null,
      eventCountDelta: null,
      periodsTracked: null,
      latestEventCount: null,
      latestManagerCount: null,
      totalActivity: 0,
      activeManagers: 0,
      updatedAt: snapshot.generatedAt,
      available: false,
    }
  }

  const totalActivity =
    snapshot.activity.tradeCount +
    snapshot.activity.waiverClaimCount +
    snapshot.activity.draftPickCount +
    snapshot.activity.rosterActivityCount
  const activeManagers = snapshot.managerCounts.activeManagers

  if (snapshot.trend.available) {
    const t = snapshot.trend
    const status: LeagueMomentumStatus =
      t.direction === 'increasing' ? 'accelerating' : t.direction === 'decreasing' ? 'cooling' : 'steady'
    const tone: ExecutiveHealthStatus =
      t.direction === 'increasing' ? 'excellent' : t.direction === 'decreasing' ? 'at_risk' : 'healthy'
    const deltaLabel = `${t.eventCountDelta >= 0 ? '+' : ''}${t.eventCountDelta}`
    const headline = `League activity is ${t.direction} (${deltaLabel} moves over ${t.periodsTracked} tracked ${t.periodsTracked === 1 ? 'period' : 'periods'}).`
    return {
      status,
      tone,
      headline,
      hasHistory: true,
      direction: t.direction,
      eventCountDelta: t.eventCountDelta,
      periodsTracked: t.periodsTracked,
      latestEventCount: t.latestEventCount,
      latestManagerCount: t.latestManagerCount,
      totalActivity,
      activeManagers,
      updatedAt: snapshot.generatedAt,
      available: true,
    }
  }

  // No legitimate history yet — an honest current-state snapshot, NOT a fabricated trend.
  return {
    status: 'current_snapshot',
    tone: 'healthy',
    headline: `${totalActivity} recent ${totalActivity === 1 ? 'move' : 'moves'} across the league; momentum needs more history to trend.`,
    hasHistory: false,
    direction: null,
    eventCountDelta: null,
    periodsTracked: null,
    latestEventCount: null,
    latestManagerCount: null,
    totalActivity,
    activeManagers,
    updatedAt: snapshot.generatedAt,
    available: true,
  }
}

// ─── Supporting: Transaction Distribution ──────────────────────────────────────

export function buildTransactionDistribution(
  snapshot: LeagueAnalyticsSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveBarDatum> {
  if (!snapshot || !snapshot.available) {
    return { headline: 'Transaction activity appears once this league is active.', items: [], available: false }
  }
  const a = snapshot.activity
  const raw: { key: string; label: string; value: number }[] = [
    { key: 'trades', label: 'Trades', value: a.tradeCount },
    { key: 'waivers', label: 'Waiver claims', value: a.waiverClaimCount },
    { key: 'roster_moves', label: 'Roster moves', value: a.rosterActivityCount },
    { key: 'draft_picks', label: 'Draft picks', value: a.draftPickCount },
  ]
  const total = raw.reduce((sum, r) => sum + r.value, 0)
  if (total === 0) {
    return { headline: 'No league transactions recorded yet.', items: [], available: true }
  }
  // Distribution categories carry no severity — a uniform "active" tone reads them as volume, not risk.
  const items: ExecutiveBarDatum[] = raw
    .filter((r) => r.value > 0)
    .map((r): ExecutiveBarDatum => ({ key: r.key, label: r.label, value: r.value, status: 'healthy', valueLabel: `${r.value}` }))
    .sort((x, y) => y.value - x.value)
  const top = items[0]
  const headline = `${top.label.toLowerCase()} lead league activity (${top.value} of ${total} moves).`
  return { headline, items, available: true }
}

// ─── Supporting: Engagement Summary ────────────────────────────────────────────

export function buildLeagueEngagement(
  snapshot: LeagueAnalyticsSnapshot | null | undefined,
): ExecutiveSupportingChart<ExecutiveBarDatum> {
  if (!snapshot || !snapshot.available) {
    return { headline: 'Engagement appears once this league is connected and synced.', items: [], available: false }
  }
  const active = snapshot.managerCounts.activeManagers
  const inactive = snapshot.managerCounts.inactiveManagers
  const atRisk = snapshot.retentionRiskCount
  const totalManagers = active + inactive
  if (totalManagers === 0 && atRisk === 0) {
    return { headline: 'No manager activity has been recorded in this league yet.', items: [], available: true }
  }
  const scale = Math.max(1, totalManagers)
  const items: ExecutiveBarDatum[] = [
    {
      key: 'active',
      label: 'Active managers',
      value: active,
      max: scale,
      status: active === totalManagers ? 'excellent' : 'healthy',
      valueLabel: `${active} of ${totalManagers}`,
    },
    {
      key: 'inactive',
      label: 'Inactive managers',
      value: inactive,
      max: scale,
      status: inactive === 0 ? 'excellent' : inactive * 2 >= scale ? 'critical' : 'at_risk',
      valueLabel: `${inactive} of ${totalManagers}`,
    },
    {
      key: 'at_risk',
      label: 'At-risk managers',
      value: atRisk,
      max: scale,
      status: atRisk === 0 ? 'excellent' : 'watch',
      valueLabel: `${atRisk}`,
    },
  ]
  const quietPart = inactive + atRisk
  const headline =
    quietPart > 0
      ? `${active} of ${totalManagers} managers active; ${quietPart} ${quietPart === 1 ? 'is' : 'are'} quiet or at risk.`
      : `All ${totalManagers} managers are active.`
  return { headline, items, available: true }
}

// ─── Supporting: Competitive Balance ───────────────────────────────────────────

export type CompetitiveBalanceViewModel = {
  available: boolean
  fairnessScore: number
  status: ExecutiveHealthStatus
  label: string
  headline: string
}

export function buildCompetitiveBalance(
  healthSnapshot: CommissionerLeagueHealthSnapshot | null | undefined,
): CompetitiveBalanceViewModel {
  if (!healthSnapshot) {
    return { available: false, fairnessScore: 0, status: 'unavailable', label: 'Not available', headline: 'Competitive balance appears once league health has been computed.' }
  }
  const fairnessScore = clamp(healthSnapshot.fairnessScore, 0, 100)
  const status = statusFromScore(fairnessScore)
  const label =
    fairnessScore >= 80 ? 'Well balanced' : fairnessScore >= 65 ? 'Balanced' : fairnessScore >= 50 ? 'Some imbalance' : 'Lopsided'
  const headline = `This league is ${label.toLowerCase()} (${fairnessScore}/100 fairness).`
  return { available: true, fairnessScore, status, label, headline }
}
