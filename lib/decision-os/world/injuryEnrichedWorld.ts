/**
 * Decision OS — Phase 2 / F2.3: Canonical World INJURY / AVAILABILITY enrichment (read-only derived VIEW).
 *
 * Builds ADDITIVELY on the F2.1 metadata-enriched world. The frozen Canonical World still carries ids only;
 * this module never mutates it. It reads ONLY already-persisted SportsPlayer cache rows and folds
 * deterministic injury/availability context onto F2.1 enriched players:
 *   - player availability category (available / uncertain / unavailable / unknown)
 *   - injury status freshness (fetchedAt / expiresAt / isStale)
 *   - source / provenance
 *   - honest completeness / uncertainty / warnings
 *
 * HONEST DEGRADATION (P2 — never fabricate):
 *   - Source: SportsPlayer (same seam as F2.1). Richer fields (practiceStatus / gameStatus / bodyPart /
 *     description) are NOT available via any player-id-keyed read-only source (InjuryReportRecord and
 *     InjuryReport use API-Sports IDs, a different namespace — see ADR_F2_3_INJURY_STATUS.md §2).
 *     Those fields are always null + warned, never invented.
 *   - No live API calls, no cache warming, no writes.
 *   - Missing rows → all fields null + injury_status_unavailable warning.
 *   - Stale rows → isStale=true + staleReason surfaced, status still carried (it is what it is).
 *
 * READ-ONLY: this file imports NO prisma. The port function is in world/port.ts.
 */
import type { RawInjuryContextRow } from './facts'
import { loadInjuryContextRows } from './port'
import type { EnrichedCanonicalWorld, EnrichedPlayer, EnrichedRosterFacts } from './enrichedWorld'
import { resolveEnrichedCanonicalWorld } from './enrichedWorld'
import type { ResolveCanonicalWorldOptions } from './index'

export type InjuryAvailabilityCategory = 'available' | 'uncertain' | 'unavailable' | 'unknown'

const AVAILABLE_STATUSES = new Set(['active', 'healthy', 'act'])
const UNCERTAIN_STATUSES = new Set(['q', 'questionable', 'd', 'doubtful'])
const UNAVAILABLE_STATUSES = new Set([
  'o', 'out', 'ir', 'pup', 'sus', 'suspended', 'na', 'inactive', 'nfi', 'cov',
])

/**
 * Pure: derive a deterministic availability category from the Sleeper-sourced status string.
 * Not AI-generated — a fixed mapping of known status strings. Unrecognized → 'unknown'.
 */
export function deriveAvailabilityCategory(status: string | null | undefined): InjuryAvailabilityCategory {
  if (!status || typeof status !== 'string') return 'unknown'
  const key = status.trim().toLowerCase()
  if (!key) return 'unknown'
  if (AVAILABLE_STATUSES.has(key)) return 'available'
  if (UNCERTAIN_STATUSES.has(key)) return 'uncertain'
  if (UNAVAILABLE_STATUSES.has(key)) return 'unavailable'
  return 'unknown'
}

export interface InjuryStatusFreshness {
  fetchedAt: string | null
  expiresAt: string | null
  updatedAt: string | null
  /** True when expiresAt is in the past; null when expiresAt is unknown. */
  isStale: boolean | null
  /** Human-readable reason for staleness / unknown freshness. */
  staleReason: string | null
}

export interface InjuryContext {
  /** Raw status string from SportsPlayer.status (e.g. "Q", "O", "IR", "Active"). Null when unresolved. */
  status: string | null
  /** Deterministic category derived from status. 'unknown' when status unrecognized or null. */
  availabilityCategory: InjuryAvailabilityCategory
  /**
   * Practice participation (DNP / Limited / Full / None). NULL — no player-id-keyed source
   * carries this in a joinable namespace. Documented gap, never fabricated.
   */
  practiceStatus: null
  /**
   * Game-day designation (Active / Out / Doubtful / Questionable / IR). NULL — same reason:
   * InjuryReportRecord uses API-Sports IDs which don't match canonical roster player IDs.
   */
  gameStatus: null
  /**
   * Injured body part (knee, ankle, shoulder…). NULL — same reason as practiceStatus/gameStatus.
   */
  bodyPart: null
  /** Injury notes / description. NULL — same reason. */
  description: null
  freshness: InjuryStatusFreshness
  /** Which import source produced the cached row (provenance only). */
  provenance: { source: string | null }
  /** True when status is non-null AND freshness data is present (expiresAt not null). */
  resolved: boolean
  /** Honest uncertainty notes (provenance/debug — never a decision input). */
  uncertainty: string[]
}

export interface InjuryEnrichedPlayer extends EnrichedPlayer {
  injuryContext: InjuryContext
}

