/**
 * Decision OS — Phase 5.2 Manager Behavioral Intelligence.
 *
 * Pure derived intelligence layer built on top of Phase 5.0/5.1 ManagerBehavioralFacts.
 * Converts assembled facts + the raw event stream into scored, actionable commissioner signals.
 *
 * Architecture constraints (ADR_F5_2_MANAGER_BEHAVIORAL_INTELLIGENCE.md):
 *   - Read-only / pure: no writes, no IO, no mutations of inputs
 *   - No UI, no AI summaries, no cutover wiring
 *   - No Stage 1 soak slice modification
 *   - Deterministic: same inputs → same output (clock injected via `now` param)
 *   - No fabrication (P2): every zero is honest, no estimated fill-ins
 *   - No AI generation (P3): nudges are rule-based, never LLM-generated
 */

import type { BehavioralEvent } from './events/types'
import type { ManagerBehavioralFacts } from './facts'

// ── Participation tier ────────────────────────────────────────────────────────

/**
 * Overall engagement classification for a manager within a league season.
 * Based on composite engagement score over the lookback window.
 */
export type ParticipationTier = 'elite' | 'active' | 'moderate' | 'passive' | 'inactive'

// ── Retention risk ────────────────────────────────────────────────────────────

/** Estimated likelihood this manager will disengage or ghost the league. */
export type ManagerRetentionRisk = 'low' | 'medium' | 'high' | 'critical' | 'insufficient_data'

// ── Engagement level ──────────────────────────────────────────────────────────

export type EngagementLevel = 'high' | 'moderate' | 'low' | 'none'

// ── Per-dimension engagement ──────────────────────────────────────────────────

/**
 * Engagement score and supporting signals for a single behavioral dimension
 * (lineup, waiver, trade, or draft activity).
 */
export interface ManagerEngagementDimension {
  /** 0–100 score for this dimension. 0 when no events observed in the lookback window. */
  score: number
  /** Qualitative level derived from score. */
  level: EngagementLevel
  /** Number of events contributing to this dimension's score. */
  eventCount: number
  /** ISO 8601 timestamp of the most recent event in this dimension; null if none. */
  lastEventAt: string | null
  /** Soft warnings specific to this dimension. */
  warnings: string[]
}

// ── Commissioner nudge ────────────────────────────────────────────────────────

export type NudgePriority = 'critical' | 'high' | 'medium' | 'low'
export type NudgeCategory = 'engagement' | 'roster' | 'transaction' | 'retention'

/**
 * A deterministic, actionable commissioner nudge derived from behavioral signals.
 * Nudges are ordered by priority (critical first). The message is customer-facing
 * — no internal terminology.
 */
export interface ManagerNudge {
  /** Deterministic ID for this nudge type (e.g., 'nudge_inactive_14d'). */
  nudgeId: string
  priority: NudgePriority
  category: NudgeCategory
  /** Machine-readable signal that triggered this nudge. */
  signal: string
  /** Customer-facing message for the commissioner. No internal terminology. */
  message: string
  /** Event IDs that contributed to triggering this nudge. */
  supportingEventIds: string[]
}

// ── Manager Behavioral Intelligence ──────────────────────────────────────────

/**
 * Derived behavioral intelligence for a single manager within a league.
 * Built deterministically from ManagerBehavioralFacts + raw BehavioralEvent[].
 *
 * Null-safety contract: every numeric field is 0 when no events were observed;
 * null is reserved for fields that are genuinely unknowable (no events ever recorded).
 * Nothing is fabricated.
 *
 * Phase 5.2 — read-only, shadow-only. Not surfaced in production routes.
 */
export interface ManagerBehavioralIntelligence {
  managerId: string
  leagueId: string

  // ── Tier & risk ───────────────────────────────────────────────────────────

  /** Top-level engagement classification within the lookback window. */
  participationTier: ParticipationTier
  /** Estimated risk of this manager abandoning the league. */
  retentionRisk: ManagerRetentionRisk
  /** Human-readable reasons driving the retention risk level. */
  retentionRiskReasons: string[]

