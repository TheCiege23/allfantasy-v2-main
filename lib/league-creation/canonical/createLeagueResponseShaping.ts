/**
 * Shared response shaping for native league creation — legacy clients expect `league.name`;
 * canonical API uses `league.leagueName`.
 */

import type { CreateLeagueSuccessResponse } from '@/lib/league-creation/canonical/types'

/** Extended league object for POST /api/league/create compatibility + canonical fields. */
type LegacyLeagueCreateSuccessJson = {
  success: true
  league: {
    id: string
    /** Legacy alias used by older clients */
    name: string
    leagueName: string
    sport: string
    teamCount: number
    draftType: string
    concept: string
    scoringPreset: string
    status: string
    presetKey: string
  }
  homepageUrl?: string
  warnings?: CreateLeagueSuccessResponse['warnings']
  /** Set when served from deprecated route for debugging; do not branch production logic on this. */
  createdVia?: 'canonical_pipeline'
}

export function mapCanonicalSuccessToLegacyLeagueCreateResponse(
  canonical: CreateLeagueSuccessResponse,
  options?: { createdVia?: 'canonical_pipeline' }
): LegacyLeagueCreateSuccessJson {
  const ln = canonical.league.leagueName
  return {
    success: true,
    league: {
      id: canonical.league.id,
      name: ln,
      leagueName: ln,
      sport: canonical.league.sport,
      teamCount: canonical.league.teamCount,
      draftType: canonical.league.draftType,
      concept: canonical.league.concept,
      scoringPreset: canonical.league.scoringPreset,
      status: canonical.league.status,
      presetKey: canonical.league.presetKey,
    },
    homepageUrl: canonical.homepageUrl,
    warnings: canonical.warnings,
    ...(options?.createdVia ? { createdVia: options.createdVia } : {}),
  }
}
