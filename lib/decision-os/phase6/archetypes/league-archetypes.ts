/**
 * Decision OS — Phase 6.3 League Archetype Classifier.
 *
 * Deterministic, auditable classification of a league into one of 10 archetypes
 * based on Phase 5.3 LeagueBehavioralIntelligence signals.
 *
 * Architecture constraints (PHASE_6_DECISION_INTELLIGENCE_ADR.md):
 *   - Pure: no DB access, no AI calls, no IO, no side effects
 *   - Deterministic: same input → same output, always
 *   - Transparent: full derivation chain in every result
 *   - No fabrication: 'unknown' when confidence < 0.50 or data is sparse
 *   - Version-stamped: all outputs carry ARCHETYPE_VERSION for auditability
 */

import type {
  LeagueArchetypeInput,
  LeagueArchetypeLabel,
  LeagueArchetypeResult,
  ArchetypeDerivationStep,
  ArchetypeSignalCoverage,
} from './types'

// ── Versioning ────────────────────────────────────────────────────────────────

/** Bump patch for weight/threshold tuning, minor for new labels, major for renames/removals. */
export const ARCHETYPE_VERSION = '6.3.0'

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Minimum confidence for a non-unknown classification. */
const MIN_CONFIDENCE   = 0.50
/** Below this completeness score the classifier always returns 'unknown'. */
const MIN_COMPLETENESS = 20

// ── Signal path constants ─────────────────────────────────────────────────────
// Stable string identifiers for derivation chains. Never change these values
// without bumping ARCHETYPE_VERSION (they appear in audit logs).

const S = {
  ET:  'leagueEngagementTier',
  ES:  'leagueEngagementScore',
  RR:  'retentionRisk',
  CW:  'commissionerWorkload',
  TT:  'tradeActivity.tier',
  TR:  'tradeActivity.perManagerRate',
  WT:  'waiverActivity.tier',
  WR:  'waiverActivity.perManagerRate',
  DT:  'draftActivity.tier',
  AP:  'participationDistribution.activePercent',
  IP:  'participationDistribution.inactivePercent',
  TM:  'participationDistribution.totalManagers',
  CO:  'completeness',
} as const

/** All signals evaluated in v6.3.0 — listed in signalCoverage.available when data exists. */
const EVALUABLE_SIGNALS = Object.values(S)

/**
 * Signals that would improve classification accuracy but are not yet available.
 * Populated by Phase 6.1 (pattern detection) and Phase 6.5 (benchmarking).
 */
const FUTURE_SIGNALS = [
  'chatActivity.tier',
  'commissionerPostCadence',
  'weekOverWeekEngagementDelta',
  'historicalRetentionRate',
  'benchmarkPercentile',
]

// ── Derivation helpers ────────────────────────────────────────────────────────

function step(signal: string, value: unknown, contribution: string): ArchetypeDerivationStep {
  return { signal, value, contribution }
}

function sup(msg: string): string { return `supports: ${msg}` }
function neu(msg: string): string { return `neutral: ${msg}` }

// ── Internal scorer result ────────────────────────────────────────────────────

interface ScorerOutput {
  confidence: number
  reasons:    string[]
  derivation: ArchetypeDerivationStep[]
}

// ── Per-archetype scorers ─────────────────────────────────────────────────────
// Each function scores ONE archetype and returns its confidence + derivation.
// The main classifier calls them in priority order; the first to cross MIN_CONFIDENCE wins.
// Weights within each scorer sum to 1.0 for a perfect match.