export interface InjuryEnrichedRosterFacts extends Omit<EnrichedRosterFacts, 'players'> {
  players: InjuryEnrichedPlayer[]
  /** 0–100 share of this roster's players that have a resolved injury context. */
  injuryCompleteness: number
  /** Per-roster injury enrichment warnings. */
  injuryWarnings: string[]
}

export interface InjuryEnrichmentSummary {
  requestedPlayers: number
  resolvedPlayers: number
  unavailablePlayers: number
  uncertainPlayers: number
  stalePlayers: number
  completeness: number
  warnings: string[]
}

export interface InjuryEnrichedCanonicalWorld extends Omit<EnrichedCanonicalWorld, 'rosters'> {
  rosters: InjuryEnrichedRosterFacts[]
  injurySummary: InjuryEnrichmentSummary
}

export interface InjuryContextResult {
  byId: Map<string, InjuryContext>
  resolvedCount: number
  unresolvedIds: string[]
  warnings: string[]
}

export interface InjuryContextPort {
  loadRows: (sport: string, ids: string[]) => Promise<RawInjuryContextRow[]>
}

export const defaultInjuryContextPort: InjuryContextPort = {
  loadRows: (sport, ids) => loadInjuryContextRows(sport, ids),
}

export interface InjuryEnrichedWorldDeps {
  resolveEnrichedWorld: (leagueId: string, options?: ResolveCanonicalWorldOptions) => Promise<EnrichedCanonicalWorld | null>
  resolveInjuryContext: (sport: string, ids: string[]) => Promise<InjuryContextResult>
}

export const defaultInjuryEnrichedWorldDeps: InjuryEnrichedWorldDeps = {
  resolveEnrichedWorld: (leagueId, options) => resolveEnrichedCanonicalWorld(leagueId, options ? { ...options } : undefined),
  resolveInjuryContext: (sport, ids) => resolveInjuryContext(sport, ids),
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function pct(resolved: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((resolved / total) * 100)
}

function emptyFreshness(): InjuryStatusFreshness {
  return {
    fetchedAt: null,
    expiresAt: null,
    updatedAt: null,
    isStale: null,
    staleReason: 'freshness_unavailable',
  }
}

function computeFreshness(row: RawInjuryContextRow, now: Date): InjuryStatusFreshness {
  const fetchedAt = toIso(row.fetchedAt)
  const expiresAt = toIso(row.expiresAt)
  const updatedAt = toIso(row.updatedAt)

  if (row.expiresAt instanceof Date && !Number.isNaN(row.expiresAt.getTime())) {
    const isStale = row.expiresAt.getTime() < now.getTime()
    return { fetchedAt, expiresAt, updatedAt, isStale, staleReason: isStale ? 'expired' : null }
  }
  return { fetchedAt, expiresAt: null, updatedAt, isStale: null, staleReason: 'freshness_unavailable' }
}

/**
 * Pure: build an InjuryContext from a raw SportsPlayer cache row. Deterministic, no IO.
 * Richer fields (practiceStatus / gameStatus / bodyPart / description) are always null —
 * no player-id-keyed source available (see ADR §2). These are documented as uncertainty, not errors.
 */
export function projectInjuryContext(row: RawInjuryContextRow | null | undefined, now: Date): InjuryContext {
  if (!row) {
    return {
      status: null,
      availabilityCategory: 'unknown',
      practiceStatus: null,
      gameStatus: null,
      bodyPart: null,
      description: null,
      freshness: emptyFreshness(),
      provenance: { source: null },
      resolved: false,
      uncertainty: [
        'injury_status_unavailable',
        'practice_status_unavailable',
        'game_status_unavailable',
        'body_part_unavailable',
        'injury_description_unavailable',
      ],
    }
  }

  const status = row.status && row.status.trim() ? row.status.trim() : null
  const category = deriveAvailabilityCategory(status)
  const freshness = computeFreshness(row, now)

  const uncertainty: string[] = [
    'practice_status_unavailable',
    'game_status_unavailable',
    'body_part_unavailable',
    'injury_description_unavailable',
  ]
  if (category === 'unknown' && status != null) uncertainty.push('availability_category_unrecognized')
  if (freshness.isStale === true) uncertainty.push('injury_status_stale')
  if (freshness.staleReason === 'freshness_unavailable') uncertainty.push('injury_freshness_unknown')

  return {
    status,
    availabilityCategory: category,
    practiceStatus: null,
    gameStatus: null,
    bodyPart: null,
    description: null,
    freshness,
    provenance: { source: row.source ?? null },
    resolved: status != null && row.expiresAt != null,
    uncertainty,
  }
}

/**
 * Read-only resolver for per-player injury context. Reads the SportsPlayer cache (same seam as F2.1
 * but selecting freshness fields). NEVER throws — a read failure degrades to unresolved contexts.
 */
export async function resolveInjuryContext(
  sport: string,
  ids: string[],
  port: InjuryContextPort = defaultInjuryContextPort,
): Promise<InjuryContextResult> {
  const requested = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0)))
  if (requested.length === 0) {
    return { byId: new Map(), resolvedCount: 0, unresolvedIds: [], warnings: [] }
  }

  const now = new Date()
  let rows: RawInjuryContextRow[]
  try {
    rows = await port.loadRows(sport, requested)
  } catch {
    return {
      byId: new Map(requested.map((id) => [id, projectInjuryContext(null, now)])),
      resolvedCount: 0,
      unresolvedIds: requested,
      warnings: ['injury_context_source_unavailable'],
    }
  }

  const rowByKey = new Map<string, RawInjuryContextRow>()
  for (const row of rows) {
    if (row.externalId && !rowByKey.has(row.externalId)) rowByKey.set(row.externalId, row)
    if (row.sleeperId && !rowByKey.has(row.sleeperId)) rowByKey.set(row.sleeperId, row)
  }

  const byId = new Map<string, InjuryContext>()
  const unresolvedIds: string[] = []
  let resolvedCount = 0

  for (const id of requested) {
    const row = rowByKey.get(id)
    const ctx = projectInjuryContext(row ?? null, now)
    byId.set(id, ctx)
    if (ctx.resolved) {
      resolvedCount++
    } else {
      unresolvedIds.push(id)
    }
  }

  return { byId, resolvedCount, unresolvedIds, warnings: [] }
}

