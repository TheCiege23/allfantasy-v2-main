/**
 * SportAIResolver — sport-aware context for AI prompts and routing.
 * Single source: lib/sport-scope.ts (NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer).
 */

import {
  SUPPORTED_SPORTS,
  normalizeToSupportedSport,
  isSupportedSport,
  DEFAULT_SPORT,
} from "@/lib/sport-scope"
import type { LeagueSport } from "@prisma/client"

const SPORT_LABELS: Record<string, string> = {
  NFL: "NFL / Fantasy Football",
  NHL: "NHL / Fantasy Hockey",
  NBA: "NBA / Fantasy Basketball",
  MLB: "MLB / Fantasy Baseball",
  NCAAB: "NCAA Basketball",
  NCAAF: "NCAA Football",
  SOCCER: "Soccer",
}

/**
 * All sports the AI layer must support (from sport-scope).
 */
export function getSupportedSportsForAI(): LeagueSport[] {
  return [...SUPPORTED_SPORTS]
}

/**
 * Normalize sport for AI context (always one of the seven).
 */
export function resolveSportForAI(sport: string | null | undefined): LeagueSport {
  return normalizeToSupportedSport(sport)
}

/**
 * Human-readable sport label for prompts.
 */
export function getSportLabelForPrompt(sport: string): string {
  const n = normalizeToSupportedSport(sport)
  return SPORT_LABELS[n] ?? n
}

export { isSupportedSport, DEFAULT_SPORT }
