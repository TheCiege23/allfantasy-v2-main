/**
 * Decision OS — Phase 5.4 Platform Behavioral Intelligence.
 *
 * Aggregates LeagueBehavioralIntelligence[] + ManagerBehavioralIntelligence[] +
 * BehavioralEvent[] into a single platform-scope intelligence object.
 *
 * Architecture constraints (ADR_F5_4_PLATFORM_BEHAVIORAL_INTELLIGENCE.md):
 *   - Read-only / pure: no writes, no IO, no mutations of inputs
 *   - No UI, no AI summaries, no cutover wiring, no Stage 1 soak slice modification
 *   - Deterministic: same inputs → same output (clock injected via `now` param)
 *   - No fabrication (P2): scores degrade to 0/null when data is absent
 *   - No AI generation (P3): all signals are rule-based
 *   - No customer-specific logic: scoring rules are generic across all deployments
 *
 * Pipeline: LeagueBehavioralIntelligence[] + ManagerBehavioralIntelligence[]
 *           + BehavioralEvent[] → PlatformBehavioralIntelligence
 */

import type { BehavioralEvent } from './events/types'
import type { LeagueBehavioralIntelligence } from './league-intelligence'
import type { ManagerBehavioralIntelligence } from './manager-intelligence'

// ── Platform engagement tier ──────────────────────────────────────────────────

/** Overall engagement classification for the entire platform. */
export type PlatformEngagementTier =
  | 'thriving'
  | 'healthy'
  | 'moderate'
  | 'struggling'
  | 'inactive'

// ── Uncertainty ───────────────────────────────────────────────────────────────

/**
 * Confidence in the platform intelligence, driven by data completeness
 * and sample size (number of leagues).
 */
export type PlatformUncertaintyLevel = 'low' | 'medium' | 'high' | 'very_high'

// ── Momentum & trend ──────────────────────────────────────────────────────────

/**
 * Recency-based platform activity signal.
 * Derived from the ratio of last-7-day events to total events.
 * NOTE: This is a recency proxy, not a true historical trend — see ADR.
 */
export type PlatformMomentumSignal =
  | 'accelerating'
  | 'steady'
  | 'decelerating'
  | 'dormant'
  | 'insufficient_data'

export type PlatformTrendConfidence = 'high' | 'medium' | 'low' | 'insufficient'

// ── Intervention ──────────────────────────────────────────────────────────────

export type InterventionScope = 'league' | 'manager'
export type PlatformInterventionPriority = 'critical' | 'high' | 'medium'

// ── League health distribution ────────────────────────────────────────────────

/** Breakdown of all platform leagues by engagement tier. */
export interface LeagueHealthDistribution {
  elite: number
  active: number
  moderate: number
  passive: number
  dormant: number
  totalLeagues: number
  /** Percent of leagues in 'elite' or 'active' tier (0–100, rounded). */
  healthyPercent: number
  /** Percent of leagues in 'passive' or 'dormant' tier (0–100, rounded). */
  atRiskPercent: number
}

// ── Commissioner quality distribution ─────────────────────────────────────────

/** Breakdown of all platform leagues by commissioner workload level. */
export interface CommissionerQualityDistribution {
  light: number
  moderate: number
  heavy: number
  critical: number
  totalLeagues: number
  /** Percent of leagues in 'light' or 'moderate' workload (0–100, rounded). */
  managedPercent: number
  /** Percent of leagues in 'heavy' or 'critical' workload (0–100, rounded). */
  overloadedPercent: number
}

// ── Retention distribution ────────────────────────────────────────────────────

/** Retention risk breakdowns at both manager scope and league scope. */
export interface PlatformRetentionDistribution {
  // Manager-level (from ManagerBehavioralIntelligence[])
  managersByCriticalRisk: number
  managersByHighRisk: number
  managersByMediumRisk: number
  managersByLowRisk: number
  totalManagers: number
  /** Percent of managers at 'critical' risk (0–100, rounded). */
  managerCriticalRiskPercent: number
  /** Percent of managers at 'critical' or 'high' risk (0–100, rounded). */
  managerAtRiskPercent: number

