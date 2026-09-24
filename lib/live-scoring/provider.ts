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
/**
 * A team-defense stat request, optionally narrowed to the defenses somebody owns.
 *
 * 🛑 `teamAbbrs` PRESENT MEANS "EXACTLY THESE", AND AN EMPTY ARRAY MEANS NONE — it does NOT
 * mean "no filter". A season with no rostered defence should cost zero provider calls, and
 * treating empty as unfiltered is the classic version of this bug: it would restore the
 * every-team fetch precisely for the leagues that need none of it.
 *
 * ⚠ WHY THIS EXISTS. The NFL implementation calls Sleeper once PER TEAM, so an unnarrowed
 * request is 32 calls — per season being scored, per tick. Measured on production
 * 2026-09-24, when the first native league advanced a week and gave the tick something to
 * score: 128 calls every two minutes (32 teams x 4 seasons), 3,840/hour against a
 * 1,000/hour cap, and the budget gone by :16. The cap is per PROVIDER, so the visible
 * damage was elsewhere — `stats/nfl/week` went dark and the week finalizer refused on
 * coverage it could not fix.
 *
 * The offensive path next to this one has always narrowed to rostered starters. This is the
 * same idea, applied to the half that was still asking for the whole league.
 */
export type TeamDefenseStatsQuery = LiveStatsQuery & {
  games: readonly LiveGameLite[]
  teamAbbrs?: readonly string[]
}

/**
 * Which team defenses to actually ask for: the teams playing, narrowed to the ones owned.
 *
 * Pure, shared by every provider, so "present but empty means none" cannot drift between
 * implementations.
 */
export function teamDefenseTargets(query: TeamDefenseStatsQuery): string[] {
  const playing = teamsInGames(query.games)
  if (query.teamAbbrs === undefined) return playing
  const wanted = new Set(query.teamAbbrs.map((t) => String(t ?? '').trim().toUpperCase()).filter(Boolean))
  return playing.filter((t) => wanted.has(t))
}

export interface LiveStatsProvider {
  /**
   * The sports this provider can live-score. ABSENT MEANS NFL ONLY — every implementation so far
   * is, and a provider that forgets to declare must fail closed, never open (see
   * `liveProviderServesSport`).
   */
  readonly sports?: readonly string[]
  /** All games for the sport/season/week (the cadence engine decides which are active). */
  fetchActiveGames(query: LiveStatsQuery): Promise<LiveGameLite[]>
  /** Raw offensive stat lines for the given rostered players whose game is in `games`. */
  fetchPlayerStatsForGames(
    query: LiveStatsQuery & { games: readonly LiveGameLite[]; playerIds: readonly string[] },
  ): Promise<Map<string, Record<string, number>>>
  /** Raw team-defense stat lines keyed by `nfl:def:<TEAM>` for teams playing in `games`. */
  fetchTeamDefenseStatsForGames(
    query: TeamDefenseStatsQuery,
  ): Promise<Map<string, Record<string, number>>>
  /** Normalize the provider's raw game status to the canonical {@link LiveGameStatus}. */
  normalizeGameStatus(raw: string | null | undefined): LiveGameStatus
}

/**
 * Whether `provider` may live-score a season of `sport`.
 *
 * 🛑 THE LIVE TICK RAN EVERY ACTIVE SEASON THROUGH THE NFL PROVIDER, WHATEVER ITS SPORT. For an NHL
 * season that meant NFL games as the slate and Sleeper's NFL week stats looked up by the NHL
 * roster's ids — which are numeric Rolling Insights ids, and 2,812 of 4,367 NHL pool ids (64%)
 * equal some NFL player's Sleeper id (NCAAB 8,813 of 18,209; NBA 1,146 of 1,841), measured on
 * production 2026-09-24. A hit credits an NHL player with an NFL player's line, overwrites
 * player_weekly_scores.stats, resets isFinalized and rebroadcasts. The first native NHL league
 * (created 2026-09-24) was being ticked every two minutes as "NFL week 1"; it wrote nothing only
 * because every NFL week-1 game was already final — luck, not a check.
 *
 * Daily sports score through the weekly sync (playerWeeklyScoreService), not this tick.
 */
export function liveProviderServesSport(provider: object, sport: string | null | undefined): boolean {
  return liveProviderSports(provider).includes(String(sport ?? '').trim().toUpperCase())
}

/**
 * The sports `provider` declares, NFL when it declares none. Takes `object` rather than
 * `Pick<LiveStatsProvider, 'sports'>` on purpose: that Pick has only an optional member, so
 * TypeScript's weak-type check rejects any provider class that does not declare `sports` — which
 * is exactly the undeclared case this default exists for.
 */
export function liveProviderSports(provider: object): readonly string[] {
  const declared = (provider as { sports?: readonly string[] }).sports
  return declared ?? ['NFL']
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