function scoreInactiveOrStale(i: LeagueArchetypeInput): ScorerOutput {
  let confidence = 0
  const reasons: string[] = []
  const derivation: ArchetypeDerivationStep[] = []

  // Primary: dormant tier alone (0.60) is sufficient to cross MIN_CONFIDENCE (0.50)
  if (i.leagueEngagementTier === 'dormant') {
    confidence += 0.60
    reasons.push('League engagement tier is dormant')
    derivation.push(step(S.ET, i.leagueEngagementTier, sup('Engagement tier is dormant — league has no meaningful activity')))
  } else {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu(`Engagement tier is ${i.leagueEngagementTier}, not dormant`)))
  }

  // Supporting: critical retention risk
  if (i.retentionRisk === 'critical') {
    confidence += 0.25
    reasons.push('Retention risk is critical')
    derivation.push(step(S.RR, i.retentionRisk, sup('Critical retention risk confirms stale state')))
  } else {
    derivation.push(step(S.RR, i.retentionRisk, neu(`Retention risk is ${i.retentionRisk}`)))
  }

  // Supporting: very low active participation
  if (i.participationDistribution.activePercent < 25) {
    confidence += 0.15
    const msg = `Only ${i.participationDistribution.activePercent.toFixed(0)}% of managers are active`
    reasons.push(msg)
    derivation.push(step(S.AP, i.participationDistribution.activePercent, sup(msg)))
  } else {
    derivation.push(step(S.AP, i.participationDistribution.activePercent,
      neu(`Active percent (${i.participationDistribution.activePercent.toFixed(0)}%) does not confirm stale state`)))
  }

  return { confidence, reasons, derivation }
}

function scoreHighChurnRisk(i: LeagueArchetypeInput): ScorerOutput {
  let confidence = 0
  const reasons: string[] = []
  const derivation: ArchetypeDerivationStep[] = []

  // Primary: retention risk (graduated — critical or high both contribute)
  if (i.retentionRisk === 'critical') {
    confidence += 0.40
    reasons.push('Retention risk is critical')
    derivation.push(step(S.RR, i.retentionRisk, sup('Critical retention risk is the primary churn signal')))
  } else if (i.retentionRisk === 'high') {
    confidence += 0.22
    reasons.push('Retention risk is high')
    derivation.push(step(S.RR, i.retentionRisk, sup('High retention risk indicates elevated churn probability')))
  } else {
    derivation.push(step(S.RR, i.retentionRisk, neu(`Retention risk (${i.retentionRisk}) does not indicate churn`)))
  }

  // Supporting: elevated inactive manager rate
  if (i.participationDistribution.inactivePercent >= 30) {
    confidence += 0.30
    const msg = `${i.participationDistribution.inactivePercent.toFixed(0)}% of managers are inactive`
    reasons.push(msg)
    derivation.push(step(S.IP, i.participationDistribution.inactivePercent, sup(msg)))
  } else {
    derivation.push(step(S.IP, i.participationDistribution.inactivePercent,
      neu(`Inactive rate (${i.participationDistribution.inactivePercent.toFixed(0)}%) below churn threshold`)))
  }

  // Supporting: engagement tier trending downward
  if (i.leagueEngagementTier === 'passive' || i.leagueEngagementTier === 'moderate') {
    confidence += 0.20
    const msg = `Engagement tier (${i.leagueEngagementTier}) signals declining participation`
    reasons.push(msg)
    derivation.push(step(S.ET, i.leagueEngagementTier, sup(msg)))
  } else {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu(`Engagement tier (${i.leagueEngagementTier})`)))
  }

  // Weak secondary: low engagement score
  if (i.leagueEngagementScore < 35) {
    confidence += 0.10
    const msg = `Low engagement score (${i.leagueEngagementScore.toFixed(0)}) confirms risk`
    reasons.push(msg)
    derivation.push(step(S.ES, i.leagueEngagementScore, sup(msg)))
  } else {
    derivation.push(step(S.ES, i.leagueEngagementScore,
      neu(`Engagement score (${i.leagueEngagementScore.toFixed(0)}) does not signal churn`)))
  }

  return { confidence, reasons, derivation }
}

