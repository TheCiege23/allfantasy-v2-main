/**
 * Decision OS — Phase 5.3 League Behavioral Intelligence.
 *
 * Pure derived intelligence layer aggregating ManagerBehavioralIntelligence[] +
 * LeagueBehavioralFacts into a single league-scope intelligence object.
 *
 * Architecture constraints (ADR_F5_3_LEAGUE_BEHAVIORAL_INTELLIGENCE.md):
 *   - Read-only / pure: no writes, no IO, no mutations of inputs
 *   - No UI, no AI summaries, no cutover wiring
 *   - No Stage 1 soak slice modification
 *   - Deterministic: same inputs → same output (clock injected via `now` param)
 *   - No fabrication (P2): scores degrade to 0/null when data is absent
 *   - No AI generation (P3): healthNarrativeInputs are structured strings, not LLM-generated
 *
 * Pipeline: LeagueBehavioralFacts + ManagerBehavioralIntelligence[] → LeagueBehavioralIntelligence
 */

import type { LeagueBehavioralFacts } from './facts'
import type { ManagerBehavioralIntelligence } from './manager-intelligence'
import { deriveImportDataQuality, type ImportDataQuality, type ImportSignalsInput } from './import-signals'

// ── League engagement tier ────────────────────────────────────────────────────

/**
 * Overall engagement classification for the league, based on participation breadth
 * and average manager engagement depth.
 */
export type LeagueEngagementTier = 'elite' | 'active' | 'moderate' | 'passive' | 'dormant'

// ── Activity tier ─────────────────────────────────────────────────────────────

/** How active the league is in a specific transaction dimension (trade / waiver / draft). */
export type ActivityTier = 'high' | 'moderate' | 'low' | 'none'

// ── League retention risk ─────────────────────────────────────────────────────

/** Estimated league-level retention risk based on inactive manager distribution. */
export type LeagueRetentionRisk = 'low' | 'medium' | 'high' | 'critical'

// ── Commissioner workload ─────────────────────────────────────────────────────

/** How much active commissioner intervention this league currently requires. */
export type CommissionerWorkloadLevel = 'light' | 'moderate' | 'heavy' | 'critical'

// ── Manager participation distribution ───────────────────────────────────────

/** Breakdown of active vs inactive managers in the league. */
export interface ManagerParticipationDistribution {
  /** Total number of managers in the league (equals `managerIntelligences.length`). */
  totalManagers: number
  /** Managers who are NOT currently inactive (`isInactive === false`). */
  activeManagers: number
  /** Managers who ARE currently inactive (`isInactive === true`). */
  inactiveManagers: number
  /** Percentage of managers who are active (0–100, rounded). */
  activePercent: number
  /** Percentage of managers who are inactive (0–100, rounded). */
  inactivePercent: number
}

// ── League activity dimension ─────────────────────────────────────────────────

/**
 * Transaction or draft activity signal for the league.
 * Per-manager rate is the primary signal — raw totals alone are misleading in leagues
 * of different sizes.
 */
export interface LeagueActivityDimension {
  /** Qualitative tier derived from per-manager rate. */
  tier: ActivityTier
  /** Raw event count across all managers. */
  count: number
  /** count / totalManagers, rounded to 2 decimal places. 0 when totalManagers = 0. */
  perManagerRate: number
  /** Soft warnings for this dimension. */
  warnings: string[]
}

// ── Commissioner recommendation ───────────────────────────────────────────────

export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low'
export type RecommendationCategory = 'retention' | 'engagement' | 'activity' | 'moderation'

/**
 * A deterministic, prioritised, customer-facing commissioner action item.
 * No internal terminology in `message`.
 */
export interface LeagueCommissionerRecommendation {
  /** Deterministic ID for this recommendation type. */
  recommendationId: string
  priority: RecommendationPriority
  category: RecommendationCategory
  /** Machine-readable signal that triggered this recommendation. */
  signal: string
  /** Customer-facing message for the commissioner. No internal terminology. */
  message: string
}

