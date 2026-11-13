/**
 * SportTradeAnalyzerResolver — sport-specific labels and options for trade analyzer UI.
 */

import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport } from "@/lib/sport-scope"

export function getSportDisplayLabel(sport: string): string {
  const u = normalizeToSupportedSport(sport)
  if (u === "NCAAF") return "NCAA Football"
  if (u === "NCAAB") return "NCAA Basketball"
  if (u === "SOCCER") return "Soccer"
  return u || DEFAULT_SPORT
}

export function getSportOptions(): Array<{ value: string; label: string }> {
  return SUPPORTED_SPORTS.map((s) => ({ value: s, label: getSportDisplayLabel(s) }))
}