function scoreHighlyEngaged(i: LeagueArchetypeInput): ScorerOutput {
  let confidence = 0
  const reasons: string[] = []
  const derivation: ArchetypeDerivationStep[] = []

  // Primary: elite or active tier
  if (i.leagueEngagementTier === 'elite' || i.leagueEngagementTier === 'active') {
    confidence += 0.35
    const msg = `Engagement tier is ${i.leagueEngagementTier}`
    reasons.push(msg)
    derivation.push(step(S.ET, i.leagueEngagementTier, sup(msg)))
  } else {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu(`Engagement tier (${i.leagueEngagementTier}) is not elite/active`)))
  }

  // Strong supporting: low retention risk
  if (i.retentionRisk === 'low') {
    confidence += 0.30
    reasons.push('Retention risk is low — managers are engaged and stable')
    derivation.push(step(S.RR, i.retentionRisk, sup('Low retention risk confirms sustainable engagement')))
  } else {
    derivation.push(step(S.RR, i.retentionRisk, neu(`Retention risk is ${i.retentionRisk}, not low`)))
  }

  // Supporting: high active participation
  if (i.participationDistribution.activePercent >= 75) {
    confidence += 0.20
    const msg = `${i.participationDistribution.activePercent.toFixed(0)}% of managers are active`
    reasons.push(msg)
    derivation.push(step(S.AP, i.participationDistribution.activePercent, sup(msg)))
  } else {
    derivation.push(step(S.AP, i.participationDistribution.activePercent,
      neu(`Active percent (${i.participationDistribution.activePercent.toFixed(0)}%) below high-engagement threshold`)))
  }

  // Weak: at least one transaction dimension is active
  const hasActivity =
    i.tradeActivity.tier !== 'none' ||
    i.waiverActivity.tier !== 'none' ||
    i.draftActivity.tier !== 'none'
  if (hasActivity) {
    confidence += 0.15
    reasons.push('At least one transaction dimension shows activity')
    derivation.push(step(S.TT, i.tradeActivity.tier, sup(`Trade=${i.tradeActivity.tier}, waiver=${i.waiverActivity.tier}, draft=${i.draftActivity.tier}`)))
  } else {
    derivation.push(step(S.TT, i.tradeActivity.tier, neu('No transaction activity in any dimension')))
  }

  return { confidence, reasons, derivation }
}

function scoreCompetitiveBalanced(i: LeagueArchetypeInput): ScorerOutput {
  let confidence = 0
  const reasons: string[] = []
  const derivation: ArchetypeDerivationStep[] = []

  // GATE: both trade AND waiver must be moderate or higher — otherwise return 0
  const tradeActive  = i.tradeActivity.tier === 'high' || i.tradeActivity.tier === 'moderate'
  const waiverActive = i.waiverActivity.tier === 'high' || i.waiverActivity.tier === 'moderate'

  if (!tradeActive) {
    derivation.push(step(S.TT, i.tradeActivity.tier, neu('Trade activity below moderate — gate not met for competitive_balanced')))
    derivation.push(step(S.WT, i.waiverActivity.tier, neu('Both dimensions must be moderate+ for competitive_balanced')))
    return { confidence: 0, reasons, derivation }
  }
  if (!waiverActive) {
    derivation.push(step(S.TT, i.tradeActivity.tier, neu('Trade active but waiver below moderate — gate not met for competitive_balanced')))
    derivation.push(step(S.WT, i.waiverActivity.tier, neu('Both dimensions must be moderate+ for competitive_balanced')))
    return { confidence: 0, reasons, derivation }
  }

  // Trade activity (moderate+ already confirmed by gate)
  {
    confidence += 0.30
    const msg = `Trade activity tier is ${i.tradeActivity.tier}`
    reasons.push(msg)
    derivation.push(step(S.TT, i.tradeActivity.tier, sup(msg)))
  }

  // Waiver activity (moderate+ already confirmed by gate)
  {
    confidence += 0.30
    const msg = `Waiver activity tier is ${i.waiverActivity.tier}`
    reasons.push(msg)
    derivation.push(step(S.WT, i.waiverActivity.tier, sup(msg)))
  }

  // Engagement tier
  if (i.leagueEngagementTier !== 'dormant' && i.leagueEngagementTier !== 'passive') {
    confidence += 0.20
    const msg = `Engagement tier (${i.leagueEngagementTier}) supports healthy competition`
    reasons.push(msg)
    derivation.push(step(S.ET, i.leagueEngagementTier, sup(msg)))
  } else {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu(`Engagement tier (${i.leagueEngagementTier}) is low despite transaction activity`)))
  }

  // Active participation
  if (i.participationDistribution.activePercent >= 60) {
    confidence += 0.20
    const msg = `${i.participationDistribution.activePercent.toFixed(0)}% of managers are active`
    reasons.push(msg)
    derivation.push(step(S.AP, i.participationDistribution.activePercent, sup(msg)))
  } else {
    derivation.push(step(S.AP, i.participationDistribution.activePercent,
      neu(`Active percent (${i.participationDistribution.activePercent.toFixed(0)}%) below competitive threshold`)))
  }

  return { confidence, reasons, derivation }
}