// ── Health narrative inputs ───────────────────────────────────────────────────

/**
 * Structured inputs for a future commissioner-facing health narrative.
 * These are deterministic strings derived from intelligence signals, NOT AI-generated.
 * A future Phase 5.4 layer may pass them to Claude to produce a human-readable summary.
 */
export interface LeagueHealthNarrativeInputs {
  /** Structured summary of manager participation. */
  engagementSummary: string
  /** Most urgent signal for the commissioner to address. Null when no concerns. */
  topConcern: string | null
  /** Most positive signal to highlight. Null when no standout signals. */
  standoutSignal: string | null
}

// ── League Behavioral Intelligence ───────────────────────────────────────────

/**
 * Derived behavioral intelligence for an entire league.
 * Aggregates per-manager intelligence (Phase 5.2) with league-level facts (Phase 5.1).
 *
 * Phase 5.3 — read-only, shadow-only. Not surfaced in production routes.
 */
export interface LeagueBehavioralIntelligence {
  leagueId: string

  // ── Top-level engagement ──────────────────────────────────────────────────

  /**
   * Composite engagement score (0–100).
   * Weights: participation breadth 50 %, average manager depth 50 %.
   */
  leagueEngagementScore: number
  /** Qualitative tier derived from score + participation breadth. */
  leagueEngagementTier: LeagueEngagementTier

  // ── Participation distribution ────────────────────────────────────────────

  /** Full breakdown of active vs inactive managers. */
  participationDistribution: ManagerParticipationDistribution
  /** Shorthand: number of managers where `isInactive === true`. */
  inactiveManagerCount: number

  // ── Activity dimensions ───────────────────────────────────────────────────

  tradeActivity: LeagueActivityDimension
  waiverActivity: LeagueActivityDimension
  draftActivity: LeagueActivityDimension

  // ── Retention risk ────────────────────────────────────────────────────────

  /** League-level retention risk based on inactive distribution and per-manager risks. */
  retentionRisk: LeagueRetentionRisk
  /** Human-readable reasons driving the retention risk level. */
  retentionRiskReasons: string[]

  // ── Commissioner workload ─────────────────────────────────────────────────

  /** Level of active commissioner intervention this league requires. */
  commissionerWorkload: CommissionerWorkloadLevel
  /** Specific items driving the workload level. Empty when workload is light. */
  commissionerWorkloadItems: string[]

  // ── Recommended actions ───────────────────────────────────────────────────

  /** Prioritised list of deterministic commissioner recommendations. May be empty. */
  recommendations: LeagueCommissionerRecommendation[]

  // ── Health narrative inputs ───────────────────────────────────────────────

  /**
   * Structured strings for a future AI narrative call.
   * NOT AI-generated — these are the input signals, not the output narrative.
   */
  healthNarrativeInputs: LeagueHealthNarrativeInputs

  // ── Data quality ──────────────────────────────────────────────────────────