  // League-level (from LeagueBehavioralIntelligence[])
  leaguesByCriticalRisk: number
  leaguesByHighRisk: number
  leaguesByMediumRisk: number
  leaguesByLowRisk: number
  totalLeagues: number
  /** Percent of leagues at 'critical' risk (0–100, rounded). */
  leagueCriticalRiskPercent: number
  /** Percent of leagues at 'critical' or 'high' risk (0–100, rounded). */
  leagueAtRiskPercent: number
}

// ── Ecosystem dimension ───────────────────────────────────────────────────────

/**
 * Platform-wide activity health for a single transaction dimension
 * (trade / waiver / draft).
 */
export interface PlatformEcosystemDimension {
  /** Overall tier derived from `activeLeaguePercent`. */
  tier: 'high' | 'moderate' | 'low' | 'none'
  /** Sum of raw event counts across all leagues. */
  totalEvents: number
  /** Count of leagues that have at least one event in this dimension. */
  activeLeagues: number
  totalLeagues: number
  /** Percent of leagues with activity (0–100, rounded). */
  activeLeaguePercent: number
  /** totalEvents / totalLeagues, rounded to 2 decimal places. */
  perLeagueRate: number
  /** totalEvents / totalManagers, rounded to 2 decimal places. */
  perManagerRate: number
  warnings: string[]
}

// ── Activity heatmap ──────────────────────────────────────────────────────────

/**
 * A single non-zero cell in the 2D day-of-week × hour-of-day activity grid.
 * All timestamps are UTC.
 */
export interface HeatmapCell {
  /** 0 = Sunday, 6 = Saturday (UTC). */
  dayOfWeek: number
  /** 0–23 UTC. */
  hour: number
  /** Number of behavioral events that occurred in this slot. */
  count: number
}

/**
 * Logical 2D activity heatmap over all behavioral events.
 * Cells are sparse — only non-zero cells are included.
 * All time values are UTC; peak hours may be offset from local league prime time.
 */
export interface PlatformActivityHeatmap {
  /** Sparse cells (dayOfWeek × hour), only populated where count > 0. */
  cells: HeatmapCell[]
  /** Key of the busiest cell: "${dayOfWeek}-${hour}", e.g. "2-19". Null when no events. */
  peakCellKey: string | null
  /** Day-of-week of the peak cell (0–6). Null when no events. */
  peakDayOfWeek: number | null
  /** Hour-of-day (UTC) of the peak cell (0–23). Null when no events. */
  peakHour: number | null
  /** Event count of the peak cell. 0 when no events. */
  peakCount: number
  /** Total number of events that contributed to the heatmap. */
  totalEventsAnalyzed: number
  warnings: string[]
}

// ── Engagement trends ─────────────────────────────────────────────────────────

/**
 * Recency-based platform momentum signal derived from event timestamps.
 *
 * This is a RECENCY PROXY, not a true historical trend. Without time-series snapshots,
 * direction-of-change cannot be precisely established. Calibrate trust via `trendConfidence`.
 */
export interface PlatformEngagementTrends {
  /** Events with occurredAt >= now − 7 days. */
  sevenDayEventCount: number
  /** Events with occurredAt >= now − 30 days. */
  thirtyDayEventCount: number
  /** sevenDayEventCount / totalEvents. Null when no events in input. */
  recentActivityRatio: number | null
  /** Percent of managers with at least one event in last 7 days. Null when no managers. */
  recentlyActiveManagerPercent: number | null
  /** Qualitative platform momentum derived from recentActivityRatio. */
  momentumSignal: PlatformMomentumSignal
  /** How much to trust the trend signal (driven by event count + league count). */
  trendConfidence: PlatformTrendConfidence
  warnings: string[]
}

// ── Intervention opportunity ──────────────────────────────────────────────────

/**
 * A single deterministic, prioritised platform-level intervention opportunity.
 * Messages are customer-facing with no internal terminology.
 * `leagueId` and optional `managerId` provide routing context.
 */