function scoreTradeHeavy(i: LeagueArchetypeInput): ScorerOutput {
  let confidence = 0
  const reasons: string[] = []
  const derivation: ArchetypeDerivationStep[] = []

  // GATE: trade must be high tier
  if (i.tradeActivity.tier !== 'high') {
    derivation.push(step(S.TT, i.tradeActivity.tier, neu(`Trade tier is ${i.tradeActivity.tier}, not high — gate not met for trade_heavy`)))
    return { confidence: 0, reasons, derivation }
  }

  // Primary: trade tier = high
  confidence += 0.45
  reasons.push('Trade activity tier is high')
  derivation.push(step(S.TT, i.tradeActivity.tier, sup('High trade tier is the primary trade_heavy signal')))

  // Trade dominates or matches waiver rate
  if (i.tradeActivity.perManagerRate >= i.waiverActivity.perManagerRate) {
    confidence += 0.25
    const msg = `Trade rate (${i.tradeActivity.perManagerRate.toFixed(2)}) ≥ waiver rate (${i.waiverActivity.perManagerRate.toFixed(2)})`
    reasons.push(msg)
    derivation.push(step(S.TR, i.tradeActivity.perManagerRate, sup(msg)))
  } else {
    derivation.push(step(S.TR, i.tradeActivity.perManagerRate,
      neu(`Trade rate (${i.tradeActivity.perManagerRate.toFixed(2)}) < waiver rate — waiver may dominate`)))
  }
  derivation.push(step(S.WR, i.waiverActivity.perManagerRate, neu(`Waiver rate for comparison: ${i.waiverActivity.perManagerRate.toFixed(2)}`)))

  // League is not dormant (trade can only be dominant in a living league)
  if (i.leagueEngagementTier !== 'dormant') {
    confidence += 0.15
    derivation.push(step(S.ET, i.leagueEngagementTier, sup(`Engagement tier (${i.leagueEngagementTier}) confirms active league`)))
  } else {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu('Dormant engagement despite high trade tier (unusual)')))
  }

  // Retention not critical
  if (i.retentionRisk !== 'critical') {
    confidence += 0.15
    derivation.push(step(S.RR, i.retentionRisk, sup(`Retention risk (${i.retentionRisk}) — managers are staying`)))
  } else {
    derivation.push(step(S.RR, i.retentionRisk, neu('Critical retention risk despite high trade activity')))
  }

  return { confidence, reasons, derivation }
}

function scoreWaiverActive(i: LeagueArchetypeInput): ScorerOutput {
  let confidence = 0
  const reasons: string[] = []
  const derivation: ArchetypeDerivationStep[] = []

  // GATE: waiver must be high tier
  if (i.waiverActivity.tier !== 'high') {
    derivation.push(step(S.WT, i.waiverActivity.tier, neu(`Waiver tier is ${i.waiverActivity.tier}, not high — gate not met for waiver_active`)))
    return { confidence: 0, reasons, derivation }
  }

  // Primary: waiver tier = high
  confidence += 0.45
  reasons.push('Waiver activity tier is high')
  derivation.push(step(S.WT, i.waiverActivity.tier, sup('High waiver tier is the primary waiver_active signal')))

  // Waiver dominates or matches trade rate
  if (i.waiverActivity.perManagerRate >= i.tradeActivity.perManagerRate) {
    confidence += 0.25
    const msg = `Waiver rate (${i.waiverActivity.perManagerRate.toFixed(2)}) ≥ trade rate (${i.tradeActivity.perManagerRate.toFixed(2)})`
    reasons.push(msg)
    derivation.push(step(S.WR, i.waiverActivity.perManagerRate, sup(msg)))
  } else {
    derivation.push(step(S.WR, i.waiverActivity.perManagerRate,
      neu(`Waiver rate (${i.waiverActivity.perManagerRate.toFixed(2)}) < trade rate — trade may dominate`)))
  }
  derivation.push(step(S.TR, i.tradeActivity.perManagerRate, neu(`Trade rate for comparison: ${i.tradeActivity.perManagerRate.toFixed(2)}`)))

  // League is active
  if (i.leagueEngagementTier !== 'dormant') {
    confidence += 0.15
    derivation.push(step(S.ET, i.leagueEngagementTier, sup(`Engagement tier (${i.leagueEngagementTier}) confirms active waiver market`)))
  } else {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu('Dormant engagement despite high waiver tier (unusual)')))
  }

  // Retention not critical
  if (i.retentionRisk !== 'critical') {
    confidence += 0.15
    derivation.push(step(S.RR, i.retentionRisk, sup(`Retention risk (${i.retentionRisk}) — waiver-active managers are engaged`)))
  } else {
    derivation.push(step(S.RR, i.retentionRisk, neu('Critical retention risk despite active waiver market')))
  }

  return { confidence, reasons, derivation }
}