  /** Inherited completeness from LeagueBehavioralFacts (0–100). */
  completeness: number
  /** Total events that fed the underlying facts. */
  derivedFrom: number
  /** Total managers in the league (equals `managerIntelligences.length`). */
  managerCount: number
  /** Lookback window used when assembling the facts. Null = all available history. */
  lookbackDays: number | null
  /** Warnings from facts plus league-level gap signals. */
  warnings: string[]
  /** ISO 8601 timestamp of when this intelligence was derived. */
  derivedAt: string
  /**
   * Phase 5.2 wire-up B — import provenance / data-quality signal derived from
   * the persisted `ImportRun` + `ImportWarning` pipeline (Sleeper). Absent for
   * leagues with no completed Sleeper import — the honest empty state. When
   * present, consumers can surface "some imported data is incomplete" instead
   * of implying perfect state. Additive: consumers that don't destructure it
   * are unaffected.
   */
  dataQuality?: ImportDataQuality
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function activityTierForTrade(perManagerRate: number): ActivityTier {
  if (perManagerRate >= 2) return 'high'
  if (perManagerRate >= 0.5) return 'moderate'
  if (perManagerRate > 0) return 'low'
  return 'none'
}

function activityTierForWaiver(perManagerRate: number): ActivityTier {
  if (perManagerRate >= 3) return 'high'
  if (perManagerRate >= 1) return 'moderate'
  if (perManagerRate > 0) return 'low'
  return 'none'
}

function activityTierForDraft(perManagerRate: number): ActivityTier {
  if (perManagerRate >= 5) return 'high'
  if (perManagerRate >= 1) return 'moderate'
  if (perManagerRate > 0) return 'low'
  return 'none'
}

function roundRate(count: number, total: number): number {
  if (total === 0) return 0
  return Math.round((count / total) * 100) / 100
}

// ── Main assembler ────────────────────────────────────────────────────────────

/**
 * Derive behavioral intelligence for an entire league from assembled facts and
 * the array of per-manager intelligences already computed by Phase 5.2.
 *
 * The function is pure and referentially transparent given a fixed `now`.
 *
 * @param facts               League-level behavioral facts (Phase 5.1 assembler output).
 * @param managerIntelligences Per-manager behavioral intelligences (Phase 5.2 output).
 *                             Should include one entry per league member, including members
 *                             with zero events (they contribute an inactive/zero-score entry).
 *                             Not mutated.
 * @param now                 Reference time. Defaults to `new Date()`. Pass a fixed Date
 *                            in tests to ensure determinism.
 */
export function deriveLeagueBehavioralIntelligence(
  facts: LeagueBehavioralFacts,
  managerIntelligences: ManagerBehavioralIntelligence[],
  now: Date = new Date(),
  /**
   * Phase 5.2 wire-up B — optional import signals from the persisted `ImportRun`
   * + `ImportWarning` pipeline. Backward-compatible: undefined = no signal
   * (the intelligence's `dataQuality` field will be absent).
   */
  importSignals: ImportSignalsInput | null = null,
): LeagueBehavioralIntelligence {
  const totalManagers = managerIntelligences.length

  // ── Participation distribution ────────────────────────────────────────────
  const inactiveManagers = managerIntelligences.filter((m) => m.isInactive).length
  const activeManagers = totalManagers - inactiveManagers
  const activePercent = totalManagers > 0
    ? Math.round((activeManagers / totalManagers) * 100)
    : 0
  const inactivePercent = totalManagers > 0 ? 100 - activePercent : 0

  const participationDistribution: ManagerParticipationDistribution = {
    totalManagers,
    activeManagers,
    inactiveManagers,
    activePercent,
    inactivePercent,
  }

  // ── Average manager engagement (over ALL managers; inactive contribute 0) ──
  const avgManagerEngagement = totalManagers > 0
    ? Math.round(
        managerIntelligences.reduce((sum, m) => sum + m.overallEngagementScore, 0) / totalManagers,
      )
    : 0

  // ── League engagement score ───────────────────────────────────────────────
  const leagueEngagementScore = Math.min(
    100,
    Math.round(activePercent * 0.5 + avgManagerEngagement * 0.5),
  )

  // ── League engagement tier ────────────────────────────────────────────────
  const leagueEngagementTier: LeagueEngagementTier = (() => {
    if (totalManagers === 0 || leagueEngagementScore === 0) return 'dormant'
    if (leagueEngagementScore >= 70 && activePercent >= 80) return 'elite'
    if (leagueEngagementScore >= 50 && activePercent >= 60) return 'active'
    if (leagueEngagementScore >= 30 && activePercent >= 40) return 'moderate'
    if (leagueEngagementScore > 0) return 'passive'
    return 'dormant'
  })()

  // ── Activity dimensions ───────────────────────────────────────────────────
  const tradeRate  = roundRate(facts.totalTradeCount,       totalManagers)
  const waiverRate = roundRate(facts.totalWaiverClaimCount, totalManagers)
  const draftRate  = roundRate(facts.totalDraftPickCount,   totalManagers)

  const tradeActivity: LeagueActivityDimension = {
    tier: activityTierForTrade(tradeRate),
    count: facts.totalTradeCount,
    perManagerRate: tradeRate,
    warnings: facts.totalTradeCount === 0 && activeManagers > 0 ? ['no_trade_activity'] : [],
  }

  const waiverActivity: LeagueActivityDimension = {
    tier: activityTierForWaiver(waiverRate),
    count: facts.totalWaiverClaimCount,
    perManagerRate: waiverRate,
    warnings:
      facts.totalWaiverClaimCount === 0 && activeManagers > 0 ? ['no_waiver_activity'] : [],
  }

  const draftActivity: LeagueActivityDimension = {
    tier: activityTierForDraft(draftRate),
    count: facts.totalDraftPickCount,
    perManagerRate: draftRate,
    warnings: facts.draftCount === 0 && totalManagers > 0 ? ['no_draft_recorded'] : [],
  }

  // ── Retention risk ────────────────────────────────────────────────────────
  const criticalRiskManagers = managerIntelligences.filter(
    (m) => m.retentionRisk === 'critical',
  ).length
  const highRiskManagers = managerIntelligences.filter(
    (m) => m.retentionRisk === 'high',
  ).length

  const retentionRiskReasons: string[] = []
  const retentionRisk: LeagueRetentionRisk = (() => {
    if (totalManagers === 0 || activeManagers === 0) {
      retentionRiskReasons.push('No managers have recorded any activity')
      return 'critical'
    }
    if (inactivePercent > 50) {
      retentionRiskReasons.push(
        `${inactiveManagers} of ${totalManagers} managers are inactive`,
      )
      return 'critical'
    }
    if (criticalRiskManagers > 0) {
      retentionRiskReasons.push(
        `${criticalRiskManagers} manager(s) at critical retention risk`,
      )
    }
    if (inactivePercent > 30) {
      retentionRiskReasons.push(
        `${inactivePercent}% of managers are inactive`,
      )
    }
    if (retentionRiskReasons.length > 0) return 'high'

    if (highRiskManagers > 0) {
      retentionRiskReasons.push(
        `${highRiskManagers} manager(s) need engagement attention`,
      )
      return 'medium'
    }
    if (inactivePercent > 10) {
      retentionRiskReasons.push(`${inactivePercent}% of managers are inactive`)
      return 'medium'
    }
    return 'low'
  })()

  // ── Commissioner workload ─────────────────────────────────────────────────
  const workloadItems: string[] = []
  if (inactiveManagers > 0) {
    workloadItems.push(`${inactiveManagers} inactive manager(s) need outreach`)
  }
  if (criticalRiskManagers > 0) {
    workloadItems.push(`${criticalRiskManagers} manager(s) at critical retention risk`)
  }
  if (highRiskManagers > criticalRiskManagers) {
    workloadItems.push(
      `${highRiskManagers - criticalRiskManagers} manager(s) at high retention risk`,
    )
  }
  if (
    tradeActivity.tier === 'none' &&
    waiverActivity.tier === 'none' &&
    activeManagers > 0
  ) {
    workloadItems.push('League transaction activity is very low')
  }

  const commissionerWorkload: CommissionerWorkloadLevel = (() => {
    if (workloadItems.length >= 3 || inactivePercent > 50) return 'critical'
    if (workloadItems.length >= 2 || inactivePercent > 30) return 'heavy'
    if (workloadItems.length >= 1) return 'moderate'
    return 'light'
  })()

  // ── Recommendations (pushed in priority order: critical → high → medium → low) ──
  const recommendations: LeagueCommissionerRecommendation[] = []

  if (criticalRiskManagers > 0) {
    recommendations.push({
      recommendationId: 'rec_follow_up_critical_risk',
      priority: 'critical',
      category: 'retention',
      signal: 'critical_risk_managers',
      message: `${criticalRiskManagers} manager(s) are at critical risk of abandoning the league. Direct outreach is recommended immediately.`,
    })
  }

  if (inactiveManagers > 0) {
    recommendations.push({
      recommendationId: 'rec_contact_inactive_managers',
      priority: inactivePercent > 30 ? 'critical' : 'high',
      category: 'retention',
      signal: 'inactive_managers_present',
      message: `${inactiveManagers} manager(s) have not been active recently. Reach out to re-engage them before they abandon the league.`,
    })
  }

  if (tradeActivity.tier === 'none' && activeManagers >= 4) {
    recommendations.push({
      recommendationId: 'rec_spark_trade_activity',
      priority: 'medium',
      category: 'activity',
      signal: 'no_trade_activity',
      message:
        'No trades have been made this season. Consider hosting a trade block or starting a league chat topic to spark activity.',
    })
  }

  if (waiverActivity.tier === 'none' && activeManagers >= 4) {
    recommendations.push({
      recommendationId: 'rec_announce_waiver_wire',
      priority: 'medium',
      category: 'engagement',
      signal: 'no_waiver_activity',
      message:
        'No waiver claims have been made. Post a waiver wire recap to show managers what is available.',
    })
  }

  if (activeManagers > 0) {
    recommendations.push({
      recommendationId: 'rec_post_weekly_recap',
      priority: 'low',
      category: 'engagement',
      signal: 'active_managers_present',
      message: 'Post a weekly recap to highlight top performances and keep managers engaged.',
    })
  }

  // ── Health narrative inputs ───────────────────────────────────────────────
  const engagementSummary =
    totalManagers > 0
      ? `${activeManagers} of ${totalManagers} managers are active`
      : 'No manager data available'

  const topConcern: string | null = (() => {
    if (totalManagers === 0 || activeManagers === 0) {
      return 'No managers have recorded any activity'
    }
    if (inactivePercent > 50) {
      return `${inactiveManagers} of ${totalManagers} managers are inactive`
    }
    if (criticalRiskManagers > 0) {
      return `${criticalRiskManagers} manager(s) at critical retention risk`
    }
    if (inactiveManagers > 0) {
      return `${inactiveManagers} manager(s) need engagement`
    }
    return null
  })()

  const standoutSignal: string | null = (() => {
    if (leagueEngagementTier === 'elite') {
      return 'League is highly engaged across all activity types'
    }
    if (leagueEngagementTier === 'active') {
      return 'Strong manager participation this season'
    }
    if (tradeActivity.tier === 'high') {
      return 'High trade activity indicates strong manager investment'
    }
    if (waiverActivity.tier === 'high') {
      return 'Managers are actively working the waiver wire'
    }
    return null
  })()

  const healthNarrativeInputs: LeagueHealthNarrativeInputs = {
    engagementSummary,
    topConcern,
    standoutSignal,
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings: string[] = [...facts.warnings]
  if (totalManagers === 0) warnings.push('no_manager_intelligences_provided')
  if (inactiveManagers > 0) warnings.push(`inactive_managers_present`)
  if (tradeActivity.tier === 'none' && activeManagers > 0) warnings.push('no_trade_activity')
  if (waiverActivity.tier === 'none' && activeManagers > 0) warnings.push('no_waiver_activity')
  if (draftActivity.tier === 'none') warnings.push('no_draft_activity')

  return {
    leagueId: facts.leagueId,
    leagueEngagementScore,
    leagueEngagementTier,
    participationDistribution,
    inactiveManagerCount: inactiveManagers,
    tradeActivity,
    waiverActivity,
    draftActivity,
    retentionRisk,
    retentionRiskReasons,
    commissionerWorkload,
    commissionerWorkloadItems: workloadItems,
    recommendations,
    healthNarrativeInputs,
    completeness: facts.completeness,
    derivedFrom: facts.eventCount,
    managerCount: totalManagers,
    lookbackDays: facts.lookbackDays,
    warnings,
    derivedAt: now.toISOString(),
    // Phase 5.2 wire-up B — surface the import-provenance signal when the
    // resolver populated one. Absent when the league has no completed import.
    dataQuality: deriveImportDataQuality(importSignals),
  }
}
