/**
 * Decision OS — F2.10 Matchup History derived VIEW (warehouse `MatchupFact`).
 *
 * Additive, read-only view layering on the F2.9 performance view. Exposes each ROSTER's actual
 * matchup history (team-level facts — matchups belong to teams, not players) with season
 * isolation and honest degradation. See ADR_F2_10_MATCHUP_HISTORY_FACTS.md for the production
 * census and the binding policies implemented here.
 *
 * Architecture Freeze invariants (must hold forever):
 * - Pure layers never import Prisma; the port resolves canonical team ids before rows arrive.
 * - SPARSE COVERAGE IS THE NORMAL PATH: 3 leagues have matchup facts in prod. Absence produces
 *   `matchup_history_unavailable` — never 0 wins / 0 losses / an empty-but-real record.
 * - Incomplete fixtures (0–0, null winner) are EXCLUDED from every completed summary; a zero
 *   score in a COMPLETED matchup is a real zero and averages normally.
 * - Current-season and historical samples never blend; prior-season-only data carries
 *   `season_mismatch`.
 * - NEVER derived: opponent strength, SoS, win/playoff probability, momentum, manager quality,
 *   projection accuracy, playoff classification.
 * - Resolver never throws; port failure degrades to `matchup_port_error` uncertainty.
 */

import type { RawMatchupFactRow } from './facts'
import { loadMatchupFactRows } from './port'
import type {
  PerformanceEnrichedCanonicalWorld,
  PerformanceEnrichedRosterFacts,
} from './performanceEnrichedWorld'
import { resolvePerformanceEnrichedCanonicalWorld } from './performanceEnrichedWorld'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface MatchupPerspectiveRow {
  season: number | null
  week: number
  /** Canonical LeagueTeam.id of the opponent, or null when the bridge could not resolve it. */
  opponentTeamId: string | null
  teamScore: number
  opponentScore: number
  margin: number
  result: 'W' | 'L' | 'T'
}

export interface MatchupSeasonSummary {
  /** Completed matchups only. null = no completed sample (NOT an 0-0-0 record). */
  wins: number | null
  losses: number | null
  ties: number | null
  averagePointsScored: number | null
  averagePointsAllowed: number | null
  averageMargin: number | null
  sampleSize: number
}

export interface MatchupContext {
  /** Most recent completed matchup, newest season first. */
  latestCompletedMatchup: MatchupPerspectiveRow | null
  /** Rows whose season equals the league's current season — completed only. */
  currentSeason: MatchupSeasonSummary
  /** All completed rows from earlier seasons, aggregated separately (never blended). */
  historical: MatchupSeasonSummary
  /** Up to the 3 most recent completed matchups (any season, newest first). */
  recentCompletedMatchups: MatchupPerspectiveRow[]
  /** Fixtures known but not yet played (informational; excluded from all summaries). */
  incompleteFixtureCount: number
  /** Newest fact write time backing this context. */
  factsGeneratedAt: Date | null
  uncertainty: string[]
}

export interface MatchupEnrichedRosterFacts extends PerformanceEnrichedRosterFacts {
  matchupContext: MatchupContext
}

export interface MatchupEnrichmentSummary {
  totalRosters: number
  withHistory: number
  missingCount: number
  unresolvedTeamMappings: number
  incompleteFixtures: number
  seasonMismatch: boolean
}

export interface MatchupEnrichedCanonicalWorld extends Omit<PerformanceEnrichedCanonicalWorld, 'rosters'> {
  rosters: MatchupEnrichedRosterFacts[]
  matchupSummary: MatchupEnrichmentSummary
}

export interface MatchupContextResult {
  rows: RawMatchupFactRow[]
  error: string | null
}

export interface MatchupPort {
  loadMatchupFactRows(leagueId: string): Promise<RawMatchupFactRow[]>
}