  // ── Engagement dimensions ─────────────────────────────────────────────────

  lineupEngagement: ManagerEngagementDimension
  waiverEngagement: ManagerEngagementDimension
  tradeEngagement: ManagerEngagementDimension
  draftEngagement: ManagerEngagementDimension

  // ── Composite score ───────────────────────────────────────────────────────

  /**
   * Weighted composite engagement score (0–100).
   * Weights: lineup 40 %, waiver 25 %, trade 25 %, draft 10 %.
   */
  overallEngagementScore: number

  // ── Inactivity signals ────────────────────────────────────────────────────

  /** Days since the most recent event. Null when no events have ever been recorded. */
  daysSinceLastActivity: number | null
  /** True when inactive for > 14 days OR when no events have been recorded. */
  isInactive: boolean
  /** Customer-facing inactivity warning for the commissioner. Null when not inactive. */
  inactivityWarning: string | null

  // ── Commissioner nudges ───────────────────────────────────────────────────

  /** Prioritised list of actionable nudges for the commissioner. May be empty. */
  nudges: ManagerNudge[]

  // ── Data quality ──────────────────────────────────────────────────────────

  /** Inherited completeness from ManagerBehavioralFacts (0–100). */
  completeness: number
  /** Number of events that fed the underlying facts. */
  derivedFrom: number
  /** Lookback window used when assembling the facts. Null = all available history. */
  lookbackDays: number | null
  /** Warnings from facts plus any dimension-level gaps surfaced by this layer. */
  warnings: string[]
  /** ISO 8601 timestamp of when this intelligence was derived. */
  derivedAt: string
}

// ── Scoring tables (internal) ─────────────────────────────────────────────────

interface Threshold {
  min: number
  score: number
  level: EngagementLevel
}

const LINEUP_THRESHOLDS: Threshold[] = [
  { min: 10, score: 95, level: 'high' },
  { min: 6,  score: 80, level: 'high' },
  { min: 3,  score: 65, level: 'moderate' },
  { min: 1,  score: 40, level: 'low' },
  { min: 0,  score: 0,  level: 'none' },
]

const WAIVER_THRESHOLDS: Threshold[] = [
  { min: 10, score: 90, level: 'high' },
  { min: 5,  score: 75, level: 'high' },
  { min: 2,  score: 55, level: 'moderate' },
  { min: 1,  score: 30, level: 'low' },
  { min: 0,  score: 0,  level: 'none' },
]

const TRADE_THRESHOLDS: Threshold[] = [
  { min: 4, score: 85, level: 'high' },
  { min: 2, score: 65, level: 'moderate' },
  { min: 1, score: 40, level: 'low' },
  { min: 0, score: 0,  level: 'none' },
]

const DRAFT_THRESHOLDS: Threshold[] = [
  { min: 13, score: 90, level: 'high' },
  { min: 6,  score: 75, level: 'high' },
  { min: 1,  score: 50, level: 'moderate' },
  { min: 0,  score: 0,  level: 'none' },
]

// ── Internal helpers ──────────────────────────────────────────────────────────

function scoreFromThresholds(
  count: number,
  thresholds: Threshold[],
): { score: number; level: EngagementLevel } {
  for (const t of thresholds) {
    if (count >= t.min) return { score: t.score, level: t.level }
  }
  return { score: 0, level: 'none' }
}

function latestOccurredAt(evts: BehavioralEvent[]): string | null {
  if (evts.length === 0) return null
  return evts.reduce(
    (latest, e) => (e.occurredAt > latest ? e.occurredAt : latest),
    evts[0].occurredAt,
  )
}

function computeParticipationTier(
  facts: ManagerBehavioralFacts,
  overallScore: number,
): ParticipationTier {
  if (facts.eventCount === 0) return 'inactive'
  if (
    overallScore >= 70 &&
    facts.lineupSaveCount >= 3 &&
    facts.tradeProposalCount + facts.waiverClaimCount >= 2
  ) return 'elite'
  if (overallScore >= 45 && facts.lineupSaveCount >= 1) return 'active'
  if (overallScore >= 20) return 'moderate'
  if (overallScore > 0) return 'passive'
  // eventCount > 0 but zero dimension engagement (e.g., only commissioner/rules events)
  return 'passive'
}

