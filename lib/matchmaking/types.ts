/**
 * Phase 6F — Matchmaking + League-Fit type contracts.
 *
 * Wraps the existing per-candidate primitive
 * (`lib/resume/matchmaking.computeCompatibility`) into the higher-level
 * "Find League 2.0" surface contracts:
 *
 *   - LeagueDescriptor / CommissionerPreferences: inputs.
 *   - LeagueFitBreakdown / LeagueFitScore: scoring outputs.
 *   - LeagueRecommendation / UserRecommendation / CommissionerSuggestion: DTOs.
 *   - DiscoveryRailKind / DiscoveryRail: rail catalogue.
 *   - MatchmakingTelemetryEvent: tracking contract.
 *
 * Hard rules:
 *   - Types only. No I/O. No serialization. No UI.
 *   - All DTOs are anonymity-safe: username is always `string | null`.
 *   - All scores live in `[0, 1]` unless explicitly noted.
 *   - Every recommendation surfaces a `confidence` 0..1 plus a short
 *     rationale string suitable for compact UI badges.
 */

import type { RankingSport } from "@/lib/ranking/types"
import type { ResumeMatchmakingProfile } from "@/lib/resume/types"

/* -------------------------------------------------------------------------- */
/* League descriptor                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Compact, sport-agnostic shape used for league-fit scoring. Built from
 * existing league settings + the league-difficulty engine downstream;
 * this module never reads from Prisma directly.
 */
export interface LeagueDescriptor {
  leagueId: string
  name: string | null
  sport: RankingSport
  /** e.g. "redraft" | "dynasty" | "keeper" | "best_ball" | "salary_cap". */
  leagueType: string
  /** Scoring format, e.g. "PPR" | "Half-PPR" | "Standard" | "Categories". */
  format: string
  /** 0..10000 difficulty estimate from the league-difficulty engine. */
  difficulty: number
  /** 0..1 — expected per-member weekly activity. */
  desiredActivity: number
  /** 0..1 — expected reliability bar. */
  desiredReliability: number
  /** 0..1 — competitiveness target. */
  desiredCompetitiveness: number
  /** Commissioner's published preferences (optional). */
  commissionerPreferences?: CommissionerPreferences | null
  /** Open seats remaining. `null` if unknown. */
  openSeats: number | null
  /** Verified commissioner badge. */
  commissionerVerified: boolean
  /** Optional commissioner credibility score 0..1 for chip rendering. */
  commissionerCredibility: number | null
  // ── Phase 6L: Reputation enrichment (optional — missing = not yet computed) ─
  /** League prestige tier from LeagueReputation (e.g. "elite", "established"). */
  leaguePrestigeTier?: string | null
  /** Total seasons this league has run. */
  leagueTotalSeasons?: number | null
  /** True when league has been verified by the platform. */
  leagueVerified?: boolean
}

/* -------------------------------------------------------------------------- */
/* Commissioner preferences                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Lightweight preferences a commissioner publishes for matchmaking.
 * Every field is optional — unspecified = "no preference" and the
 * compatibility engine skips it.
 */
export interface CommissionerPreferences {
  /** Minimum competitiveness 0..1. */
  competitivenessMin?: number | null
  /** Minimum desired activity 0..1. */
  activityMin?: number | null
  /** Minimum credibility score 0..1. */
  credibilityMin?: number | null
  /** Preferred difficulty band [lo, hi] in 0..10000. */
  difficultyBand?: [number, number] | null
  /** Preferred league types (e.g. ["dynasty","keeper"]). */
  preferredLeagueTypes?: string[] | null
  /** Restrict to verified resumes only. */
  verifiedOnly?: boolean | null
}

/* -------------------------------------------------------------------------- */
/* Fit scoring                                                                */
/* -------------------------------------------------------------------------- */

/** Per-dimension league-fit breakdown. Each value in [0, 1]. */
export interface LeagueFitBreakdown {
  ratingProximity: number
  difficultyFit: number
  formatOverlap: number
  sportOverlap: number
  activityAlignment: number
  reliabilityAlignment: number
  competitivenessAlignment: number
  commissionerFit: number
  credibilityFit: number
  leagueTypeOverlap: number
}

/** Final league-fit score for one (candidate, league) pair. */
export interface LeagueFitScore {
  /** Aggregate 0..1. */
  score: number
  /** Confidence in the score itself, 0..1. Falls when inputs are sparse. */
  confidence: number
  /** Strongest contributing dimension key. */
  strongestDimension: keyof LeagueFitBreakdown | null
  /** Weakest dimension that could disqualify the match. */
  weakestDimension: keyof LeagueFitBreakdown | null
  /** Concise human-readable reason, <= 80 chars. */
  rationale: string
  /** Hard reject? Set when a commissioner preference is violated. */
  hardRejected: boolean
  /** Per-dimension scores. */
  breakdown: LeagueFitBreakdown
}

/* -------------------------------------------------------------------------- */
/* Recommendation DTOs                                                        */
/* -------------------------------------------------------------------------- */

/** Recommended league shown to a candidate user. */
export interface LeagueRecommendation {
  league: LeagueDescriptor
  score: LeagueFitScore
  /** Optional rail this rec belongs to. */
  railKind?: DiscoveryRailKind | null
}

/* -------------------------------------------------------------------------- */
/* Discovery rails                                                            */
/* -------------------------------------------------------------------------- */

type DiscoveryRailKind =
  | "best_fit_for_you"
  | "high_competition"
  | "commissioner_verified"
  | "rising_competitors"
  | "dynasty_experts"
  | "tournament_specialists"

/** A single rail of recommendations. */
export interface DiscoveryRail {
  kind: DiscoveryRailKind
  title: string
  description: string
  /** Recommendations in display order. Server caps `<= 10` per rail. */
  items: LeagueRecommendation[]
}

/* -------------------------------------------------------------------------- */
/* Telemetry                                                                  */
/* -------------------------------------------------------------------------- */

type MatchmakingTelemetryKind =
  | "recommendation_viewed"
  | "recommendation_ignored"
  | "league_join_accepted"
  | "commissioner_invite_sent"
  | "commissioner_invite_accepted"
  | "compatibility_success"

/** Tracking-friendly event. No PII. */
interface MatchmakingTelemetryEvent {
  kind: MatchmakingTelemetryKind
  /** Hashed user id / opaque correlation id. Never raw email. */
  actorId: string
  leagueId?: string | null
  /** Hashed target user id (for commissioner-side events). */
  targetUserId?: string | null
  railKind?: DiscoveryRailKind | null
  /** Fit score at the time of the event, if applicable. */
  fitScore?: number | null
  /** UTC ms epoch. */
  occurredAt: number
}

/** Recorder contract — implementations live in app/edge code. */
export interface MatchmakingTelemetryRecorder {
  record(event: MatchmakingTelemetryEvent): Promise<void> | void
}

/* -------------------------------------------------------------------------- */
/* Candidate input                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Minimal candidate shape required by the league-fit engine. Built from
 * `lib/resume/snapshot/matchmaking-lookup.MatchmakingCandidate` upstream.
 */
export interface LeagueFitCandidate {
  userId: string
  overallRating: number | null
  topSport: RankingSport | string | null
  archetypeLabel: string | null
  credibilityScore: number
  /** May be null when the resume composer has not attached one yet. */
  profile: ResumeMatchmakingProfile | null
  /** Verified resume? Mirrors `ResumePublicCard.verified`. */
  verified: boolean
}
