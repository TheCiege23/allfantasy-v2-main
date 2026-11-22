/**
 * SportCareerResolver — sport normalization and labels for GM economy (career tracking).
 * Uses lib/sport-scope for NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import { isSupportedSport, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

export function normalizeSportForGMCareer(sport: string | null | undefined): SupportedSport {
  return normalizeToSupportedSport(sport)
}

export function isSupportedGMCareerSport(sport: string | null | undefined): sport is SupportedSport {
  return isSupportedSport(sport)
}

