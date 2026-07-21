/**
 * Decision OS — F2.9 Player Performance derived VIEW (warehouse `PlayerGameFact`).
 *
 * Additive, read-only view layering on F2.1 EnrichedCanonicalWorld. Exposes each player's
 * ACTUAL per-game fantasy production from the stat warehouse (dw_player_game_facts — populated,
 * ledger-verified, and count-reconciled by the 2026-07-21 P0 release) with season provenance and
 * honest degradation via null + uncertainty[]. The projection view (F2.5) answers "what is
 * expected"; this view answers "what happened".
 *
 * Architecture Freeze invariants (must hold forever):
 * - Pure `CanonicalWorld` is NOT mutated. All performance data lives on this derived view only.
 * - Origin (provider / native) is NEVER used as a decision input. `PlayerGameFact.playerId` is
 *   the raw provider-id join key — the same id space as `EnrichedPlayer.playerId` (verified
 *   during the P0 release: Sleeper week-stat ids ARE roster player ids).
 * - No fabrication (P2): a player with zero fact rows has `gamesPlayed: null`, NOT 0 — an empty
 *   warehouse is "unknown", never "played 0 games / scored 0.0". Every absence is an
 *   uncertainty[] entry. A real 0.0-point game (fact row with fantasyPoints 0) counts normally.
 * - Season honesty: warehouse facts may cover a COMPLETED season while the league is in a later
 *   one (offseason). `seasonUsed` names the source season and a `season_mismatch` uncertainty is
 *   added rather than presenting last season's form as current.
 * - `resolvePerformanceEnrichedCanonicalWorld` NEVER throws; errors surface as uncertainty.
 * - One batched port query per resolve for the whole roster set — never per-player loops.
 *
 * See ADR_F2_9_PLAYER_PERFORMANCE_FACTS.md for the prod data census and design rationale.
 */

import type { EnrichedCanonicalWorld, EnrichedPlayer, EnrichedRosterFacts } from './enrichedWorld'
import { resolveEnrichedCanonicalWorld } from './enrichedWorld'
import type { RawPlayerGameFactRow } from './facts'
import { loadPlayerGameFactRows } from './port'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface PerformanceWeekPoints {
  week: number
  fantasyPoints: number
}

export interface PerformanceContext {
  /** null = no sourced history (NOT zero games). */
  gamesPlayed: number | null
  totalFantasyPoints: number | null
  avgFantasyPoints: number | null
  /** Mean of the most recent 3 games (or fewer if fewer exist). */
  recentFormAvg: number | null
  /** Points of the latest recorded game. */
  lastGamePoints: number | null
  /** Per-week series, ascending by week — supports sparklines and trend rules downstream. */
  weeklyPoints: PerformanceWeekPoints[]
  /** The season the facts came from (may differ from the league's current season — see uncertainty). */
  seasonUsed: number | null
  /** Newest fact-generation timestamp backing this context. */
  factsGeneratedAt: Date | null
  uncertainty: string[]
}

export interface PerformanceEnrichedPlayer extends EnrichedPlayer {
  performanceContext: PerformanceContext
}

/** All base roster facts carried through; only `players` is re-typed with the performance view. */
export interface PerformanceEnrichedRosterFacts extends Omit<EnrichedRosterFacts, 'players'> {
  players: PerformanceEnrichedPlayer[]
}

export interface PerformanceEnrichmentSummary {
  totalPlayers: number
  withHistory: number
  missingCount: number
  seasonUsed: number | null
  seasonMismatch: boolean
  weeksCovered: number
}

export interface PerformanceEnrichedCanonicalWorld extends EnrichedCanonicalWorld {
  rosters: PerformanceEnrichedRosterFacts[]
  performanceSummary: PerformanceEnrichmentSummary
}

/** Result type for the port fetch (so callers never need to catch). */
export interface PerformanceContextResult {
  rowsByPlayer: Map<string, RawPlayerGameFactRow[]>
  error: string | null
}

export interface PerformancePort {
  loadPlayerGameFactRows(sport: string, ids: string[], season?: number): Promise<RawPlayerGameFactRow[]>
}