export interface PlatformInterventionOpportunity {
  /** Stable ID for deduplication. */
  opportunityId: string
  scope: InterventionScope
  priority: PlatformInterventionPriority
  leagueId: string
  /** Populated for manager-scoped opportunities. */
  managerId?: string
  /** Machine-readable trigger signal. */
  signal: string
  /** Customer-facing action guidance. No internal terminology. */
  message: string
}

// ── Provenance ────────────────────────────────────────────────────────────────

export interface PlatformIntelligenceProvenance {
  leagueIntelligenceCount: number
  managerIntelligenceCount: number
  eventCount: number
  /**
   * Common lookback window across all leagues.
   * Null when leagues disagree on lookbackDays (mixed windows reduce cross-league reliability).
   * When all non-null values are the same, set to that value. Otherwise, set to the average.
   */
  avgLeagueLookbackDays: number | null
  derivedAt: string
}

// ── Platform Behavioral Intelligence ─────────────────────────────────────────

/**
 * Deterministic platform-wide intelligence aggregated from Phase 5.2 and 5.3 outputs.
 *
 * Phase 5.4 — read-only, shadow-only. Not wired to any production route.
 * No customer-specific logic — all scoring rules are generic across deployments.
 */
export interface PlatformBehavioralIntelligence {
  // ── Top-level engagement ────────────────────────────────────────────────
  /** Average of all league engagement scores (0–100). */
  platformEngagementScore: number
  /** Qualitative tier derived from score and league health distribution. */
  platformEngagementTier: PlatformEngagementTier

  // ── Distributions ───────────────────────────────────────────────────────
  leagueHealthDistribution: LeagueHealthDistribution
  retentionDistribution: PlatformRetentionDistribution
  commissionerQualityDistribution: CommissionerQualityDistribution

  // ── Ecosystem health ────────────────────────────────────────────────────
  tradeEcosystem: PlatformEcosystemDimension
  waiverEcosystem: PlatformEcosystemDimension
  draftParticipation: PlatformEcosystemDimension

  // ── Temporal signals ────────────────────────────────────────────────────
  engagementTrends: PlatformEngagementTrends
  activityHeatmap: PlatformActivityHeatmap

  // ── Actionable interventions ────────────────────────────────────────────
  /** Prioritised list of leagues/managers needing platform attention. Capped at 20. */
  interventionOpportunities: PlatformInterventionOpportunity[]

  // ── Data quality ────────────────────────────────────────────────────────
  completeness: number
  uncertainty: PlatformUncertaintyLevel
  warnings: string[]

  // ── Provenance ──────────────────────────────────────────────────────────
  provenance: PlatformIntelligenceProvenance
  derivedAt: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const INTERVENTION_CAP = 20
const CRITICAL_MANAGER_CAP = 5

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.round((numerator / denominator) * 100)
}

function rate2(count: number, total: number): number {
  if (total === 0) return 0
  return Math.round((count / total) * 100) / 100
}

function ecosystemTier(
  activeLeaguePercent: number,
): 'high' | 'moderate' | 'low' | 'none' {
  if (activeLeaguePercent >= 80) return 'high'
  if (activeLeaguePercent >= 50) return 'moderate'
  if (activeLeaguePercent > 0)   return 'low'
  return 'none'
}

function buildLeagueHealthDistribution(
  leagues: LeagueBehavioralIntelligence[],
): LeagueHealthDistribution {
  const counts = { elite: 0, active: 0, moderate: 0, passive: 0, dormant: 0 }
  for (const l of leagues) counts[l.leagueEngagementTier]++
  const total = leagues.length
  return {
    ...counts,
    totalLeagues:   total,
    healthyPercent: pct(counts.elite + counts.active,    total),
    atRiskPercent:  pct(counts.passive + counts.dormant, total),
  }
}