function scoreCommissionerDriven(i: LeagueArchetypeInput): ScorerOutput {
  let confidence = 0
  const reasons: string[] = []
  const derivation: ArchetypeDerivationStep[] = []

  // GATE: commissioner workload must be heavy or critical + league not elite
  const heavyWorkload = i.commissionerWorkload === 'heavy' || i.commissionerWorkload === 'critical'
  const notElite      = i.leagueEngagementTier !== 'elite'

  if (!heavyWorkload) {
    derivation.push(step(S.CW, i.commissionerWorkload, neu(`Commissioner workload (${i.commissionerWorkload}) — gate requires heavy/critical`)))
    return { confidence: 0, reasons, derivation }
  }
  if (!notElite) {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu('Elite engagement means managers are self-sustaining — not commissioner_driven')))
    derivation.push(step(S.CW, i.commissionerWorkload, neu('Heavy workload but elite engagement — classify as highly_engaged instead')))
    return { confidence: 0, reasons, derivation }
  }

  // Primary: heavy or critical commissioner workload
  if (i.commissionerWorkload === 'critical') {
    confidence += 0.45
    reasons.push('Commissioner workload is critical — commissioner is essential to league function')
    derivation.push(step(S.CW, i.commissionerWorkload, sup('Critical commissioner workload — primary signal')))
  } else {
    confidence += 0.35
    reasons.push('Commissioner workload is heavy')
    derivation.push(step(S.CW, i.commissionerWorkload, sup('Heavy commissioner workload — primary signal')))
  }

  // Supporting: moderate or passive engagement (league exists because of commissioner effort)
  if (i.leagueEngagementTier === 'moderate' || i.leagueEngagementTier === 'passive') {
    confidence += 0.25
    const msg = `Engagement tier (${i.leagueEngagementTier}) shows league depends on commissioner`
    reasons.push(msg)
    derivation.push(step(S.ET, i.leagueEngagementTier, sup(msg)))
  } else {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu(`Engagement tier (${i.leagueEngagementTier})`)))
  }

  // Supporting: managers are not self-driving trades
  if (i.tradeActivity.tier !== 'high') {
    confidence += 0.15
    derivation.push(step(S.TT, i.tradeActivity.tier, sup(`Trade tier (${i.tradeActivity.tier}) — managers not independently driving trades`)))
  } else {
    derivation.push(step(S.TT, i.tradeActivity.tier, neu('High trade tier despite low commissioner dependency')))
  }

  // Supporting: managers are not self-driving waivers
  if (i.waiverActivity.tier !== 'high') {
    confidence += 0.15
    derivation.push(step(S.WT, i.waiverActivity.tier, sup(`Waiver tier (${i.waiverActivity.tier}) — managers not independently active on waivers`)))
  } else {
    derivation.push(step(S.WT, i.waiverActivity.tier, neu('High waiver tier — managers are more self-sufficient than expected')))
  }

  return { confidence, reasons, derivation }
}

