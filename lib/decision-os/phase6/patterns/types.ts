/**
 * Decision OS — Phase 6.1 Behavioral Patterns types.
 *
 * Pure types only — no runtime logic, no imports from Phase 5 internals.
 * Consumes Phase 5.1 BehavioralEvent[] directly (the canonical event union).
 */

import type { BehavioralEvent } from '../../behavioral/events/types'

// ── Pattern label registry ───────────────────────────────────────────────────

/** All detectable behavioral pattern types. */
export type BehavioralPatternLabel =
  // Manager-level (sequence within one manager's event history)
  | 'repeated_lineup_indecision'    // 3+ lineup_saved for same week
  | 'waiver_aggression_streak'      // 5+ waiver_claim_created in 21 days
  | 'trade_proposal_spike'          // 4+ trade_created in 14 days
  | 'manager_inactivity_window'     // 30+ days no events while league active
  | 'bench_regret_repetition'       // same player flip-flopped bench↔starter 3+ week-pairs
  | 'injury_response_delay'         // player benched, no waiver for 7d, stays benched
  | 'matchup_overreaction'          // slotChanges >= 4 for 3+ consecutive weeks
  | 'conservative_roster_pattern'   // slotChanges = 0 for 4+ consecutive weeks
  | 'trade_rejection_pattern'       // manager's proposals rejected 3+ times in 30 days
  // League-level (across all managers in the league)
  | 'league_activity_surge'         // event count 2× baseline in 7-day window
  | 'league_activity_dropoff'       // event count < 40% baseline in 14-day window
  | 'commissioner_rules_churn'      // 3+ rules_changed in 21 days

// ── Confidence ───────────────────────────────────────────────────────────────

/** Qualitative confidence for a detected pattern. */
export type PatternConfidence = 'high' | 'medium' | 'low'

// ── Evidence window ──────────────────────────────────────────────────────────

/**
 * A bounded time window containing the events that constitute evidence for
 * a detected pattern. `eventIds` is empty for absence-based patterns (e.g.
 * inactivity — the absence of events is the evidence).
 */
export interface EvidenceWindow {
  /** ISO 8601 — start of the detection window. */
  startedAt: string
  /** ISO 8601 — end of the detection window. */
  endedAt: string
  /** Calendar days spanned (rounded). */
  durationDays: number
  /** `eventId` strings of the events constituting this evidence. Empty for absence patterns. */
  eventIds: string[]
  /** One-line human-readable description of what was observed in this window. */
  summary: string
}

// ── Detected pattern ─────────────────────────────────────────────────────────

/** A single detected behavioral pattern with full provenance. */
export interface DetectedPattern {
  patternType: BehavioralPatternLabel
  /** Qualitative confidence: how strongly the evidence supports the pattern. */
  confidence: PatternConfidence
  /** Number of distinct windows in which this pattern was detected. */
  occurrenceCount: number
  /** ISO 8601 — first evidence window start. */
  firstDetectedAt: string
  /** ISO 8601 — last evidence window end. */
  lastDetectedAt: string
  /** Evidence windows, each carrying the specific events that triggered the detection. */
  evidenceWindows: EvidenceWindow[]
  /** Step-by-step derivation: signals examined, thresholds compared, conclusion. */
  derivation: string[]
  /** Pattern-specific warnings (e.g. proxy detection, timestamp uncertainty). */
  warnings: string[]
}

// ── Manager pattern group ────────────────────────────────────────────────────

/** All patterns detected for a single manager within this league. */
export interface ManagerPatternGroup {
  /** Canonical AllFantasy manager ID. */
  managerId: string
  /** Detected patterns, in detection order (manager-level patterns only). */
  patterns: DetectedPattern[]
}

// ── Input / Output ───────────────────────────────────────────────────────────

/**
 * Input to the Phase 6.1 behavioral pattern detector.
 * Pass the raw `BehavioralEvent[]` stream for the league.
 * Events need not be sorted — the detector sorts a defensive copy.
 */
export interface BehavioralPatternInput {
  /** Canonical AllFantasy league ID. */
  leagueId: string
  /**
   * All behavioral events for this league. May be unsorted, may contain events
   * with null managerId (system events), may span any time range.
   * The detector NEVER mutates this array.
   */
  events: BehavioralEvent[]
  /**
   * Optional hint for the analysis window in days. Default 90.
   * Informational only — the detector operates on all provided events.
   */
  analysisWindowDays?: number
}

/**
 * Output of the Phase 6.1 behavioral pattern detector.
 *
 * Pure: produced without IO, DB, or AI.
 * Deterministic: same inputs → same output.
 * Version-stamped: all outputs carry `version` for auditability.
 */
export interface BehavioralPatternResult {
  leagueId: string
  /** Per-manager detected patterns (managers with no patterns are excluded). */
  managerPatterns: ManagerPatternGroup[]
  /** League-wide patterns (detected across all managers). */
  leaguePatterns: DetectedPattern[]
  /** Total events analyzed (includes system events). */
  totalEventsAnalyzed: number
  /** The analysisWindowDays hint used (90 if not provided). */
  analysisWindowDays: number
  /** ISO 8601 — earliest `occurredAt` in the input stream. Null if no events. */
  earliestEventAt: string | null
  /** ISO 8601 — latest `occurredAt` in the input stream. Null if no events. */
  latestEventAt: string | null
  /**
   * Detection-level warnings (not pattern-specific).
   * E.g. 'insufficient_events', timestamp confidence issues.
   */
  warnings: string[]
  /** Pattern detection logic version — '6.1.0'. Bump when thresholds or logic change. */
  version: string
}
