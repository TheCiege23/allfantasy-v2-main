/**
 * Phase 6K — Reputation system types.
 *
 * Intentionally kept separate from the manager-level ReputationEngine
 * (lib/reputation-engine) which handles per-league per-season manager trust.
 * This module handles league-level + commissioner-level prestige aggregation.
 */

// ── Tiers ─────────────────────────────────────────────────────────────────────

const LEAGUE_PRESTIGE_TIERS = [
  'legendary',
  'elite',
  'established',
  'standard',
  'new_league',
  'flagged',
] as const
export type LeaguePrestigeTier = (typeof LEAGUE_PRESTIGE_TIERS)[number]

// ── Tier thresholds ───────────────────────────────────────────────────────────

// ── Anti-abuse constants ──────────────────────────────────────────────────────

// ── Score shapes ──────────────────────────────────────────────────────────────

