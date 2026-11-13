/**
 * SportLegacyResolver — sport normalization and display for Legacy Score Engine.
 */

import { isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'

export function normalizeSportForLegacy(sport: string | null | undefined): string {
  return normalizeToSupportedSport(sport)
}

export function isSupportedLegacySport(sport: string | null | undefined): sport is LeagueSport {
  return isSupportedSport(sport)
}

const LEGACY_SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAF: 'NCAA Football',
  NCAAB: 'NCAA Basketball',
  SOCCER: 'Soccer',
}

export function getLegacySportLabel(sport: string): string {
  return LEGACY_SPORT_LABELS[sport] ?? sport
}