/**
 * Pure: fold per-player injury context onto the F2.1 metadata-enriched world. Never mutates
 * the base enriched view; returns a new additive injury/availability view.
 */
export function projectInjuryEnrichedWorld(
  world: EnrichedCanonicalWorld,
  contextResult: InjuryContextResult,
): InjuryEnrichedCanonicalWorld {
  const now = new Date()
  let requestedPlayers = 0
  let resolvedPlayers = 0
  let unavailablePlayers = 0
  let uncertainPlayers = 0
  let stalePlayers = 0
  const worldWarnings = new Set<string>()

  const rosters: InjuryEnrichedRosterFacts[] = world.rosters.map((roster) => {
    const injuryWarnings = new Set<string>()
    const players: InjuryEnrichedPlayer[] = roster.players.map((player) => {
      requestedPlayers += 1
      const ctx = contextResult.byId.get(player.playerId) ?? projectInjuryContext(null, now)

      if (ctx.resolved) resolvedPlayers++
      if (ctx.availabilityCategory === 'unavailable') unavailablePlayers++
      if (ctx.availabilityCategory === 'uncertain') uncertainPlayers++
      if (ctx.freshness.isStale === true) stalePlayers++
      for (const w of ctx.uncertainty) injuryWarnings.add(w)

      return { ...player, injuryContext: ctx }
    })

    const resolved = players.filter((p) => p.injuryContext.resolved).length

    for (const w of injuryWarnings) worldWarnings.add(w)

    return {
      ...roster,
      players,
      injuryCompleteness: pct(resolved, players.length),
      injuryWarnings: [...injuryWarnings],
    }
  })

  return {
    ...world,
    rosters,
    injurySummary: {
      requestedPlayers,
      resolvedPlayers,
      unavailablePlayers,
      uncertainPlayers,
      stalePlayers,
      completeness: pct(resolvedPlayers, requestedPlayers),
      warnings: [...worldWarnings],
    },
  }
}

/**
 * Read-only resolver: F2.1 metadata-enriched world → per-player injury context → additive
 * injury/availability view. Never throws; misses degrade to unresolved injury contexts.
 */
export async function resolveInjuryEnrichedCanonicalWorld(
  leagueId: string,
  deps: InjuryEnrichedWorldDeps = defaultInjuryEnrichedWorldDeps,
): Promise<InjuryEnrichedCanonicalWorld | null> {
  const world = await deps.resolveEnrichedWorld(leagueId)
  if (!world) return null
  const ids = Array.from(new Set(world.rosters.flatMap((r) => r.players.map((p) => p.playerId))))
  let contextResult: InjuryContextResult
  try {
    contextResult = await deps.resolveInjuryContext(world.league.sport, ids)
  } catch {
    const now = new Date()
    contextResult = {
      byId: new Map(ids.map((id) => [id, projectInjuryContext(null, now)])),
      resolvedCount: 0,
      unresolvedIds: ids,
      warnings: ['injury_context_source_unavailable'],
    }
  }
  return projectInjuryEnrichedWorld(world, contextResult)
}
