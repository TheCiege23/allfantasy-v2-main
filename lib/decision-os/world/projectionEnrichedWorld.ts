/**
 * Decision OS — Phase 2 Canonical Enrichment: F2.5 Weekly Projection derived VIEW.
 *
 * Additive, read-only view layering on F2.1 EnrichedCanonicalWorld. Exposes deterministic weekly
 * projection context (from `FantasyProjection` — provider-backed values only) with scoring-format
 * provenance, expiresAt-based freshness, and honest degradation via null + uncertainty[].
 *
 * Architecture Freeze invariants (must hold forever):
 * - Pure `CanonicalWorld` is NOT mutated. All projection data lives on this derived view only.
 * - Origin (provider / native) is NEVER used as a decision input. Provenance only.
 * - AI-generated or heuristic projections are NOT used (P3). Only `FantasyProjection` rows —
 *   which the schema documents as "importers must write provider-backed values only".
 * - All fields degrade to null + uncertainty[] when data is unavailable (P2 — never fabricate).
 * - `resolveProjectionEnrichedCanonicalWorld` NEVER throws; errors surface as uncertainty entries.
 *
 * See ADR_F2_5_PROJECTIONS.md for source audit, tier-selection logic, ID space notes, and
 * real-data coverage results.
 */

import type { EnrichedCanonicalWorld, EnrichedPlayer } from './enrichedWorld'
import { resolveEnrichedCanonicalWorld } from './enrichedWorld'
import type { LeagueFacts, RawProjectionRow } from './facts'
import { loadProjectionRows } from './port'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type ProjectionMatchTier = 'exact' | 'any_scoring'

export interface ProjectionFreshness {
  expiresAt: Date | null
  fetchedAt: Date | null
  isStale: boolean | null
  staleReason: string | null
}

export interface ProjectionContext {
  projectedPoints: number | null
  source: string | null
  /** Which scoring preset the winning row used (provenance — carry for consumer audit). */
  scoringPresetId: string | null
  /** Whether the row's scoringPresetId matched the league's exactly, or fell back to any-scoring. */
  matchTier: ProjectionMatchTier | null
  week: number | null
  season: string | null
  freshness: ProjectionFreshness
  uncertainty: string[]
}

export interface ProjectionEnrichedPlayer extends EnrichedPlayer {
  projectionContext: ProjectionContext
}

export interface ProjectionEnrichedRosterFacts {
  rosterId: string
  teamId: string
  players: ProjectionEnrichedPlayer[]
}

export interface ProjectionEnrichmentSummary {
  totalPlayers: number
  withProjection: number
  staleCount: number
  missingCount: number
  formatMismatchCount: number
}

export interface ProjectionEnrichedCanonicalWorld extends EnrichedCanonicalWorld {
  rosters: ProjectionEnrichedRosterFacts[]
  projectionSummary: ProjectionEnrichmentSummary
}

/** Result type for the resolver (so callers never need to catch). */
export interface ProjectionContextResult {
  rowsByPlayer: Map<string, RawProjectionRow[]>
  error: string | null
}

export interface ProjectionPort {
  loadProjectionRows(sport: string, ids: string[], season: string, week: number): Promise<RawProjectionRow[]>
}