export interface PerformanceEnrichedWorldDeps {
  performance?: PerformancePort
  now?: Date
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

const RECENT_FORM_GAMES = 3

/** Round to 2dp without float dust. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Build a PerformanceContext for one player from their fact rows. Pure, never throws. */
export function projectPerformanceContext(
  rows: RawPlayerGameFactRow[],
  leagueSeason: string | null,
): PerformanceContext {
  const uncertainty: string[] = []

  const usable = rows
    .filter((row) => row.weekOrRound != null && Number.isFinite(row.fantasyPoints))
    .sort((a, b) => (a.weekOrRound ?? 0) - (b.weekOrRound ?? 0))

  if (usable.length === 0) {
    return {
      gamesPlayed: null,
      totalFantasyPoints: null,
      avgFantasyPoints: null,
      recentFormAvg: null,
      lastGamePoints: null,
      weeklyPoints: [],
      seasonUsed: null,
      factsGeneratedAt: null,
      uncertainty: ['performance_history_unavailable'],
    }
  }

  // Facts are served newest-season-first by the port; aggregate over the newest season only so a
  // multi-season warehouse never blends seasons into one average.
  const seasonUsed = usable.reduce<number | null>(
    (max, row) => (row.season != null && (max == null || row.season > max) ? row.season : max),
    null,
  )
  const seasonRows = usable.filter((row) => row.season === seasonUsed)

  if (seasonUsed != null && leagueSeason != null && String(seasonUsed) !== leagueSeason) {
    uncertainty.push(`season_mismatch: facts cover ${seasonUsed}, league season is ${leagueSeason}`)
  }

  const weeklyPoints = seasonRows.map((row) => ({
    week: row.weekOrRound as number,
    fantasyPoints: round2(row.fantasyPoints),
  }))
  const total = seasonRows.reduce((sum, row) => sum + row.fantasyPoints, 0)
  const recent = seasonRows.slice(-RECENT_FORM_GAMES)

  let factsGeneratedAt: Date | null = null
  for (const row of seasonRows) {
    if (factsGeneratedAt == null || row.createdAt > factsGeneratedAt) factsGeneratedAt = row.createdAt
  }

  return {
    gamesPlayed: seasonRows.length,
    totalFantasyPoints: round2(total),
    avgFantasyPoints: round2(total / seasonRows.length),
    recentFormAvg: round2(recent.reduce((sum, row) => sum + row.fantasyPoints, 0) / recent.length),
    lastGamePoints: round2(seasonRows[seasonRows.length - 1]!.fantasyPoints),
    weeklyPoints,
    seasonUsed,
    factsGeneratedAt,
    uncertainty,
  }
}

/** Fetch fact rows for all players in one batched call. Never throws. */
export async function resolvePerformanceContext(
  sport: string,
  playerIds: string[],
  port?: PerformancePort,
): Promise<PerformanceContextResult> {
  const loader = port ?? { loadPlayerGameFactRows }
  try {
    const rows = await loader.loadPlayerGameFactRows(sport, playerIds)
    const rowsByPlayer = new Map<string, RawPlayerGameFactRow[]>()
    for (const row of rows) {
      const list = rowsByPlayer.get(row.playerId)
      if (list) list.push(row)
      else rowsByPlayer.set(row.playerId, [row])
    }
    return { rowsByPlayer, error: null }
  } catch (err) {
    return { rowsByPlayer: new Map(), error: err instanceof Error ? err.message : String(err) }
  }
}

/** Project the enriched world + fetched contexts into the performance view. Pure. */
export function projectPerformanceEnrichedWorld(
  base: EnrichedCanonicalWorld,
  contextResult: PerformanceContextResult,
  leagueSeason: string | null,
): PerformanceEnrichedCanonicalWorld {
  let withHistory = 0
  let missingCount = 0
  let seasonUsed: number | null = null
  let seasonMismatch = false
  const weeksSeen = new Set<number>()

  const rosters = base.rosters.map((roster) => ({
    ...roster,
    players: roster.players.map((player) => {
      const context = projectPerformanceContext(
        contextResult.rowsByPlayer.get(player.playerId) ?? [],
        leagueSeason,
      )
      if (contextResult.error) {
        context.uncertainty.push(`performance_port_error: ${contextResult.error}`)
      }
      if (context.gamesPlayed != null) {
        withHistory += 1
        if (context.seasonUsed != null) seasonUsed = context.seasonUsed
        if (context.uncertainty.some((u) => u.startsWith('season_mismatch'))) seasonMismatch = true
        for (const wp of context.weeklyPoints) weeksSeen.add(wp.week)
      } else {
        missingCount += 1
      }
      return { ...player, performanceContext: context }
    }),
  }))

  const totalPlayers = rosters.reduce((sum, roster) => sum + roster.players.length, 0)

  return {
    ...base,
    rosters,
    performanceSummary: {
      totalPlayers,
      withHistory,
      missingCount,
      seasonUsed,
      seasonMismatch,
      weeksCovered: weeksSeen.size,
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Resolver
// ──────────────────────────────────────────────────────────────────────────

export async function resolvePerformanceEnrichedCanonicalWorld(
  leagueId: string,
  deps?: PerformanceEnrichedWorldDeps,
): Promise<PerformanceEnrichedCanonicalWorld | null> {
  const base = await resolveEnrichedCanonicalWorld(leagueId).catch(() => null)
  if (!base) return null

  const playerIds = base.rosters.flatMap((roster) => roster.players.map((player) => player.playerId))
  const contextResult = await resolvePerformanceContext(base.league.sport, playerIds, deps?.performance)

  return projectPerformanceEnrichedWorld(base, contextResult, String(base.league.season))
}
