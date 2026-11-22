/**
 * World Cup live score provider abstraction (orthogonal to WorldCupDataProvider teams/fixtures).
 *
 * Capability matrix entries are maintained alongside docs/world-cup-live-score-providers.md.
 */

import type { WorldCupMatchStatus } from "../types"

/** Canonical IDs used in registry + env WORLD_CUP_LIVE_PROVIDER_CHAIN */
export type WorldCupLiveProviderId =
  | "api_sports"
  | "thesportsdb"
  | "reality_sports"
  | "clear_sports"
  | "manual"

/** Unified shape consumed by UI sync — all adapters normalize toward this. */
export type NormalizedWorldCupLiveMatch = {
  /** Internal bracket row id when pre-resolved (optional) */
  matchId?: string | null
  providerMatchId: string
  homeTeamName: string
  awayTeamName: string
  homeTeamId: string | null
  awayTeamId: string | null
  homeScore: number | null
  awayScore: number | null
  status: WorldCupMatchStatus
  minute: number | null
  period: string | null
  startsAt: string | null
  /** Provider-side winner team id (opaque string, usually numeric id as string) */
  winnerTeamId: string | null
  winnerTeamName: string | null
  penaltyHomeScore: number | null
  penaltyAwayScore: number | null
  /** Raw short code from provider (FT, PEN, 2H, HT, …) */
  apiStatusShort: string | null
  /** Injury time minute (+N), when provider supplies it */
  injuryTime?: number | null
  homeTeamLogo?: string | null
  awayTeamLogo?: string | null
  raw?: unknown
}

/** Recommended primary + fallback order (manual always available last). */
export const WORLD_CUP_LIVE_PROVIDER_DEFAULT_CHAIN: WorldCupLiveProviderId[] = [
  "api_sports",
  "thesportsdb",
  "reality_sports",
  "clear_sports",
  "manual",
]

export interface WorldCupLiveScoreAdapter {
  readonly id: WorldCupLiveProviderId
  /** Human-readable for logs */
  readonly label: string
  isConfigured(): boolean
  /** Returns normalized live snapshots for the tournament season year */
  fetchLiveMatches(seasonYear: number): Promise<NormalizedWorldCupLiveMatch[]>
}
