/**
 * Phase 6F — League-fit compatibility engine.
 *
 * Pure scoring: given a candidate + league descriptor, return a
 * `LeagueFitScore` with per-dimension breakdown, confidence, rationale,
 * and (if the commissioner preferences are violated) a hardReject flag.
 *
 * Composition:
 *   - Re-uses the lower-level `computeCompatibility` primitive from
 *     `lib/resume/matchmaking` for the 6 shared dimensions, then adds
 *     4 new league-fit-specific dimensions
 *     (competitivenessAlignment, commissionerFit, credibilityFit,
 *     leagueTypeOverlap).
 *   - Applies commissioner-preference gating *after* scoring so the
 *     rationale string can explain a hard reject too.
 *
 * Deterministic, side-effect-free, sport-agnostic.
 */

import { computeCompatibility, type LeaguePreferenceProfile } from "@/lib/resume/matchmaking"
import type { ResumeMatchmakingProfile } from "@/lib/resume/types"
import {
  COMMISSIONER_REJECT_BUFFER,
  FIT_CONFIDENCE,
  LEAGUE_FIT_WEIGHTS,
} from "./weights"
import type {
  CommissionerPreferences,
  LeagueDescriptor,
  LeagueFitBreakdown,
  LeagueFitCandidate,
  LeagueFitScore,
} from "./types"

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function defaultProfile(): ResumeMatchmakingProfile {
  return {
    userId: "",
    preferredSports: [],
    preferredFormats: [],
    preferredDifficultyBand: [4000, 6000],
    activityScore: 0.5,
    reliabilityScore: 0.5,
    socialAffinity: 0.5,
    competitivenessIndex: 0.5,
  }
}

function bandFit(value: number, band: [number, number] | null | undefined): number {
  if (!band) return 0.5
  if (value >= band[0] && value <= band[1]) return 1
  const distance = value < band[0] ? band[0] - value : value - band[1]
  const span = Math.max(1, band[1] - band[0])
  return clamp01(1 - distance / (span * 2))
}

function pickDimension(
  breakdown: LeagueFitBreakdown,
  cmp: (a: number, b: number) => boolean
): keyof LeagueFitBreakdown | null {
  let best: keyof LeagueFitBreakdown | null = null
  let bestVal: number | null = null
  for (const key of Object.keys(breakdown) as Array<keyof LeagueFitBreakdown>) {
    const v = breakdown[key]
    if (bestVal === null || cmp(v, bestVal)) {
      bestVal = v
      best = key
    }
  }
  return best
}

function buildRationale(
  breakdown: LeagueFitBreakdown,
  strongest: keyof LeagueFitBreakdown | null,
  hardReject: boolean,
  rejectReason: string | null
): string {
  if (hardReject && rejectReason) return rejectReason
  if (!strongest) return "Limited signal — fit is approximate."
  const v = breakdown[strongest]
  if (v < 0.5) return "Mixed fit; no single strong alignment."
  switch (strongest) {
    case "ratingProximity":
      return "Skill rating sits in the league's expected band."
    case "difficultyFit":
      return "League difficulty matches your preferred band."
    case "formatOverlap":
      return "Scoring format matches one of your preferred formats."
    case "sportOverlap":
      return "Sport is one you actively play."
    case "activityAlignment":
      return "Activity expectations align with how you play."
    case "reliabilityAlignment":
      return "Reliability profile clears the league's bar."
    case "competitivenessAlignment":
      return "Competitiveness target matches your style."
    case "commissionerFit":
      return "Commissioner's published preferences match your profile."
    case "credibilityFit":
      return "Credibility meets or exceeds the league's minimum."
    case "leagueTypeOverlap":
      return "League type matches your preferred formats."
    default:
      return "Strong overall match."
  }
}

function evaluatePreferences(
  candidate: LeagueFitCandidate,
  prefs: CommissionerPreferences | null | undefined
): { ok: true } | { ok: false; reason: string } {
  if (!prefs) return { ok: true }
  if (prefs.verifiedOnly && !candidate.verified) {
    return { ok: false, reason: "League requires a verified resume." }
  }
  if (
    prefs.credibilityMin != null &&
    candidate.credibilityScore + COMMISSIONER_REJECT_BUFFER < prefs.credibilityMin
  ) {
    return { ok: false, reason: "Credibility below the league's minimum." }
  }
  const p = candidate.profile
  if (p) {
    if (
      prefs.activityMin != null &&
      p.activityScore + COMMISSIONER_REJECT_BUFFER < prefs.activityMin
    ) {
      return { ok: false, reason: "Activity below the league's minimum." }
    }
    if (
      prefs.competitivenessMin != null &&
      p.competitivenessIndex + COMMISSIONER_REJECT_BUFFER < prefs.competitivenessMin
    ) {
      return { ok: false, reason: "Competitiveness below the league's minimum." }
    }
  }
  return { ok: true }
}