export interface ProjectionEnrichedWorldDeps {
  projection?: ProjectionPort
  now?: Date
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

/** Select the best projection row for a player using a two-tier priority. */
export function selectBestProjectionRow(
  rows: RawProjectionRow[],
  scoringPresetId: string | null,
): { row: RawProjectionRow; matchTier: ProjectionMatchTier } | null {
  if (rows.length === 0) return null

  // Tier 1: exact scoringPresetId match (rows already ordered by expiresAt desc from port)
  if (scoringPresetId) {
    const exact = rows.find((r) => r.scoringPresetId === scoringPresetId)
    if (exact) return { row: exact, matchTier: 'exact' }
  }

  // Tier 2: any scoring preset (fall back to freshest row regardless of preset)
  return { row: rows[0]!, matchTier: 'any_scoring' }
}

/** Compute freshness from a projection row's expiresAt. Direct TTL — no age estimation needed. */
export function projectProjectionFreshness(row: RawProjectionRow | null, now: Date): ProjectionFreshness {
  if (!row) {
    return { expiresAt: null, fetchedAt: null, isStale: null, staleReason: 'projection_freshness_unavailable' }
  }
  const isStale = row.expiresAt <= now
  return {
    expiresAt: row.expiresAt,
    fetchedAt: row.fetchedAt,
    isStale,
    staleReason: isStale ? 'projection_expired' : null,
  }
}

/** Build a ProjectionContext for one player from their rows + league facts. Pure, never throws. */
export function projectProjectionContext(
  rows: RawProjectionRow[],
  scoringPresetId: string | null,
  now: Date,
): ProjectionContext {
  const uncertainty: string[] = []

  if (rows.length === 0) {
    return {
      projectedPoints: null,
      source: null,
      scoringPresetId: null,
      matchTier: null,
      week: null,
      season: null,
      freshness: projectProjectionFreshness(null, now),
      uncertainty: ['projection_unavailable'],
    }
  }

  const selected = selectBestProjectionRow(rows, scoringPresetId)
  if (!selected) {
    return {
      projectedPoints: null,
      source: null,
      scoringPresetId: null,
      matchTier: null,
      week: null,
      season: null,
      freshness: projectProjectionFreshness(null, now),
      uncertainty: ['projection_unavailable'],
    }
  }

  const { row, matchTier } = selected
  const freshness = projectProjectionFreshness(row, now)

  if (matchTier === 'any_scoring') {
    uncertainty.push('projection_scoring_format_mismatch')
  }
  if (freshness.isStale === true) {
    uncertainty.push('projection_stale')
  }

  return {
    projectedPoints: row.projectedPoints,
    source: row.source,
    scoringPresetId: row.scoringPresetId,
    matchTier,
    week: row.week,
    season: row.season,
    freshness,
    uncertainty,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Pure projector
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fold projection context onto an EnrichedCanonicalWorld. Pure — never mutates base world,
 * never reads from DB.
 */
export function projectProjectionEnrichedWorld(
  world: EnrichedCanonicalWorld,
  contextResult: ProjectionContextResult,
  leagueFacts: LeagueFacts,
  now: Date,
): ProjectionEnrichedCanonicalWorld {
  const { rowsByPlayer } = contextResult
  const scoringPresetId = leagueFacts.scoringPresetId

  let withProjection = 0
  let staleCount = 0
  let missingCount = 0
  let formatMismatchCount = 0
  let totalPlayers = 0

  const rosters: ProjectionEnrichedRosterFacts[] = world.rosters.map((roster) => ({
    rosterId: roster.rosterId,
    teamId: roster.teamId,
    players: roster.players.map((player) => {
      totalPlayers++
      const rows = rowsByPlayer.get(player.playerId) ?? []
      const ctx = projectProjectionContext(rows, scoringPresetId, now)

      if (ctx.projectedPoints !== null) withProjection++
      else missingCount++
      if (ctx.freshness.isStale === true) staleCount++
      if (ctx.uncertainty.includes('projection_scoring_format_mismatch')) formatMismatchCount++

      return { ...player, projectionContext: ctx }
    }),
  }))

  return {
    ...world,
    rosters,
    projectionSummary: { totalPlayers, withProjection, staleCount, missingCount, formatMismatchCount },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Read-only resolver
// ──────────────────────────────────────────────────────────────────────────

export const defaultProjectionPort: ProjectionPort = { loadProjectionRows }

/**
 * Load projection rows for a set of player IDs. Returns grouped by playerId.
 * NEVER throws — errors surface as contextResult.error + empty map.
 * If week is null (currentWeek not derivable), skips loading and returns empty map.
 */
export async function resolveProjectionContext(
  sport: string,
  ids: string[],
  season: string,
  week: number | null,
  port?: ProjectionPort,
): Promise<ProjectionContextResult> {
  if (week === null || ids.length === 0) {
    return { rowsByPlayer: new Map(), error: null }
  }
  const p = port ?? defaultProjectionPort
  try {
    const rows = await p.loadProjectionRows(sport, ids, season, week)
    const rowsByPlayer = new Map<string, RawProjectionRow[]>()
    for (const row of rows) {
      const existing = rowsByPlayer.get(row.playerId)
      if (existing) existing.push(row)
      else rowsByPlayer.set(row.playerId, [row])
    }
    return { rowsByPlayer, error: null }
  } catch (err) {
    return {
      rowsByPlayer: new Map(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Top-level orchestrator: chains F2.1 enrichment → resolves projection context → projects.
 * NEVER throws. Returns null when the league does not exist.
 */
export async function resolveProjectionEnrichedCanonicalWorld(
  leagueId: string,
  deps?: ProjectionEnrichedWorldDeps,
): Promise<ProjectionEnrichedCanonicalWorld | null> {
  const now = deps?.now ?? new Date()
  const base = await resolveEnrichedCanonicalWorld(leagueId).catch(() => null)
  if (!base) return null

  const { leagueFacts } = base
  const playerIds = base.rosters.flatMap((r) => r.players.map((p) => p.playerId))
  const contextResult = await resolveProjectionContext(
    leagueFacts.sport,
    playerIds,
    String(leagueFacts.season),
    leagueFacts.currentWeek,
    deps?.projection,
  )

  return projectProjectionEnrichedWorld(base, contextResult, leagueFacts, now)
}