function buildCommissionerQualityDistribution(
  leagues: LeagueBehavioralIntelligence[],
): CommissionerQualityDistribution {
  const counts = { light: 0, moderate: 0, heavy: 0, critical: 0 }
  for (const l of leagues) counts[l.commissionerWorkload]++
  const total = leagues.length
  return {
    ...counts,
    totalLeagues:      total,
    managedPercent:    pct(counts.light + counts.moderate, total),
    overloadedPercent: pct(counts.heavy + counts.critical, total),
  }
}

function buildRetentionDistribution(
  leagues: LeagueBehavioralIntelligence[],
  managers: ManagerBehavioralIntelligence[],
): PlatformRetentionDistribution {
  // Phase 36: insufficient_data is a coverage gap, not a risk tier — it is
  // counted separately and never inflates the critical/high buckets.
  const mc = { critical: 0, high: 0, medium: 0, low: 0, insufficient_data: 0 }
  for (const m of managers) mc[m.retentionRisk]++
  const tm = managers.length

  const lc = { critical: 0, high: 0, medium: 0, low: 0, insufficient_data: 0 }
  for (const l of leagues) lc[l.retentionRisk]++
  const tl = leagues.length

  return {
    managersByCriticalRisk:     mc.critical,
    managersByHighRisk:         mc.high,
    managersByMediumRisk:       mc.medium,
    managersByLowRisk:          mc.low,
    totalManagers:              tm,
    managerCriticalRiskPercent: pct(mc.critical, tm),
    managerAtRiskPercent:       pct(mc.critical + mc.high, tm),

    leaguesByCriticalRisk:      lc.critical,
    leaguesByHighRisk:          lc.high,
    leaguesByMediumRisk:        lc.medium,
    leaguesByLowRisk:           lc.low,
    totalLeagues:               tl,
    leagueCriticalRiskPercent:  pct(lc.critical, tl),
    leagueAtRiskPercent:        pct(lc.critical + lc.high, tl),
  }
}

/**
 * Build a platform-wide ecosystem dimension from a dimension accessor.
 * Using a getter lambda keeps this type-safe regardless of the field name
 * used on the league intelligence (e.g., `draftActivity` vs `draftParticipation`).
 */
function buildEcosystemDimension(
  leagues: LeagueBehavioralIntelligence[],
  totalManagers: number,
  getDim: (l: LeagueBehavioralIntelligence) => { tier: 'high' | 'moderate' | 'low' | 'none'; count: number },
  noActivityWarning: string,
): PlatformEcosystemDimension {
  const total = leagues.length
  let totalEvents = 0
  let activeLeagues = 0
  for (const l of leagues) {
    const dim = getDim(l)
    totalEvents  += dim.count
    if (dim.tier !== 'none') activeLeagues++
  }
  const activeLeaguePercent = pct(activeLeagues, total)
  const warnings: string[] = []
  if (totalEvents === 0 && total > 0) warnings.push(noActivityWarning)
  return {
    tier: ecosystemTier(activeLeaguePercent),
    totalEvents,
    activeLeagues,
    totalLeagues:         total,
    activeLeaguePercent,
    perLeagueRate:  rate2(totalEvents, total),
    perManagerRate: rate2(totalEvents, totalManagers),
    warnings,
  }
}

function buildActivityHeatmap(events: BehavioralEvent[]): PlatformActivityHeatmap {
  if (events.length === 0) {
    return {
      cells: [],
      peakCellKey:         null,
      peakDayOfWeek:       null,
      peakHour:            null,
      peakCount:           0,
      totalEventsAnalyzed: 0,
      warnings:            [],
    }
  }

  const grid = new Map<string, number>()
  for (const e of events) {
    const d   = new Date(e.occurredAt)
    const key = `${d.getUTCDay()}-${d.getUTCHours()}`
    grid.set(key, (grid.get(key) ?? 0) + 1)
  }

  let peakKey   = ''
  let peakCount = 0
  for (const [k, v] of grid.entries()) {
    if (v > peakCount) { peakCount = v; peakKey = k }
  }

  const cells: HeatmapCell[] = []
  for (const [k, count] of grid.entries()) {
    const [dayStr, hrStr] = k.split('-')
    cells.push({ dayOfWeek: Number(dayStr), hour: Number(hrStr), count })
  }
  cells.sort((a, b) => (a.dayOfWeek * 24 + a.hour) - (b.dayOfWeek * 24 + b.hour))

  const [peakDayStr, peakHrStr] = peakKey.split('-')

  return {
    cells,
    peakCellKey:         peakKey,
    peakDayOfWeek:       Number(peakDayStr),
    peakHour:            Number(peakHrStr),
    peakCount,
    totalEventsAnalyzed: events.length,
    warnings:            ['activity_heatmap_uses_utc'],
  }
}