function commissionerFitScore(prefs: CommissionerPreferences | null | undefined, candidate: LeagueFitCandidate): number {
  if (!prefs) return 0.5
  const parts: number[] = []
  if (prefs.credibilityMin != null) {
    parts.push(candidate.credibilityScore >= prefs.credibilityMin ? 1 : 0)
  }
  const p = candidate.profile
  if (p) {
    if (prefs.activityMin != null) {
      parts.push(p.activityScore >= prefs.activityMin ? 1 : 0)
    }
    if (prefs.competitivenessMin != null) {
      parts.push(p.competitivenessIndex >= prefs.competitivenessMin ? 1 : 0)
    }
  }
  if (prefs.verifiedOnly != null) {
    parts.push(prefs.verifiedOnly ? (candidate.verified ? 1 : 0) : 1)
  }
  if (parts.length === 0) return 0.5
  return parts.reduce((a, b) => a + b, 0) / parts.length
}

function leagueTypeOverlap(
  candidate: LeagueFitCandidate,
  league: LeagueDescriptor
): number {
  const p = candidate.profile
  if (!p) return 0.5
  const prefs = p.preferredFormats.map((f) => f.toLowerCase())
  const wanted = (
    league.commissionerPreferences?.preferredLeagueTypes ?? [league.leagueType]
  ).map((t) => t.toLowerCase())
  if (prefs.length === 0 || wanted.length === 0) return 0.5
  const hit = wanted.some((w) => prefs.includes(w))
  return hit ? 1 : 0
}

/**
 * Score one candidate against one league. Pure function — safe to call
 * inside tight ranking loops.
 */
export function scoreLeagueFit(
  candidate: LeagueFitCandidate,
  league: LeagueDescriptor
): LeagueFitScore {
  const profile = candidate.profile ?? defaultProfile()
  const leaguePref: LeaguePreferenceProfile = {
    sport: league.sport,
    format: league.format,
    difficultyTarget: league.difficulty,
    desiredActivity: league.desiredActivity,
    desiredReliability: league.desiredReliability,
    desiredCompetitiveness: league.desiredCompetitiveness,
  }

  const base = computeCompatibility(profile, leaguePref, candidate.overallRating)

  const competitivenessAlignment = clamp01(
    1 - Math.abs(profile.competitivenessIndex - league.desiredCompetitiveness)
  )
  const commissionerFit = commissionerFitScore(
    league.commissionerPreferences ?? null,
    candidate
  )
  const credibilityFit = clamp01(candidate.credibilityScore)
  const ltOverlap = leagueTypeOverlap(candidate, league)
  const difficultyFit = bandFit(league.difficulty, profile.preferredDifficultyBand)

  const breakdown: LeagueFitBreakdown = {
    ratingProximity: base.breakdown.ratingProximity,
    difficultyFit,
    formatOverlap: base.breakdown.formatOverlap,
    sportOverlap: base.breakdown.sportOverlap,
    activityAlignment: base.breakdown.activityAlignment,
    reliabilityAlignment: base.breakdown.reliability,
    competitivenessAlignment,
    commissionerFit,
    credibilityFit,
    leagueTypeOverlap: ltOverlap,
  }

  let score = 0
  for (const key of Object.keys(LEAGUE_FIT_WEIGHTS) as Array<keyof LeagueFitBreakdown>) {
    score += breakdown[key] * LEAGUE_FIT_WEIGHTS[key]
  }
  score = clamp01(score)

  // Confidence — decays per missing input.
  let confidence = 1
  if (!candidate.profile) confidence -= FIT_CONFIDENCE.missingProfilePenalty
  if (candidate.overallRating == null) confidence -= FIT_CONFIDENCE.missingRatingPenalty
  if (!candidate.verified) confidence -= FIT_CONFIDENCE.unverifiedPenalty
  if (league.commissionerCredibility == null) {
    confidence -= FIT_CONFIDENCE.unknownCommissionerPenalty
  }
  confidence = Math.max(FIT_CONFIDENCE.floor, clamp01(confidence))

  const decision = evaluatePreferences(candidate, league.commissionerPreferences ?? null)
  const hardRejected = !decision.ok
  const rejectReason = decision.ok ? null : decision.reason

  const strongest = pickDimension(breakdown, (a, b) => a > b)
  const weakest = pickDimension(breakdown, (a, b) => a < b)
  const rationale = buildRationale(breakdown, strongest, hardRejected, rejectReason)

  return {
    score: hardRejected ? 0 : score,
    confidence,
    strongestDimension: strongest,
    weakestDimension: weakest,
    rationale,
    hardRejected,
    breakdown,
  }
}

/**
 * Score one candidate against many leagues — used by user-facing
 * "Find League" rails.
 */
export function rankLeaguesForCandidate(
  candidate: LeagueFitCandidate,
  leagues: ReadonlyArray<LeagueDescriptor>,
  limit = 10
): Array<{ league: LeagueDescriptor; score: LeagueFitScore }> {
  const scored = leagues
    .map((l) => ({ league: l, score: scoreLeagueFit(candidate, l) }))
    .filter((r) => !r.score.hardRejected)
  scored.sort((a, b) => b.score.score - a.score.score)
  return scored.slice(0, Math.max(1, Math.min(limit, leagues.length)))
}
