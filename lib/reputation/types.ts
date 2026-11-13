/**
 * Phase 6K — Reputation system types.
 *
 * Intentionally kept separate from the manager-level ReputationEngine
 * (lib/reputation-engine) which handles per-league per-season manager trust.
 * This module handles league-level + commissioner-level prestige aggregation.
 */

// ── Tiers ─────────────────────────────────────────────────────────────────────

export const LEAGUE_PRESTIGE_TIERS = [
  'legendary',
  'elite',
  'established',
  'standard',
  'new_league',
  'flagged',
] as const
export type LeaguePrestigeTier = (typeof LEAGUE_PRESTIGE_TIERS)[number]

export const COMMISSIONER_PRESTIGE_TIERS = [
  'legendary',
  'elite',
  'trusted',
  'standard',
  'new_commissioner',
  'flagged',
] as const
export type CommissionerPrestigeTier = (typeof COMMISSIONER_PRESTIGE_TIERS)[number]

// ── Tier thresholds ───────────────────────────────────────────────────────────

// ── Anti-abuse constants ──────────────────────────────────────────────────────

// ── Score shapes ──────────────────────────────────────────────────────────────

export interface CommissionerPrestigeRecord {
  id: string
  commissionerId: string
  reliabilityScore: number | null
  fairnessScore: number | null
  inviteAcceptanceRate: number | null
  retentionScore: number | null
  overallScore: number | null
  tier: CommissionerPrestigeTier
  verified: boolean
  totalLeaguesCommissioned: number
  totalSeasonsCommissioned: number
  activeLeagueCount: number
  disputeRate: number | null
  inactivityPenalty: number | null
  lastComputedAt: Date
  updatedAt: Date
}

export interface LeagueReputationRecord {
  id: string
  leagueId: string
  completionRate: number | null
  retentionRate: number | null
  stabilityScore: number | null
  longevityScore: number | null
  competitivenessScore: number | null
  overallScore: number | null
  tier: LeaguePrestigeTier
  verifiedLeague: boolean
  totalSeasons: number
  abandonedSeasons: number
  lastComputedAt: Date
  updatedAt: Date
}