function computeRetentionRisk(
  facts: ManagerBehavioralFacts,
  daysSinceLastActivity: number | null,
  participationTier: ParticipationTier,
  leagueEventCount: number,
): { risk: ManagerRetentionRisk; reasons: string[] } {
  if (facts.eventCount === 0) {
    // Phase 36 honesty rule: league-wide zero events is a DATA-COVERAGE gap, not
    // confirmed disengagement — every manager in an un-ingested league would
    // otherwise read "critical", fabricating an alarm out of an empty table.
    if (leagueEventCount === 0) {
      return {
        risk: 'insufficient_data',
        reasons: [
          'Retention risk cannot be assessed — no activity events have been recorded for this league yet',
        ],
      }
    }
    return {
      risk: 'critical',
      reasons: ['Manager has never taken any recorded action in the league'],
    }
  }
  if (daysSinceLastActivity !== null && daysSinceLastActivity > 28) {
    return {
      risk: 'critical',
      reasons: [`Manager has been inactive for ${daysSinceLastActivity} days`],
    }
  }
  const reasons: string[] = []
  if (daysSinceLastActivity !== null && daysSinceLastActivity > 14) {
    reasons.push(`Manager has been inactive for ${daysSinceLastActivity} days`)
  }
  if (facts.lineupSaveCount === 0 && facts.eventCount > 0) {
    reasons.push('Manager has not set their lineup this season')
  }
  if (reasons.length > 0) return { risk: 'high', reasons }
  if (participationTier === 'passive') {
    return { risk: 'medium', reasons: ['Manager engagement is below average'] }
  }
  return { risk: 'low', reasons: [] }
}

function computeNudges(
  facts: ManagerBehavioralFacts,
  daysSinceLastActivity: number | null,
): ManagerNudge[] {
  const nudges: ManagerNudge[] = []

  if (facts.eventCount === 0) {
    nudges.push({
      nudgeId: 'nudge_never_engaged',
      priority: 'critical',
      category: 'retention',
      signal: 'no_events',
      message:
        'Manager has never taken any recorded action in the league. Consider reaching out directly.',
      supportingEventIds: [],
    })
    return nudges
  }

  // Inactivity nudges are mutually exclusive by severity
  if (daysSinceLastActivity !== null && daysSinceLastActivity > 28) {
    nudges.push({
      nudgeId: 'nudge_inactive_28d',
      priority: 'critical',
      category: 'retention',
      signal: 'inactive_28d',
      message:
        'Manager has been inactive for over 4 weeks. They are at high risk of abandoning the league.',
      supportingEventIds: facts.lastActivity ? [facts.lastActivity.eventId] : [],
    })
  } else if (daysSinceLastActivity !== null && daysSinceLastActivity > 14) {
    nudges.push({
      nudgeId: 'nudge_inactive_14d',
      priority: 'high',
      category: 'retention',
      signal: 'inactive_14d',
      message: `Manager has not been active in ${daysSinceLastActivity} days. Reach out to re-engage them.`,
      supportingEventIds: facts.lastActivity ? [facts.lastActivity.eventId] : [],
    })
  } else if (daysSinceLastActivity !== null && daysSinceLastActivity > 7) {
    nudges.push({
      nudgeId: 'nudge_inactive_7d',
      priority: 'medium',
      category: 'engagement',
      signal: 'inactive_7d',
      message:
        "Manager has not been active in the last week. Check their roster for red flags.",
      supportingEventIds: facts.lastActivity ? [facts.lastActivity.eventId] : [],
    })
  }

  // Engagement nudges can stack with inactivity nudges
  if (facts.lineupSaveCount === 0) {
    nudges.push({
      nudgeId: 'nudge_no_lineup_saves',
      priority: 'high',
      category: 'roster',
      signal: 'no_lineup_saves',
      message:
        'Manager has not set their lineup this season. Their team may be running on auto-fill.',
      supportingEventIds: [],
    })
  }
  if (facts.waiverClaimCount === 0) {
    nudges.push({
      nudgeId: 'nudge_no_waiver_activity',
      priority: 'medium',
      category: 'transaction',
      signal: 'no_waiver_claims',
      message:
        'Manager has not made any waiver claims. They may be missing upgrade opportunities.',
      supportingEventIds: [],
    })
  }
  if (facts.tradeProposalCount === 0) {
    nudges.push({
      nudgeId: 'nudge_no_trade_activity',
      priority: 'low',
      category: 'transaction',
      signal: 'no_trade_proposals',
      message:
        'Manager has not proposed any trades. Nudge them to explore trade opportunities.',
      supportingEventIds: [],
    })
  }

  return nudges
}

