/**
 * SportSearchFilterResolver — sport filter for search (NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, Soccer).
 * Used when search results or quick actions can be scoped by sport.
 */

import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import { getSportLabel } from "@/lib/multi-sport/SportSelectorUIService"

export type SportFilterValue = string | null
export const ALL_SPORT_SEARCH_FILTER = "ALL" as const

export interface SportFilterOption {
  value: typeof ALL_SPORT_SEARCH_FILTER | string
  label: string
}

export function getSportSearchFilterOptions(): SportFilterOption[] {
  return [
    { value: ALL_SPORT_SEARCH_FILTER, label: "All sports" },
    ...SUPPORTED_SPORTS.map((sport) => ({ value: sport, label: getSportLabel(sport) })),
  ]
}

/** Resolve sport filter from query or selection; null = all. */
export function resolveSportFilter(value: SportFilterValue): SportFilterValue {
  if (!value || value.toUpperCase() === "ALL") return null
  const upper = value.trim().toUpperCase()
  return SUPPORTED_SPORTS.includes(upper as any) ? upper : null
}

/** Whether to show sport filter in search UI (e.g. when searching players/leagues). */
export function shouldShowSportFilter(resultCategory: string): boolean {
  return resultCategory === "player" || resultCategory === "league"
}
