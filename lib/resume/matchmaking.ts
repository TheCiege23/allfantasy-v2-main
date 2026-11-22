/**
 * Phase 6B — Matchmaking compatibility hooks.
 *
 * Given a candidate's `ResumeMatchmakingProfile` and a league's preference
 * profile, return a compatibility score 0..1 + a per-dimension breakdown
 * suitable for "why we matched" UI later.
 */

import type { RankingSport } from "@/lib/ranking/types"
import type { ResumeMatchmakingProfile } from "@/lib/resume/types"
import { MATCHMAKING_WEIGHTS, SCORE_RANGE } from "@/lib/resume/weights"

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return SCORE_RANGE.min
  if (n < SCORE_RANGE.min) return SCORE_RANGE.min
  if (n > SCORE_RANGE.max) return SCORE_RANGE.max
  return n
}

export type LeaguePreferenceProfile = {
  sport: RankingSport
  format: string
  difficultyTarget: number // 0..10000
  desiredActivity: number // 0..1
  desiredReliability: number // 0..1
  desiredCompetitiveness: number // 0..1
}

type MatchmakingBreakdown = {
  ratingProximity: number
  difficultyPreference: number
  formatOverlap: number
  sportOverlap: number
  activityAlignment: number
  reliability: number
}

type MatchmakingResult = {
  compatibility: number
  breakdown: MatchmakingBreakdown
}

function proximityFromBand(target: number, band: [number, number]): number {
  if (target >= band[0] && target <= band[1]) return 1
  const distance = target < band[0] ? band[0] - target : target - band[1]
  const span = Math.max(1, band[1] - band[0])
  return clamp01(1 - distance / (span * 2))
}

export function computeCompatibility(
  candidate: ResumeMatchmakingProfile,
  league: LeaguePreferenceProfile,
  candidateRating: number | null
): MatchmakingResult {
  const ratingProximity =
    candidateRating == null
      ? 0.5
      : clamp01(1 - Math.abs(candidateRating - 5000) / 10_000)

  const difficultyPreference = proximityFromBand(league.difficultyTarget, candidate.preferredDifficultyBand)

  const formatOverlap = candidate.preferredFormats.some(
    (f) => f.toLowerCase() === league.format.toLowerCase()
  )
    ? 1
    : 0

  const sportOverlap = candidate.preferredSports.includes(league.sport) ? 1 : 0

  const activityAlignment = clamp01(1 - Math.abs(candidate.activityScore - league.desiredActivity))

  const reliability = clamp01(1 - Math.abs(candidate.reliabilityScore - league.desiredReliability))

  const breakdown: MatchmakingBreakdown = {
    ratingProximity,
    difficultyPreference,
    formatOverlap,
    sportOverlap,
    activityAlignment,
    reliability,
  }

  const compatibility = clamp01(
    breakdown.ratingProximity * MATCHMAKING_WEIGHTS.ratingProximity +
      breakdown.difficultyPreference * MATCHMAKING_WEIGHTS.difficultyPreference +
      breakdown.formatOverlap * MATCHMAKING_WEIGHTS.formatOverlap +
      breakdown.sportOverlap * MATCHMAKING_WEIGHTS.sportOverlap +
      breakdown.activityAlignment * MATCHMAKING_WEIGHTS.activityAlignment +
      breakdown.reliability * MATCHMAKING_WEIGHTS.reliability
  )

  return { compatibility, breakdown }
}
