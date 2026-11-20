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
import type { InactiveFlagView } from '@/lib/commissioner-hub/inactiveFlagView'
import { shrunkRate } from '@/lib/chimmy-outcomes/shrinkage'

/**
 * What the commissioner's graded outcomes say (2026-11-20, the learning loop). Optional: without it every verdict is
 * exactly what it was.
 */
export type CommissionerHealthLearning = {
  /** The inactive flag's graded record: of managers flagged inactive, how many still had done nothing two weeks on. */
  inactiveFlags?: InactiveFlagView | null
}

/** The flag's precision, shrunk toward even odds (worth 20 flags), or null below the record's own floor. */
export function inactiveFlagPrecision(record: InactiveFlagView | null | undefined): number | null {
  if (!record || record.ratePct == null) return null
  return shrunkRate(record.stayedAway, record.graded, { priorRate: 0.5, priorWeight: 20, minSample: 30 })
}

/** At or above: past flags have held up. Below LOW: most flagged managers came back on their own. */
export const INACTIVE_FLAG_HELD_UP = 0.7
export const INACTIVE_FLAG_LOW = 0.4

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
export function evaluateCommissionerHealthRules(
  snapshot: CommissionerLeagueHealthSnapshot,
  learned: CommissionerHealthLearning = {},
): RuleVerdict[] {
  const m = snapshot.metrics
  const risk = deriveCommissionerRiskScores(snapshot)
  const abandonedTeams = Math.max(0, m.inactiveTeams - 1)
  const out: RuleVerdict[] = []

  if (snapshot.overallStatus === 'critical') out.push(verdict('league_health_critical', `League health is CRITICAL (${snapshot.healthScore}/100).`, 'critical'))
  else if (snapshot.overallStatus === 'at_risk') out.push(verdict('league_health_critical', `League health is at risk (${snapshot.healthScore}/100).`, 'warning'))

  if (snapshot.engagementScore < 40) out.push(verdict('engagement_low', `Activity is low (${snapshot.engagementScore}/100).`, 'warning'))
  if (snapshot.fairnessScore < 50) out.push(verdict('fairness_low', `Fairness is low (${snapshot.fairnessScore}/100).`, 'warning'))
  if (snapshot.sustainabilityScore < 50) out.push(verdict('sustainability_low', `Sustainability is low (${snapshot.sustainabilityScore}/100).`, 'warning'))

  if (risk.churnRiskScore >= 60) out.push(verdict('churn_risk_high', `Churn risk is high (${risk.churnRiskScore}/100).`, 'warning'))
  if (risk.disputeRiskScore >= 50) out.push(verdict('dispute_risk_high', `Dispute risk is high (${risk.disputeRiskScore}/100).`, 'warning'))

  /*
   * 🛑 THE INACTIVE WARNINGS LEARN FROM HOW PAST FLAGS TURNED OUT (2026-11-20, the learning loop). The flag is graded two
   * weeks on (`inactiveFlagLedger.ts`): did the manager do anything of their own? Where that record describes this
   * league's flag — a NATIVE league, the only kind whose "inactive" reads the manager's own actions — and has 30+
   * graded flags, it sets how strongly these two warnings are put:
   *   - held up (≥70%, shrunk): said as before, with the record as evidence;
   *   - mixed (40–70%): still a warning, but "message them before replacing anyone";
   *   - mostly came back (<40%): an information item, and "abandoned — find replacements" and the abandonment risk
   *     (both computed from the same inactive count) are no longer critical.
   * The COUNT is never changed, the manager table is untouched, and auto hand-over is the commissioner's own rule.
   */
  const precision = snapshot.nativeLeague ? inactiveFlagPrecision(learned.inactiveFlags) : null
  const record = learned.inactiveFlags
  const pct = precision != null ? Math.round(precision * 100) : null
  const evidence = record && pct != null ? `${record.stayedAway} of ${record.graded} managers AllFantasy flagged inactive stayed away two weeks later` : ''
  // The abandonment risk score is computed from the same inactive count, so the same record decides how it is put.
  if (risk.abandonmentRiskScore >= 50) {
    out.push(
      precision != null && precision < INACTIVE_FLAG_LOW
        ? verdict('abandonment_risk_high', `Abandonment risk reads high (${risk.abandonmentRiskScore}/100), but it rests on inactive flags that mostly came back on their own (${evidence}).`, 'warning')
        : verdict('abandonment_risk_high', `Abandonment risk is high (${risk.abandonmentRiskScore}/100).`, 'critical'),
    )
  }
  if (m.inactiveTeams >= 2) {
    if (precision == null) out.push(verdict('inactive_managers', `${m.inactiveTeams} inactive managers.`, 'warning'))
    else if (precision >= INACTIVE_FLAG_HELD_UP) {
      out.push(verdict('inactive_managers', `${m.inactiveTeams} inactive managers. Past flags have held up: ${evidence}.`, 'warning'))
    } else if (precision >= INACTIVE_FLAG_LOW) {
      out.push(verdict('inactive_managers', `${m.inactiveTeams} inactive managers. Past flags are mixed (${evidence}), so message them before replacing anyone.`, 'warning'))
    } else {
      out.push(verdict('inactive_managers', `${m.inactiveTeams} managers look inactive, but most past flags came back on their own (${evidence}). Check in before acting.`, 'info'))
    }
  }
  if (abandonedTeams >= 1) {
    if (precision != null && precision < INACTIVE_FLAG_LOW) {
      out.push(verdict('abandoned_teams', `${abandonedTeams} team(s) may be abandoned, but most past inactive flags came back on their own. Reach out before finding a replacement.`, 'warning'))
    } else {
      out.push(verdict('abandoned_teams', `${abandonedTeams} abandoned team(s) — find replacements.`, 'critical'))
    }
  }
  if (m.missedLineups >= 1) out.push(verdict('missed_lineups', `${m.missedLineups} team(s) with missed/empty lineups.`, 'warning'))
  if (m.injuredStarters >= 3) out.push(verdict('injured_starters', `${m.injuredStarters} injured/questionable starters across the league.`, 'info'))
  if (snapshot.dataConfidence === 'low') out.push(verdict('low_data_confidence', 'Health computed from low-confidence data.', 'info'))

  return out
}

// NOTE: no validator-parity seam here. `core/parity.compareValidatorParity` compares ILLEGAL-verdict
// categories (a legality gate). Commissioner health is an ASSESSMENT — its verdicts are
// `requires_approval`, never `illegal` — so validator parity does not apply. The meaningful gate is
// the score-level SHADOW parity (see parity.ts).