export interface MatchupEnrichedWorldDeps {
  matchup?: MatchupPort
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

const RECENT_MATCHUPS = 3

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Perspective a raw (complete) row for one canonical team. Pure. */
export function toPerspectiveRow(row: RawMatchupFactRow, teamId: string): MatchupPerspectiveRow | null {
  const isA = row.teamACanonicalId === teamId
  const isB = row.teamBCanonicalId === teamId
  if (!isA && !isB) return null
  const teamScore = isA ? row.scoreA : row.scoreB
  const opponentScore = isA ? row.scoreB : row.scoreA
  return {
    season: row.season,
    week: row.weekOrPeriod,
    opponentTeamId: isA ? row.teamBCanonicalId : row.teamACanonicalId,
    teamScore,
    opponentScore,
    margin: round2(teamScore - opponentScore),
    result: teamScore > opponentScore ? 'W' : teamScore < opponentScore ? 'L' : 'T',
  }
}

/** Aggregate COMPLETED perspective rows. Empty sample = nulls (never a fabricated 0-0-0). */
export function summarizeMatchups(rows: MatchupPerspectiveRow[]): MatchupSeasonSummary {
  if (rows.length === 0) {
    return {
      wins: null, losses: null, ties: null,
      averagePointsScored: null, averagePointsAllowed: null, averageMargin: null,
      sampleSize: 0,
    }
  }
  let wins = 0, losses = 0, ties = 0, scored = 0, allowed = 0
  for (const row of rows) {
    if (row.result === 'W') wins += 1
    else if (row.result === 'L') losses += 1
    else ties += 1
    scored += row.teamScore
    allowed += row.opponentScore
  }
  return {
    wins, losses, ties,
    averagePointsScored: round2(scored / rows.length),
    averagePointsAllowed: round2(allowed / rows.length),
    averageMargin: round2((scored - allowed) / rows.length),
    sampleSize: rows.length,
  }
}

/** Build one roster's MatchupContext from the league's raw rows. Pure, never throws. */
export function projectMatchupContext(
  rows: RawMatchupFactRow[],
  teamId: string | null,
  leagueSeason: number,
): MatchupContext {
  const uncertainty: string[] = []

  if (!teamId) {
    return {
      latestCompletedMatchup: null,
      currentSeason: summarizeMatchups([]),
      historical: summarizeMatchups([]),
      recentCompletedMatchups: [],
      incompleteFixtureCount: 0,
      factsGeneratedAt: null,
      uncertainty: ['matchup_history_unavailable', 'team_identity_unresolved'],
    }
  }

  const mine = rows.filter((row) => row.teamACanonicalId === teamId || row.teamBCanonicalId === teamId)
  if (mine.length === 0) {
    return {
      latestCompletedMatchup: null,
      currentSeason: summarizeMatchups([]),
      historical: summarizeMatchups([]),
      recentCompletedMatchups: [],
      incompleteFixtureCount: 0,
      factsGeneratedAt: null,
      // The NORMAL path (ADR policy 1): most leagues have no matchup facts at all.
      uncertainty: ['matchup_history_unavailable'],
    }
  }

  const complete = mine.filter((row) => row.isComplete)
  const incomplete = mine.length - complete.length

  const perspectives: MatchupPerspectiveRow[] = []
  let unresolvedOpponents = 0
  for (const row of complete) {
    const perspective = toPerspectiveRow(row, teamId)
    if (perspective) {
      perspectives.push(perspective)
      if (perspective.opponentTeamId == null) unresolvedOpponents += 1
    }
  }
  if (unresolvedOpponents > 0) {
    uncertainty.push(`team_mapping_unresolved: ${unresolvedOpponents} opponent(s) could not be canonically resolved`)
  }

  // Rows arrive season-desc, week-asc from the port; make "recent" deterministic regardless.
  const newestFirst = [...perspectives].sort(
    (a, b) => (b.season ?? 0) - (a.season ?? 0) || b.week - a.week,
  )

  const current = perspectives.filter((p) => p.season === leagueSeason)
  const historical = perspectives.filter((p) => p.season !== leagueSeason)

  if (current.length === 0 && historical.length > 0) {
    uncertainty.push(`season_mismatch: completed matchup facts cover earlier seasons only; league season is ${leagueSeason}`)
  }

  let factsGeneratedAt: Date | null = null
  for (const row of mine) {
    if (factsGeneratedAt == null || row.createdAt > factsGeneratedAt) factsGeneratedAt = row.createdAt
  }

  return {
    latestCompletedMatchup: newestFirst[0] ?? null,
    currentSeason: summarizeMatchups(current),
    historical: summarizeMatchups(historical),
    recentCompletedMatchups: newestFirst.slice(0, RECENT_MATCHUPS),
    incompleteFixtureCount: incomplete,
    factsGeneratedAt,
    uncertainty,
  }
}

/** Fetch the league's raw rows once. Never throws. */
export async function resolveMatchupContext(
  leagueId: string,
  port?: MatchupPort,
): Promise<MatchupContextResult> {
  const loader = port ?? { loadMatchupFactRows }
  try {
    return { rows: await loader.loadMatchupFactRows(leagueId), error: null }
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) }
  }
}

/** Project the performance-enriched world + raw rows into the matchup view. Pure. */
export function projectMatchupEnrichedWorld(
  base: PerformanceEnrichedCanonicalWorld,
  contextResult: MatchupContextResult,
  leagueSeason: number,
): MatchupEnrichedCanonicalWorld {
  let withHistory = 0
  let missingCount = 0
  let unresolvedTeamMappings = 0
  let seasonMismatch = false
  let incompleteFixtures = 0

  const rosters = base.rosters.map((roster) => {
    const context = projectMatchupContext(contextResult.rows, roster.teamId ?? null, leagueSeason)
    if (contextResult.error) {
      context.uncertainty.push(`matchup_port_error: ${contextResult.error}`)
    }
    if (context.latestCompletedMatchup != null) withHistory += 1
    else missingCount += 1
    if (context.uncertainty.some((u) => u.startsWith('team_mapping_unresolved') || u === 'team_identity_unresolved')) {
      unresolvedTeamMappings += 1
    }
    if (context.uncertainty.some((u) => u.startsWith('season_mismatch'))) seasonMismatch = true
    incompleteFixtures += context.incompleteFixtureCount
    return { ...roster, matchupContext: context }
  })

  return {
    ...base,
    rosters,
    matchupSummary: {
      totalRosters: rosters.length,
      withHistory,
      missingCount,
      unresolvedTeamMappings,
      incompleteFixtures,
      seasonMismatch,
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Resolver
// ──────────────────────────────────────────────────────────────────────────

export async function resolveMatchupEnrichedCanonicalWorld(
  leagueId: string,
  deps?: MatchupEnrichedWorldDeps,
): Promise<MatchupEnrichedCanonicalWorld | null> {
  const base = await resolvePerformanceEnrichedCanonicalWorld(leagueId).catch(() => null)
  if (!base) return null

  const contextResult = await resolveMatchupContext(leagueId, deps?.matchup)
  return projectMatchupEnrichedWorld(base, contextResult, base.league.season)
}
