/**
 * Reputation System — types for trust dimensions, tiers, evidence, and config.
 * Supports NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, Soccer.
 */

import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

export const REPUTATION_SPORTS = [...SUPPORTED_SPORTS] as const
export type ReputationSport = (typeof REPUTATION_SPORTS)[number]

/** Configurable reputation tiers (high trust → low trust). */
export const REPUTATION_TIERS = [
  'Legendary',
  'Elite',
  'Trusted',
  'Reliable',
  'Neutral',
  'Risky',
] as const
export type ReputationTier = (typeof REPUTATION_TIERS)[number]

/** Default tier thresholds (overallScore 0–100). Lower score = lower tier. */
export const DEFAULT_REPUTATION_TIER_THRESHOLDS: Record<ReputationTier, { min: number; max?: number }> = {
  Legendary: { min: 90 },
  Elite: { min: 75, max: 89 },
  Trusted: { min: 60, max: 74 },
  Reliable: { min: 45, max: 59 },
  Neutral: { min: 25, max: 44 },
  Risky: { min: 0, max: 24 },
}

/** Evidence types that feed reputation dimensions. */
const REPUTATION_EVIDENCE_TYPES = [
  'payment_complete',
  'lineup_consistency',
  'activity_frequency',
  'trade_accept_rate',
  'trade_fair_offers',
  'commissioner_action_positive',
  'dispute_involved',
  'toxic_flag',
  'abandonment_flag',
  'fair_play',
  'responsiveness',
] as const
export type ReputationEvidenceType = (typeof REPUTATION_EVIDENCE_TYPES)[number]

export interface ReputationScores {
  overallScore: number
  reliabilityScore: number
  activityScore: number
  tradeFairnessScore: number
  sportsmanshipScore: number
  commissionerTrustScore: number
  toxicityRiskScore: number
  participationQualityScore: number
  responsivenessScore: number
}

export interface ReputationScoreWeights {
  reliability: number
  activity: number
  tradeFairness: number
  sportsmanship: number
  commissionerTrust: number
  toxicityRisk: number
  participationQuality: number
  responsiveness: number
}

export interface ReputationRuntimeConfig {
  sport: ReputationSport
  season: number
  tierThresholds: Partial<Record<ReputationTier, { min: number; max?: number }>>
  scoreWeights: Partial<ReputationScoreWeights>
}

export interface ReputationEngineInput {
  leagueId: string
  managerId: string
  sport: string
  season?: number | null
  /** Optional: replace existing record. Default true. */
  replace?: boolean
}

export interface ReputationEngineResult {
  reputationId: string
  managerId: string
  leagueId: string
  sport: string
  season: number
  overallScore: number
  tier: ReputationTier
  dimensionScores: ReputationScores
}
