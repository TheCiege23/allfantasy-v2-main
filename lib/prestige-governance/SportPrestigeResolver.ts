/**
 * SportPrestigeResolver — single sport normalization and labels for the prestige/governance layer.
 * Ensures reputation, Hall of Fame, and legacy comparisons respect sport context (NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER).
 */

import {
  isSupportedSport,
  normalizeToSupportedSport,
  SUPPORTED_SPORTS,
  type SupportedSport,
} from '@/lib/sport-scope'

export const PRESTIGE_SUPPORTED_SPORTS: readonly SupportedSport[] = SUPPORTED_SPORTS

export function normalizeSportForPrestige(sport: string | null | undefined): SupportedSport {
  return normalizeToSupportedSport(sport)
}

export function isSupportedPrestigeSport(sport: string | null | undefined): sport is SupportedSport {
  return isSupportedSport(sport)
}

const PRESTIGE_SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAF: 'NCAA Football',
  NCAAB: 'NCAA Basketball',
  SOCCER: 'Soccer',
}

export function getPrestigeSportLabel(sport: string): string {
  return PRESTIGE_SPORT_LABELS[sport] ?? sport
}