function scoreCasualSocial(i: LeagueArchetypeInput): ScorerOutput {
  let confidence = 0
  const reasons: string[] = []
  const derivation: ArchetypeDerivationStep[] = []

  // GATE: engagement must be active or moderate, AND neither trade nor waiver is high
  const positiveEngagement = i.leagueEngagementTier === 'active' || i.leagueEngagementTier === 'moderate'
  const lowTransactions    = i.tradeActivity.tier !== 'high' && i.waiverActivity.tier !== 'high'

  if (!positiveEngagement) {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu(`Engagement tier (${i.leagueEngagementTier}) — gate requires active/moderate for casual_social`)))
    return { confidence: 0, reasons, derivation }
  }
  if (!lowTransactions) {
    const active = i.tradeActivity.tier === 'high' ? `trade=${i.tradeActivity.tier}` : `waiver=${i.waiverActivity.tier}`
    derivation.push(step(S.TT, i.tradeActivity.tier, neu(`High transaction activity (${active}) — not casual_social`)))
    return { confidence: 0, reasons, derivation }
  }

  // Primary: active/moderate engagement
  if (i.leagueEngagementTier === 'active') {
    confidence += 0.30
    reasons.push('Engagement tier is active — managers participate without high transaction volume')
    derivation.push(step(S.ET, i.leagueEngagementTier, sup('Active engagement tier is the primary casual_social signal')))
  } else {
    confidence += 0.20
    reasons.push('Engagement tier is moderate — casual participation pattern')
    derivation.push(step(S.ET, i.leagueEngagementTier, sup('Moderate engagement supports casual_social pattern')))
  }

  // Supporting: low trade activity
  if (i.tradeActivity.tier === 'low' || i.tradeActivity.tier === 'none') {
    confidence += 0.25
    const msg = `Trade activity is ${i.tradeActivity.tier} — not a transaction-driven league`
    reasons.push(msg)
    derivation.push(step(S.TT, i.tradeActivity.tier, sup(msg)))
  } else {
    derivation.push(step(S.TT, i.tradeActivity.tier, neu(`Trade tier (${i.tradeActivity.tier})`)))
  }

  // Supporting: low waiver activity
  if (i.waiverActivity.tier === 'low' || i.waiverActivity.tier === 'none') {
    confidence += 0.25
    const msg = `Waiver activity is ${i.waiverActivity.tier} — managers are not waiver-focused`
    reasons.push(msg)
    derivation.push(step(S.WT, i.waiverActivity.tier, sup(msg)))
  } else {
    derivation.push(step(S.WT, i.waiverActivity.tier, neu(`Waiver tier (${i.waiverActivity.tier})`)))
  }

  // Supporting: retention is not critical (league stays together)
  if (i.retentionRisk === 'low' || i.retentionRisk === 'medium') {
    confidence += 0.20
    reasons.push(`Retention risk (${i.retentionRisk}) suggests stable social group`)
    derivation.push(step(S.RR, i.retentionRisk, sup(`Retention risk (${i.retentionRisk}) — casual league is stable`)))
  } else {
    derivation.push(step(S.RR, i.retentionRisk, neu(`Retention risk (${i.retentionRisk}) is elevated for a casual league`)))
  }

  return { confidence, reasons, derivation }
}

function scoreLowEngagement(i: LeagueArchetypeInput): ScorerOutput {
  let confidence = 0
  const reasons: string[] = []
  const derivation: ArchetypeDerivationStep[] = []

  // Primary: passive or dormant tier (dormant already caught by inactive_or_stale, but
  // if it reaches here, dormant alone still scores 0.45 — below MIN_CONFIDENCE, so
  // low_engagement is a catch-all for truly low but not-yet-critical cases)
  if (i.leagueEngagementTier === 'passive' || i.leagueEngagementTier === 'dormant') {
    confidence += 0.45
    const msg = `Engagement tier is ${i.leagueEngagementTier}`
    reasons.push(msg)
    derivation.push(step(S.ET, i.leagueEngagementTier, sup(msg)))
  } else {
    derivation.push(step(S.ET, i.leagueEngagementTier, neu(`Engagement tier (${i.leagueEngagementTier}) is not passive/dormant`)))
  }

  // Supporting: low engagement score
  if (i.leagueEngagementScore < 40) {
    confidence += 0.25
    const msg = `Low engagement score (${i.leagueEngagementScore.toFixed(0)}/100)`
    reasons.push(msg)
    derivation.push(step(S.ES, i.leagueEngagementScore, sup(msg)))
  } else {
    derivation.push(step(S.ES, i.leagueEngagementScore, neu(`Engagement score (${i.leagueEngagementScore.toFixed(0)}) above low threshold`)))
  }

  // Supporting: medium or higher retention risk
  if (i.retentionRisk === 'medium' || i.retentionRisk === 'high' || i.retentionRisk === 'critical') {
    confidence += 0.30
    const msg = `Retention risk is ${i.retentionRisk}`
    reasons.push(msg)
    derivation.push(step(S.RR, i.retentionRisk, sup(msg)))
  } else {
    derivation.push(step(S.RR, i.retentionRisk, neu(`Retention risk (${i.retentionRisk}) is surprisingly low for a low-engagement league`)))
  }

  return { confidence, reasons, derivation }
}

