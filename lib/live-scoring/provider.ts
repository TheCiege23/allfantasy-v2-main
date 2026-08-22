/**
 * Live Scoring — provider boundary (G11 Phase 3b).
 *
 * A concept- and sport-agnostic seam between the orchestrator and whatever supplies
 * live stat data. The orchestrator never talks to a provider directly; a binding
 * composes a `LiveStatsProvider` into the injected `fetchActiveStats`. This keeps
 * the live engine reusable for every concept and lets tests/staging inject a
 * deterministic fixture provider instead of hitting the network.
 */

import { normalizeLiveGameStatus } from '@/lib/live-scoring/cadence'
import type { LiveGameSnapshot, LiveGameStatus } from '@/lib/live-scoring/types'

/** A scheduled/active game with the two team abbreviations, from the schedule source. */
export type LiveGameLite = {
  gameId: string
  homeTeam: string
  awayTeam: string
  status: LiveGameStatus
  startTime: Date | null
}

/**
 * Which slate a week number refers to. Providers that key stats by season type
 * (Sleeper does: `?season_type=pre|regular|post`) need this to fetch the right
 * week — preseason week 1 and regular-season week 1 are different games.
 */
export type LiveSeasonType = 'pre' | 'regular' | 'post'

export type LiveStatsQuery = {
  sport: string
  season: number
  week: number
  /**
   * ⚠ OPTIONAL, AND ABSENT MEANS 'regular' — deliberately, so every existing
   * caller and fixture keeps its current behaviour. Making it required would
   * force a value at call sites that have no way to know one, and a guessed
   * season type silently fetches the wrong slate.
   */
  seasonType?: LiveSeasonType
}

/** Absent season type means the regular season. Single place that decides. */
export function resolveSeasonType(query: { seasonType?: LiveSeasonType }): LiveSeasonType {
  return query.seasonType ?? 'regular'
}

/**
 * Reusable live-stats provider. An implementation supplies the schedule + stat
 * lines for one sport; concepts share it. `fetchPlayerStatsForGames` is scoped to
 * the `playerIds` the caller cares about (rostered players) so we never fetch the
 * whole league — only what could affect a matchup.
 */
export interface LiveStatsProvider {
  /** All games for the sport/season/week (the cadence engine decides which are active). */
  fetchActiveGames(query: LiveStatsQuery): Promise<LiveGameLite[]>
  /** Raw offensive stat lines for the given rostered players whose game is in `games`. */
  fetchPlayerStatsForGames(
    query: LiveStatsQuery & { games: readonly LiveGameLite[]; playerIds: readonly string[] },
  ): Promise<Map<string, Record<string, number>>>
  /** Raw team-defense stat lines keyed by `nfl:def:<TEAM>` for teams playing in `games`. */
  fetchTeamDefenseStatsForGames(
    query: LiveStatsQuery & { games: readonly LiveGameLite[] },
  ): Promise<Map<string, Record<string, number>>>
  /** Normalize the provider's raw game status to the canonical {@link LiveGameStatus}. */
  normalizeGameStatus(raw: string | null | undefined): LiveGameStatus
}

/** Pure: map provider games → orchestrator snapshots. `fractionElapsed` is null
 *  because no provider currently supplies a game clock (documented gap). */
export function gamesToSnapshots(games: readonly LiveGameLite[]): LiveGameSnapshot[] {
  return games.map((g) => ({ gameId: g.gameId, status: g.status, startTime: g.startTime, fractionElapsed: null }))
}

/** The set of team abbreviations playing in the given games (for DEF fetches). */
export function teamsInGames(games: readonly LiveGameLite[]): string[] {
  const set = new Set<string>()
  for (const g of games) {
    if (g.homeTeam) set.add(g.homeTeam.toUpperCase())
    if (g.awayTeam) set.add(g.awayTeam.toUpperCase())
  }
  return [...set]
}

/**
 * Deterministic in-memory provider for tests + staging E2E. No network. Returns
 * exactly the games/stats it was constructed with; `normalizeGameStatus` reuses the
 * canonical normalizer so fixtures behave like the real provider.
 */
export class FixtureLiveStatsProvider implements LiveStatsProvider {
  constructor(
    private readonly fixture: {
      games: LiveGameLite[]
      playerStats?: Map<string, Record<string, number>>
      teamDefenseStats?: Map<string, Record<string, number>>
    },
  ) {}

  async fetchActiveGames(): Promise<LiveGameLite[]> {
    return this.fixture.games
  }

  async fetchPlayerStatsForGames(
    query: LiveStatsQuery & { games: readonly LiveGameLite[]; playerIds: readonly string[] },
  ): Promise<Map<string, Record<string, number>>> {
    const want = new Set(query.playerIds)
    const out = new Map<string, Record<string, number>>()
    for (const [playerId, stats] of this.fixture.playerStats ?? []) {
      if (want.has(playerId)) out.set(playerId, stats)
    }
    return out
  }

  async fetchTeamDefenseStatsForGames(): Promise<Map<string, Record<string, number>>> {
    return new Map(this.fixture.teamDefenseStats ?? [])
  }

  normalizeGameStatus(raw: string | null | undefined): LiveGameStatus {
    return normalizeLiveGameStatus(raw)
  }
}