function buildEngagementTrends(
  events: BehavioralEvent[],
  managers: ManagerBehavioralIntelligence[],
  now: Date,
): Omit<PlatformEngagementTrends, 'trendConfidence'> {
  const total        = events.length
  const totalManagers = managers.length

  if (total === 0) {
    return {
      sevenDayEventCount:           0,
      thirtyDayEventCount:          0,
      recentActivityRatio:          null,
      recentlyActiveManagerPercent: totalManagers > 0 ? 0 : null,
      momentumSignal:               'insufficient_data',
      warnings:                     ['no_events_for_trend_computation'],
    }
  }

  const nowMs = now.getTime()
  const ms7d  =  7 * 86_400_000
  const ms30d = 30 * 86_400_000

  let sevenDay  = 0
  let thirtyDay = 0
  const recentManagerIds = new Set<string>()

  for (const e of events) {
    const age = nowMs - new Date(e.occurredAt).getTime()
    if (age <= ms7d) {
      sevenDay++
      if (e.managerId) recentManagerIds.add(e.managerId)
    }
    if (age <= ms30d) thirtyDay++
  }

  const ratio = Math.round((sevenDay / total) * 100) / 100

  const momentumSignal: PlatformMomentumSignal = (() => {
    if (ratio >= 0.50) return 'accelerating'
    if (ratio >= 0.20) return 'steady'
    if (ratio >  0)    return 'decelerating'
    return 'dormant'
  })()

  return {
    sevenDayEventCount:  sevenDay,
    thirtyDayEventCount: thirtyDay,
    recentActivityRatio: ratio,
    recentlyActiveManagerPercent:
      totalManagers > 0 ? pct(recentManagerIds.size, totalManagers) : null,
    momentumSignal,
    warnings: [],
  }
}

function computeTrendConfidence(
  totalEvents: number,
  totalLeagues: number,
): PlatformTrendConfidence {
  if (totalEvents  === 0)                       return 'insufficient'
  if (totalEvents  <  10 || totalLeagues < 3)   return 'low'
  if (totalEvents  <  50 || totalLeagues < 5)   return 'medium'
  return 'high'
}