// ── Signal coverage ───────────────────────────────────────────────────────────

function buildSignalCoverage(input: LeagueArchetypeInput): ArchetypeSignalCoverage {
  if (input.completeness === 0) {
    return {
      available: [],
      missing:   [...EVALUABLE_SIGNALS, ...FUTURE_SIGNALS],
    }
  }
  return {
    available: EVALUABLE_SIGNALS,
    missing:   FUTURE_SIGNALS,
  }
}

// ── Unknown result factory ────────────────────────────────────────────────────

function unknownResult(
  input:  LeagueArchetypeInput,
  reason: string,
): LeagueArchetypeResult {
  return {
    archetype:      'unknown',
    confidence:     0,
    reasons:        [reason],
    signalCoverage: buildSignalCoverage(input),
    derivation:     [step(S.CO, input.completeness, neu(reason))],
    version:        ARCHETYPE_VERSION,
  }
}

// ── Classifier registry (priority-ordered) ───────────────────────────────────

const CLASSIFIERS: ReadonlyArray<readonly [LeagueArchetypeLabel, (i: LeagueArchetypeInput) => ScorerOutput]> = [
  ['inactive_or_stale',    scoreInactiveOrStale],
  ['high_churn_risk',      scoreHighChurnRisk],
  ['highly_engaged',       scoreHighlyEngaged],
  ['competitive_balanced', scoreCompetitiveBalanced],
  ['trade_heavy',          scoreTradeHeavy],
  ['waiver_active',        scoreWaiverActive],
  ['commissioner_driven',  scoreCommissionerDriven],
  ['casual_social',        scoreCasualSocial],
  ['low_engagement',       scoreLowEngagement],
] as const

// ── Public classifier ─────────────────────────────────────────────────────────

/**
 * Classifies a league into one of 10 archetypes based on Phase 5.3 behavioral signals.
 *
 * Pass any `LeagueBehavioralIntelligence` directly — it satisfies `LeagueArchetypeInput`.
 *
 * Pure: no IO, no DB, no AI calls.
 * Deterministic: same input → same output.
 * Transparent: full derivation chain in result.
 */
export function classifyLeagueArchetype(input: LeagueArchetypeInput): LeagueArchetypeResult {
  // Guard: insufficient data completeness
  if (input.completeness < MIN_COMPLETENESS) {
    return unknownResult(input,
      `Insufficient data to classify (completeness=${input.completeness}%, minimum=${MIN_COMPLETENESS}%)`)
  }

  // Guard: no manager data
  if (input.participationDistribution.totalManagers === 0) {
    return unknownResult(input, 'No manager data available for classification')
  }

  const coverage = buildSignalCoverage(input)

  // Try each classifier in priority order; first to cross MIN_CONFIDENCE wins
  for (const [label, scorer] of CLASSIFIERS) {
    const result = scorer(input)
    if (result.confidence >= MIN_CONFIDENCE) {
      return {
        archetype:      label,
        confidence:     Math.min(1, result.confidence),
        reasons:        result.reasons,
        signalCoverage: coverage,
        derivation:     result.derivation,
        version:        ARCHETYPE_VERSION,
      }
    }
  }

  // No classifier met the threshold
  return {
    archetype:      'unknown',
    confidence:     0,
    reasons:        ['No archetype pattern scored above the minimum confidence threshold (0.50)'],
    signalCoverage: coverage,
    derivation:     [step(S.CO, input.completeness, neu('No dominant archetype pattern detected across all classifiers'))],
    version:        ARCHETYPE_VERSION,
  }
}
