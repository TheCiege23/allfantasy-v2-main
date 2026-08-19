/**
 * Decision OS — Rule Modules for `commissioner.league.health` (Slice 4).
 *
 * READ-ONLY, RETURN-STYLE. Health is an ASSESSMENT, not a legality gate — so these rules map the
 * deterministic snapshot's thresholds into `RuleVerdict`s (commissioner attention items), never
 * `illegal`, never throwing, never executing or creating commissioner actions. Pure. The risk scores
 * are DERIVED from the snapshot's exposed deterministic fields (the canonical snapshot drops them) —
 * never recomputed independently from raw league data.
 */
import type { RuleVerdict, VerdictSeverity } from '@/lib/decision-os/core/decision'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'

export type CommissionerHealthCategory =
  | 'league_health_critical'
  | 'engagement_low'
  | 'fairness_low'
  | 'sustainability_low'
  | 'churn_risk_high'
  | 'dispute_risk_high'
  | 'abandonment_risk_high'
  | 'inactive_managers'
  | 'abandoned_teams'
  | 'unresolved_disputes'
  | 'missed_lineups'
  | 'injured_starters'
  | 'low_data_confidence'

export interface CommissionerRiskScores {
  churnRiskScore: number
  disputeRiskScore: number
  abandonmentRiskScore: number
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

/**
 * Derive the risk scores from the snapshot's EXPOSED deterministic fields, mirroring the engine's
 * formulas. The canonical `CommissionerLeagueHealthSnapshot` does not carry these, so they are
 * re-derived from the memo (not recomputed from raw data). Dispute data isn't in the snapshot → 0.
 */
export function deriveCommissionerRiskScores(snapshot: CommissionerLeagueHealthSnapshot): CommissionerRiskScores {
  const inactiveTeams = snapshot.metrics.inactiveTeams
  const abandonedTeams = Math.max(0, inactiveTeams - 1)
  return {
    churnRiskScore: clamp(Math.round(100 - snapshot.sustainabilityScore), 0, 100),
    disputeRiskScore: 0, // dispute/unresolved-dispute metrics are not carried in the canonical snapshot
    abandonmentRiskScore: clamp(Math.round(abandonedTeams * 30 + inactiveTeams * 15), 0, 100),
  }
}

function verdict(category: CommissionerHealthCategory, message: string, severity: VerdictSeverity): RuleVerdict {
  // Assessment items the commissioner SHOULD review — never illegal. `requires_approval` = needs attention.
  return { rule: `commissioner.health.${category}`, verdict: 'requires_approval', message, severity }
}

/**
 * Map the deterministic snapshot → commissioner attention verdicts. Pure, read-only. Emits nothing
 * when the league is healthy (so `isLegal` stays true — health is never "illegal").
 */
export function evaluateCommissionerHealthRules(snapshot: CommissionerLeagueHealthSnapshot): RuleVerdict[] {
  const m = snapshot.metrics
  const risk = deriveCommissionerRiskScores(snapshot)
  const abandonedTeams = Math.max(0, m.inactiveTeams - 1)
  const out: RuleVerdict[] = []

  if (snapshot.overallStatus === 'critical') out.push(verdict('league_health_critical', `League health is CRITICAL (${snapshot.healthScore}/100).`, 'critical'))
  else if (snapshot.overallStatus === 'at_risk') out.push(verdict('league_health_critical', `League health is at risk (${snapshot.healthScore}/100).`, 'warning'))

  if (snapshot.engagementScore < 40) out.push(verdict('engagement_low', `Engagement is low (${snapshot.engagementScore}/100).`, 'warning'))
  if (snapshot.fairnessScore < 50) out.push(verdict('fairness_low', `Fairness is low (${snapshot.fairnessScore}/100).`, 'warning'))
  if (snapshot.sustainabilityScore < 50) out.push(verdict('sustainability_low', `Sustainability is low (${snapshot.sustainabilityScore}/100).`, 'warning'))

  if (risk.churnRiskScore >= 60) out.push(verdict('churn_risk_high', `Churn risk is high (${risk.churnRiskScore}/100).`, 'warning'))
  if (risk.disputeRiskScore >= 50) out.push(verdict('dispute_risk_high', `Dispute risk is high (${risk.disputeRiskScore}/100).`, 'warning'))
  if (risk.abandonmentRiskScore >= 50) out.push(verdict('abandonment_risk_high', `Abandonment risk is high (${risk.abandonmentRiskScore}/100).`, 'critical'))

  if (m.inactiveTeams >= 2) out.push(verdict('inactive_managers', `${m.inactiveTeams} inactive managers.`, 'warning'))
  if (abandonedTeams >= 1) out.push(verdict('abandoned_teams', `${abandonedTeams} abandoned team(s) — find replacements.`, 'critical'))
  if (m.missedLineups >= 1) out.push(verdict('missed_lineups', `${m.missedLineups} team(s) with missed/empty lineups.`, 'warning'))
  if (m.injuredStarters >= 3) out.push(verdict('injured_starters', `${m.injuredStarters} injured/questionable starters across the league.`, 'info'))
  if (snapshot.dataConfidence === 'low') out.push(verdict('low_data_confidence', 'Health computed from low-confidence data.', 'info'))

  return out
}

// NOTE: no validator-parity seam here. `core/parity.compareValidatorParity` compares ILLEGAL-verdict
// categories (a legality gate). Commissioner health is an ASSESSMENT — its verdicts are
// `requires_approval`, never `illegal` — so validator parity does not apply. The meaningful gate is
// the score-level SHADOW parity (see parity.ts).