function buildInterventions(
  leagues: LeagueBehavioralIntelligence[],
  managers: ManagerBehavioralIntelligence[],
): PlatformInterventionOpportunity[] {
  const opportunities: PlatformInterventionOpportunity[] = []
  const seenLeagues   = new Set<string>()

  const addLeague = (
    l: LeagueBehavioralIntelligence,
    priority: PlatformInterventionPriority,
    signal: string,
    message: string,
  ): void => {
    if (seenLeagues.has(l.leagueId))       return
    if (opportunities.length >= INTERVENTION_CAP) return
    seenLeagues.add(l.leagueId)
    opportunities.push({
      opportunityId: `int_league_${signal}_${l.leagueId}`,
      scope:    'league',
      priority,
      leagueId: l.leagueId,
      signal,
      message,
    })
  }

  // Pass 1: leagues with BOTH critical retention AND critical workload
  for (const l of leagues) {
    if (l.retentionRisk === 'critical' && l.commissionerWorkload === 'critical') {
      addLeague(l, 'critical', 'critical_retention_and_workload',
        'This league has no active managers and the commissioner is overloaded. Immediate outreach is required.')
    }
  }

  // Pass 2: remaining leagues with critical retention only
  for (const l of leagues) {
    if (l.retentionRisk === 'critical') {
      addLeague(l, 'critical', 'critical_retention',
        'This league is at critical retention risk. Manager engagement has collapsed.')
    }
  }

  // Pass 3: critical-risk managers (capped to prevent explosion)
  let critManagerCount = 0
  for (const m of managers) {
    if (m.retentionRisk !== 'critical')            continue
    if (critManagerCount >= CRITICAL_MANAGER_CAP)  break
    if (opportunities.length >= INTERVENTION_CAP)  break
    opportunities.push({
      opportunityId: `int_manager_critical_retention_${m.managerId}_${m.leagueId}`,
      scope:     'manager',
      priority:  'critical',
      leagueId:  m.leagueId,
      managerId: m.managerId,
      signal:    'critical_manager_retention',
      message:   'This manager is at critical risk of abandoning the league. Direct outreach is recommended.',
    })
    critManagerCount++
  }

  // Pass 4: leagues with critical workload not already listed
  for (const l of leagues) {
    if (l.commissionerWorkload === 'critical') {
      addLeague(l, 'critical', 'critical_workload',
        'The commissioner of this league is overloaded and may be unable to manage league operations effectively.')
    }
  }

  // Pass 5: leagues with high retention risk
  for (const l of leagues) {
    if (l.retentionRisk === 'high') {
      addLeague(l, 'high', 'high_retention',
        'This league has elevated retention risk. Several managers are at risk of disengaging.')
    }
  }

  // Pass 6: leagues with heavy workload
  for (const l of leagues) {
    if (l.commissionerWorkload === 'heavy') {
      addLeague(l, 'high', 'heavy_workload',
        'The commissioner of this league is managing a heavy workload. Consider offering support.')
    }
  }

  return opportunities
}

function computeUncertainty(
  completeness: number,
  totalLeagues: number,
): PlatformUncertaintyLevel {
  if (completeness < 20 || totalLeagues === 0) return 'very_high'
  if (completeness < 40 || totalLeagues < 3)   return 'high'
  if (completeness < 70 || totalLeagues < 5)   return 'medium'
  return 'low'
}

function computeProvenance(
  leagues: LeagueBehavioralIntelligence[],
  managers: ManagerBehavioralIntelligence[],
  events: BehavioralEvent[],
  derivedAt: string,
): PlatformIntelligenceProvenance {
  const nonNullLookbacks = leagues
    .map((l) => l.lookbackDays)
    .filter((d): d is number => d !== null)
  const unique = new Set(nonNullLookbacks)
  const avgLeagueLookbackDays =
    unique.size === 1   ? [...unique][0] :
    nonNullLookbacks.length > 0
      ? Math.round(nonNullLookbacks.reduce((a, b) => a + b, 0) / nonNullLookbacks.length)
      : null

  return {
    leagueIntelligenceCount:  leagues.length,
    managerIntelligenceCount: managers.length,
    eventCount:               events.length,
    avgLeagueLookbackDays,
    derivedAt,
  }
}

// ── Main assembler ────────────────────────────────────────────────────────────

/**
 * Derive behavioral intelligence for the entire platform from Phase 5.2 and 5.3
 * outputs plus the raw behavioral event stream.
 *
 * Pure and referentially transparent given a fixed `now`. Input arrays are never mutated.
 *
 * @param leagueIntelligences  One entry per league (Phase 5.3 output).
 * @param managerIntelligences One entry per manager per league (Phase 5.2 output).
 * @param events               Raw behavioral events (Phase 5.0 discriminated union).
 *                             May span multiple leagues. Not mutated.
 * @param now                  Reference time. Pass a fixed Date in tests for determinism.
 */
