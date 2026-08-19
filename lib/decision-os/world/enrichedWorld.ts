/**
 * Decision OS — Phase 2 / F2.1: Canonical World PLAYER METADATA enrichment (read-only derived VIEW).
 *
 * The pure Canonical World carries raw player IDS only (origin-blind, no IO, `playerMetadataEnriched`
 * stays false — a Phase-1 FROZEN invariant; see ARCHITECTURE_FREEZE.md + ADR_F2_1_PLAYER_METADATA.md).
 * This module does NOT change that. It ADDS, alongside the frozen world, a derived `EnrichedCanonicalWorld`
 * view that folds deterministic player metadata (name / position / eligible positions / team / sport /
 * injury status) onto those ids — read-only, honest, additive.
 *
 * READ-ONLY & HONEST (P2 — never fabricate):
 *   - Reuses the D.1 seam `resolvePlayerMetadata` (the persisted `SportsPlayer` cache via the find*-only
 *     port). NO new source, NO live API, NO cache warming, NO writes. This file imports NO prisma.
 *   - Unresolved ids → null fields + `player_metadata_missing`. byeWeek / projections / ADP / market /
 *     weather / news are OUT OF SCOPE here (later F2.x) and are never read or invented.
 *   - eligiblePositions is DERIVED from the single cached `position` (`[position]`); true multi-slot
 *     eligibility is not in the source → `eligible_positions_degraded` warning (honest real-data gap).
 *   - Origin-blind: keyed by player id + sport only; never branches on provider. Provider/source survive
 *     as provenance only.
 */
import type { CanonicalWorld, RosterFacts } from './facts'
import { resolvePlayerMetadata, type PlayerMetadataResult } from './playerMetadata'
import { resolveCanonicalWorld, type ResolveCanonicalWorldOptions } from './index'

export interface EnrichedPlayer {
  /** Raw canonical/provider id — lookup key + provenance. */
  playerId: string
  name: string | null
  position: string | null
  /** Derived from `position` today (`[position]`); multi-slot eligibility is not sourced yet (see warning). */
  eligiblePositions: string[]
  team: string | null
  /** League sport (a fact carried from `world.league.sport`) — always present. */
  sport: string
  injuryStatus: string | null
  /** True ONLY when required fields (name + position) resolved. */
  resolved: boolean
  /** Which cached source resolved this row; null when unresolved. Provenance only. */
  source: string | null
}

export interface EnrichedRosterFacts extends RosterFacts {
  players: EnrichedPlayer[]
  /** True ONLY when EVERY player on this roster resolved required metadata (overrides the false base). */
  playerMetadataEnriched: boolean
  /** 0–100 share of this roster's players that resolved required metadata (honest, bounded). */
  metadataCompleteness: number
}

export interface EnrichedWorldMetadataSummary {
  requested: number
  resolved: number
  /** 0–100 world-level resolved/requested. */
  completeness: number
  /** Honest degradation notes (provenance/debug only — never a decision input). */
  warnings: string[]
}

export interface EnrichedCanonicalWorld extends Omit<CanonicalWorld, 'rosters'> {
  rosters: EnrichedRosterFacts[]
  metadata: EnrichedWorldMetadataSummary
}

function pct(resolved: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((resolved / total) * 100)
}

/**
 * Pure: fold resolved player metadata onto a Canonical World's roster player ids. Deterministic, no IO,
 * origin-blind. The base world is never mutated — a new enriched view is returned. A roster's
 * `playerMetadataEnriched` is true ONLY when every one of its players resolved required metadata.
 */
export function projectEnrichedWorld(
  world: CanonicalWorld,
  metadata: PlayerMetadataResult,
): EnrichedCanonicalWorld {
  const sport = world.league.sport
  let requested = 0
  let resolvedTotal = 0
  let anyPositionDerived = false

  const rosters: EnrichedRosterFacts[] = world.rosters.map((roster) => {
    const players: EnrichedPlayer[] = roster.playerIds.map((id) => {
      const m = metadata.byId.get(id)
      const position = m?.position ?? null
      if (position) anyPositionDerived = true
      return {
        playerId: id,
        name: m?.name ?? null,
        position,
        eligiblePositions: position ? [position] : [],
        team: m?.team ?? null,
        sport,
        injuryStatus: m?.injuryStatus ?? null,
        resolved: Boolean(m?.resolved),
        source: m?.source ?? null,
      }
    })
    const total = players.length
    const resolved = players.filter((p) => p.resolved).length
    requested += total
    resolvedTotal += resolved
    return {
      ...roster,
      players,
      playerMetadataEnriched: total > 0 && resolved === total,
      metadataCompleteness: pct(resolved, total),
    }
  })

  const warnings = [...metadata.warnings]
  // Honest: eligibility is single-position-derived (the cache has no multi-slot eligibility).
  if (anyPositionDerived) warnings.push('eligible_positions_degraded')

  return {
    ...world,
    rosters,
    metadata: {
      requested,
      resolved: resolvedTotal,
      completeness: pct(resolvedTotal, requested),
      warnings: Array.from(new Set(warnings)),
    },
  }
}

export interface EnrichedWorldDeps {
  /** Read-only canonical world resolver (default: resolveCanonicalWorld → prisma find* only). */
  resolveWorld: (leagueId: string, options?: ResolveCanonicalWorldOptions) => Promise<CanonicalWorld | null>
  /** Read-only metadata resolver (default: resolvePlayerMetadata → SportsPlayer cache, find* only). */
  resolveMetadata: (sport: string, ids: string[]) => Promise<PlayerMetadataResult>
}

export const defaultEnrichedWorldDeps: EnrichedWorldDeps = {
  resolveWorld: (leagueId, options) => resolveCanonicalWorld(leagueId, options),
  resolveMetadata: (sport, ids) => resolvePlayerMetadata(sport, ids),
}

/**
 * Read-only resolver: resolve the canonical world, gather the union of all roster player ids, resolve
 * their metadata through the read-only cache seam, and project the enriched view. NEVER throws — a world
 * miss returns null; a metadata miss degrades to an unenriched view (honest). Injectable deps for tests.
 */
export async function resolveEnrichedCanonicalWorld(
  leagueId: string,
  deps: EnrichedWorldDeps = defaultEnrichedWorldDeps,
): Promise<EnrichedCanonicalWorld | null> {
  const world = await deps.resolveWorld(leagueId)
  if (!world) return null
  const ids = Array.from(new Set(world.rosters.flatMap((r) => r.playerIds)))
  let metadata: PlayerMetadataResult
  try {
    metadata = await deps.resolveMetadata(world.league.sport, ids)
  } catch {
    // resolvePlayerMetadata already degrades internally; this guards any unexpected throw.
    metadata = { byId: new Map(), complete: false, unresolvedIds: ids, warnings: ['player_metadata_source_unavailable'] }
  }
  return projectEnrichedWorld(world, metadata)
}
