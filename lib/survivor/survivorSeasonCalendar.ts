/**
 * Regular-season scoring week bounds per sport (no fantasy playoffs).
 * Used for Survivor / Exile scheduling UI and soft caps. Commissioners may override via `regularSeasonEndWeek`.
 */

import type { LeagueSport } from '@prisma/client'
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'

/** Last fantasy regular-season week index (1-based), playoffs excluded — approximate industry defaults. */
export const REGULAR_SEASON_END_WEEK_BY_SPORT: Record<LeagueSport, number> = {
  NFL: 14,
  NBA: 25,
  NHL: 28,
  MLB: 26,
  NCAAF: 13,
  NCAAB: 22,
  SOCCER: 34,
}

export function getRegularSeasonEndWeek(
  sport: string | null | undefined,
  override: number | null | undefined,
): number {
  if (override != null && Number.isFinite(override) && override >= 1 && override <= 52) {
    return Math.floor(override)
  }
  const s = normalizeToSupportedSport(sport ?? undefined)
  return REGULAR_SEASON_END_WEEK_BY_SPORT[s] ?? 18
}

export function seasonWeekBoundsForSport(sport: string | null | undefined, override: number | null | undefined) {
  const last = getRegularSeasonEndWeek(sport, override)
  return {
    firstWeek: 1,
    lastWeek: last,
    sport: normalizeToSupportedSport(sport ?? undefined),
    sportsSupported: SUPPORTED_SPORTS,
  }
}