export function derivePlatformBehavioralIntelligence(
  leagueIntelligences: LeagueBehavioralIntelligence[],
  managerIntelligences: ManagerBehavioralIntelligence[],
  events: BehavioralEvent[],
  now: Date = new Date(),
): PlatformBehavioralIntelligence {
  const derivedAt     = now.toISOString()
  const totalLeagues  = leagueIntelligences.length
  const totalManagers = managerIntelligences.length
  const totalEvents   = events.length

  // ── Platform engagement score ─────────────────────────────────────────────
  const platformEngagementScore = totalLeagues > 0
    ? Math.round(
        leagueIntelligences.reduce((sum, l) => sum + l.leagueEngagementScore, 0) / totalLeagues,
      )
    : 0

  // ── League health distribution ────────────────────────────────────────────
  const leagueHealthDistribution = buildLeagueHealthDistribution(leagueIntelligences)
  const { healthyPercent } = leagueHealthDistribution

  // ── Platform engagement tier ──────────────────────────────────────────────
  const platformEngagementTier: PlatformEngagementTier = (() => {
    if (totalLeagues === 0 || platformEngagementScore === 0) return 'inactive'
    if (platformEngagementScore >= 70 && healthyPercent >= 70) return 'thriving'
    if (platformEngagementScore >= 50 && healthyPercent >= 50) return 'healthy'
    if (platformEngagementScore >= 30 && healthyPercent >= 30) return 'moderate'
    return 'struggling'
  })()

  // ── Commissioner quality distribution ─────────────────────────────────────
  const commissionerQualityDistribution = buildCommissionerQualityDistribution(leagueIntelligences)

  // ── Retention distribution ────────────────────────────────────────────────
  const retentionDistribution = buildRetentionDistribution(leagueIntelligences, managerIntelligences)

  // ── Ecosystem health ──────────────────────────────────────────────────────
  const tradeEcosystem = buildEcosystemDimension(
    leagueIntelligences, totalManagers,
    (l) => l.tradeActivity,
    'no_trade_ecosystem_events',
  )
  const waiverEcosystem = buildEcosystemDimension(
    leagueIntelligences, totalManagers,
    (l) => l.waiverActivity,
    'no_waiver_ecosystem_events',
  )
  const draftParticipation = buildEcosystemDimension(
    leagueIntelligences, totalManagers,
    (l) => l.draftActivity,
    'no_draft_participation_events',
  )

  // ── Activity heatmap ──────────────────────────────────────────────────────
  const activityHeatmap = buildActivityHeatmap(events)

  // ── Engagement trends ─────────────────────────────────────────────────────
  const trendsBase      = buildEngagementTrends(events, managerIntelligences, now)
  const trendConfidence = computeTrendConfidence(totalEvents, totalLeagues)
  const engagementTrends: PlatformEngagementTrends = { ...trendsBase, trendConfidence }

  // ── Interventions ─────────────────────────────────────────────────────────
  const interventionOpportunities = buildInterventions(leagueIntelligences, managerIntelligences)

  // ── Completeness & uncertainty ────────────────────────────────────────────
  const completeness = totalLeagues > 0
    ? Math.round(
        leagueIntelligences.reduce((sum, l) => sum + l.completeness, 0) / totalLeagues,
      )
    : 0
  const uncertainty = computeUncertainty(completeness, totalLeagues)

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings: string[] = []
  if (totalLeagues  === 0)  warnings.push('no_league_intelligences_provided')
  if (totalManagers === 0)  warnings.push('no_manager_intelligences_provided')
  if (totalEvents   === 0)  warnings.push('no_events_provided')
  if (totalLeagues  === 1)  warnings.push('single_league_sample')
  if (retentionDistribution.managerCriticalRiskPercent > 20)
                            warnings.push('high_platform_retention_risk')
  if (commissionerQualityDistribution.overloadedPercent > 30)
                            warnings.push('commissioner_overload_detected')
  if (completeness > 0 && completeness < 50)
                            warnings.push('low_platform_completeness')

  // ── Provenance ────────────────────────────────────────────────────────────
  const provenance = computeProvenance(leagueIntelligences, managerIntelligences, events, derivedAt)

  return {
    platformEngagementScore,
    platformEngagementTier,
    leagueHealthDistribution,
    retentionDistribution,
    commissionerQualityDistribution,
    tradeEcosystem,
    waiverEcosystem,
    draftParticipation,
    engagementTrends,
    activityHeatmap,
    interventionOpportunities,
    completeness,
    uncertainty,
    warnings,
    provenance,
    derivedAt,
  }
}
