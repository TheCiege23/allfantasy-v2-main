/**
 * Phase 6F — Smart discovery rails.
 *
 * Pure ranking / selection helpers that take a pool of leagues
 * (and the candidate's own profile) and return curated rails for the
 * Find League surface. Each rail has a strict cap and a minimum fit
 * threshold to keep results trustworthy.
 *
 * No I/O. Caller supplies the candidate pool fetched via
 * `lib/resume/snapshot/matchmaking-lookup` or future league-index
 * lookups.
 */

import { scoreLeagueFit } from "./compatibility"
import { DISCOVERY_RAIL_CAPS } from "./weights"
import type { LeagueDescriptor, LeagueFitCandidate, LeagueRecommendation } from "./types"

/** Convenience: top-level recommendations across rails. */
export function topRecommendations(
  candidate: LeagueFitCandidate,
  leagues: ReadonlyArray<LeagueDescriptor>,
  limit = 5
): LeagueRecommendation[] {
  const scored = leagues
    .map((l) => ({ league: l, score: scoreLeagueFit(candidate, l) }))
    .filter((r) => !r.score.hardRejected && r.score.score >= DISCOVERY_RAIL_CAPS.minFitToInclude)
  scored.sort((a, b) => b.score.score - a.score.score)
  return scored.slice(0, Math.max(1, limit)).map((r) => ({
    league: r.league,
    score: r.score,
    railKind: "best_fit_for_you",
  }))
}