// ── Main assembler ────────────────────────────────────────────────────────────

/**
 * Derive behavioral intelligence for a single manager from their assembled facts
 * and the raw event stream.
 *
 * The function is pure and referentially transparent given a fixed `now`:
 * same inputs → same output.
 *
 * @param facts  Pre-assembled ManagerBehavioralFacts for this manager.
 * @param events Raw BehavioralEvent[] (may include all league events; filtered internally
 *               to this manager by managerId). Not mutated.
 * @param now    Reference time for inactivity calculations. Defaults to `new Date()`.
 *               Pass a fixed Date in tests to ensure determinism.
 */
export function deriveManagerBehavioralIntelligence(
  facts: ManagerBehavioralFacts,
  events: BehavioralEvent[],
  now: Date = new Date(),
): ManagerBehavioralIntelligence {
  const { managerId, leagueId } = facts

  // Filter to this manager's events only (guard: trade_accepted/rejected have null managerId)
  const myEvents = events.filter((e) => e.managerId === managerId)

  // ── Per-dimension lastEventAt ─────────────────────────────────────────────
  // Prefer facts.lastLineupSave (already resolved by assembler) then fall back to event scan
  const lastLineupEventAt =
    facts.lastLineupSave?.occurredAt ??
    latestOccurredAt(myEvents.filter((e) => e.eventType === 'lineup_saved'))

  const lastWaiverEventAt = latestOccurredAt(
    myEvents.filter(
      (e) =>
        e.eventType === 'waiver_claim_created' || e.eventType === 'waiver_claim_processed',
    ),
  )

  // trade_accepted / trade_rejected carry managerId: null (receiver unresolved in Phase 5.1)
  const lastTradeEventAt = latestOccurredAt(
    myEvents.filter((e) => e.eventType === 'trade_created'),
  )

  const lastDraftEventAt = latestOccurredAt(
    myEvents.filter((e) => e.eventType === 'draft_pick_made'),
  )

  // ── Dimension scores ──────────────────────────────────────────────────────
  const lineupResult = scoreFromThresholds(facts.lineupSaveCount, LINEUP_THRESHOLDS)

  const waiverBase = scoreFromThresholds(facts.waiverClaimCount, WAIVER_THRESHOLDS)
  const waiverScore = Math.min(100, waiverBase.score + (facts.waiverSuccessCount > 0 ? 5 : 0))
  const waiverResult = { score: waiverScore, level: waiverBase.level }

  const tradeBase = scoreFromThresholds(facts.tradeProposalCount, TRADE_THRESHOLDS)
  const tradeScore = Math.min(100, tradeBase.score + (facts.tradeAcceptedCount > 0 ? 5 : 0))
  const tradeResult = { score: tradeScore, level: tradeBase.level }

  const draftResult = scoreFromThresholds(facts.draftPickCount, DRAFT_THRESHOLDS)

  // ── Composite score ───────────────────────────────────────────────────────
  const overallEngagementScore = Math.min(
    100,
    Math.round(
      lineupResult.score * 0.4 +
      waiverResult.score * 0.25 +
      tradeResult.score * 0.25 +
      draftResult.score * 0.1,
    ),
  )

  // ── Inactivity ────────────────────────────────────────────────────────────
  const lastActivityDate = facts.lastActivity
    ? new Date(facts.lastActivity.occurredAt)
    : null

  const daysSinceLastActivity: number | null = lastActivityDate
    ? Math.floor((now.getTime() - lastActivityDate.getTime()) / 86_400_000)
    : null

  const isInactive =
    facts.eventCount === 0 ||
    daysSinceLastActivity === null ||
    daysSinceLastActivity > 14

  const inactivityWarning: string | null = (() => {
    if (daysSinceLastActivity === null) {
      return 'No recorded manager activity — they may have never engaged with the league'
    }
    if (daysSinceLastActivity > 28) {
      return 'Manager has been inactive for over 4 weeks — high risk of abandoning the league'
    }
    if (daysSinceLastActivity > 14) {
      return 'Manager has been inactive for over 2 weeks — consider reaching out'
    }
    return null
  })()

  // ── Participation tier ────────────────────────────────────────────────────
  const participationTier = computeParticipationTier(facts, overallEngagementScore)

  // ── Retention risk ────────────────────────────────────────────────────────
  const { risk: retentionRisk, reasons: retentionRiskReasons } = computeRetentionRisk(
    facts,
    daysSinceLastActivity,
    participationTier,
    events.length,
  )

  // ── Nudges ────────────────────────────────────────────────────────────────
  const nudges = computeNudges(facts, daysSinceLastActivity)

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings: string[] = [...facts.warnings]
  if (facts.eventCount > 0 && facts.lineupSaveCount === 0)    warnings.push('no_lineup_save_events')
  if (facts.eventCount > 0 && facts.waiverClaimCount === 0)   warnings.push('no_waiver_claim_events')
  if (facts.eventCount > 0 && facts.tradeProposalCount === 0) warnings.push('no_trade_proposal_events')
  if (facts.draftPickCount === 0)                             warnings.push('no_draft_pick_events')

  // ── Dimension objects ─────────────────────────────────────────────────────
  const lineupEngagement: ManagerEngagementDimension = {
    score: lineupResult.score,
    level: lineupResult.level,
    eventCount: facts.lineupSaveCount,
    lastEventAt: lastLineupEventAt ?? null,
    warnings: facts.lineupSaveCount === 0 && facts.eventCount > 0 ? ['no_lineup_saves'] : [],
  }

  const waiverEngagement: ManagerEngagementDimension = {
    score: waiverResult.score,
    level: waiverResult.level,
    eventCount: facts.waiverClaimCount,
    lastEventAt: lastWaiverEventAt,
    warnings: facts.waiverClaimCount === 0 && facts.eventCount > 0 ? ['no_waiver_claims'] : [],
  }

  const tradeEngagement: ManagerEngagementDimension = {
    score: tradeResult.score,
    level: tradeResult.level,
    eventCount: facts.tradeProposalCount,
    lastEventAt: lastTradeEventAt,
    warnings: facts.tradeProposalCount === 0 && facts.eventCount > 0 ? ['no_trade_proposals'] : [],
  }

  const draftEngagement: ManagerEngagementDimension = {
    score: draftResult.score,
    level: draftResult.level,
    eventCount: facts.draftPickCount,
    lastEventAt: lastDraftEventAt,
    warnings: facts.draftPickCount === 0 ? ['no_draft_picks'] : [],
  }

  return {
    managerId,
    leagueId,
    participationTier,
    retentionRisk,
    retentionRiskReasons,
    lineupEngagement,
    waiverEngagement,
    tradeEngagement,
    draftEngagement,
    overallEngagementScore,
    daysSinceLastActivity,
    isInactive,
    inactivityWarning,
    nudges,
    completeness: facts.completeness,
    derivedFrom: facts.eventCount,
    lookbackDays: facts.lookbackDays,
    warnings,
    derivedAt: now.toISOString(),
  }
}
