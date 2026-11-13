/**
 * SportHallOfFameResolver — sport-specific normalization and display for Hall of Fame.
 * Supports NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, Soccer.
 */

import { isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'

export function normalizeSportForHallOfFame(sport: string | null | undefined): string {
  return normalizeToSupportedSport(sport)
}

export function isSupportedHallOfFameSport(sport: string | null | undefined): sport is LeagueSport {
  return isSupportedSport(sport)
}

/** Sport display labels for UI. */
export const HOF_SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAF: 'NCAA Football',
  NCAAB: 'NCAA Basketball',
  SOCCER: 'Soccer',
}

export function getHallOfFameSportLabel(sport: string): string {
  return HOF_SPORT_LABELS[sport] ?? sport
}

/** Season cadence hints per sport (for significance logic). */
export function getDefaultSeasonsConsidered(sport: string): number {
  const n = 10
  switch (sport?.toUpperCase()) {
    case 'NFL':
    case 'NBA':
    case 'NHL':
    case 'MLB':
      return n
    case 'NCAAB':
    case 'NCAAF':
      return Math.min(n, 8)
    case 'SOCCER':
      return n
    default:
      return n
  }
}
