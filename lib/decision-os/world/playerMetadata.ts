/**
 * Decision OS — Canonical World player-metadata enrichment seam (read-only, shadow-only).
 *
 * Canonical roster facts carry RAW player ids only (provider ids for imported leagues, native ids for
 * AllFantasy leagues). This seam resolves those ids into normalized player metadata — name / position /
 * team / injury status — from the persisted SportsPlayer cache (`loadPlayerMetadataRows` in ./port), the
 * SAME table + key the existing imported-league lineup scan reads (lib/lineup-actions/sleeperLineupScan).
 *
 * READ-ONLY & HONEST:
 *   - One `findMany` only. No writes. No cache warming. NO live provider API call (it reads the already-
 *     persisted cache row; the live Sleeper players endpoint in players-cache.ts is never touched here).
 *   - Bye week and projections are NOT present in any provider-id-keyed source, so they are returned
 *     null and surfaced as warnings — never fabricated.
 *   - Provider ids are the lookup key / PROVENANCE only; business logic consumes the normalized fields.
 *
 * It is provider-agnostic: it accepts a sport + raw id list and never branches on provider name. Reusable
 * by the lineup canonical bridge today and future waiver / trade bridges.
 */
import type { RawPlayerMetadataRow } from './facts'
import { loadPlayerMetadataRows } from './port'

/** Required metadata = the fields downstream lineup legality actually needs. */
const REQUIRED_FIELDS = ['name', 'position'] as const

export interface NormalizedPlayerMetadata {
  /** The raw id requested (provider id for imported leagues) — lookup key / PROVENANCE only. */
  playerId: string
  name: string | null
  position: string | null
  team: string | null
  injuryStatus: string | null
  /** Not carried by the metadata source today — always null (honest gap, never fabricated). */
  byeWeek: number | null
  /** No projection source keyed by player id is read in shadow — always null (never fabricated). */
  projectedPoints: number | null
  /** No projection source → confidence is unknown, never invented. */
  projectionConfidence: number | null
  /** Provenance: which cached source resolved this row; null when the id did not resolve. */
  source: string | null
  /** True ONLY when every REQUIRED field (name + position) resolved. */
  resolved: boolean
}

export interface PlayerMetadataResult {
  byId: Map<string, NormalizedPlayerMetadata>
  /** True ONLY when EVERY requested id resolved required metadata. False when none were requested. */
  complete: boolean
  /** Requested ids that did not resolve required metadata (name / position). */
  unresolvedIds: string[]
  /** Honest degradation notes (provenance/debug only — never consumed by decision rules). */
  warnings: string[]
}

export interface PlayerMetadataPort {
  /** Read-only: resolve persisted player rows for the given sport + raw ids. NEVER writes / calls APIs. */
  loadRows: (sport: string, ids: string[]) => Promise<RawPlayerMetadataRow[]>
}

export const defaultPlayerMetadataPort: PlayerMetadataPort = {
  loadRows: (sport, ids) => loadPlayerMetadataRows(sport, ids),
}

function emptyMeta(playerId: string): NormalizedPlayerMetadata {
  return {
    playerId,
    name: null,
    position: null,
    team: null,
    injuryStatus: null,
    byeWeek: null,
    projectedPoints: null,
    projectionConfidence: null,
    source: null,
    resolved: false,
  }
}

/**
 * Pure: fold raw cache rows into normalized metadata for the requested ids. Rows are indexed by BOTH
 * `externalId` and `sleeperId` (first row wins — callers pass freshest-first). A row resolves an id only
 * when both required fields (name + position) are present; otherwise the id is reported unresolved and
 * the result is flagged incomplete. byeWeek / projections stay null and add honest warnings.
 */
export function projectPlayerMetadata(
  rows: RawPlayerMetadataRow[],
  requestedIds: string[],
): PlayerMetadataResult {
  const requested = Array.from(new Set(requestedIds.filter((x) => typeof x === 'string' && x.length > 0)))

  // Index raw rows by every provider key they expose (first write wins → freshest row kept).
  const rowByKey = new Map<string, RawPlayerMetadataRow>()
  for (const row of rows) {
    if (row.externalId && !rowByKey.has(row.externalId)) rowByKey.set(row.externalId, row)
    if (row.sleeperId && !rowByKey.has(row.sleeperId)) rowByKey.set(row.sleeperId, row)
  }

  const byId = new Map<string, NormalizedPlayerMetadata>()
  const unresolvedIds: string[] = []

  for (const id of requested) {
    const row = rowByKey.get(id)
    if (!row) {
      byId.set(id, emptyMeta(id))
      unresolvedIds.push(id)
      continue
    }
    const name = row.name && row.name.trim() ? row.name : null
    const position = row.position && row.position.trim() ? row.position : null
    const resolved = REQUIRED_FIELDS.every((f) => (f === 'name' ? name : position) != null)
    byId.set(id, {
      playerId: id,
      name,
      position,
      team: row.team && row.team.trim() ? row.team : null,
      injuryStatus: row.status && row.status.trim() ? row.status : null,
      byeWeek: null, // honest gap — source carries no bye week
      projectedPoints: null, // honest gap — no projection source read in shadow
      projectionConfidence: null,
      source: row.source ?? null,
      resolved,
    })
    if (!resolved) unresolvedIds.push(id)
  }

  const complete = requested.length > 0 && unresolvedIds.length === 0
  const warnings: string[] = []
  if (requested.length > 0) {
    if (unresolvedIds.length > 0) warnings.push('player_metadata_missing')
    // These are unavailable from EVERY provider-id-keyed source today — surfaced, never fabricated.
    warnings.push('bye_week_unavailable')
    warnings.push('projection_unavailable')
  }

  return { byId, complete, unresolvedIds, warnings }
}

/**
 * Read-only resolver: load persisted player rows for `ids` (sport-scoped) and project them. NEVER throws —
 * a read failure (e.g. prisma unavailable in jsdom) degrades to a structured incomplete result so callers
 * keep their honest-degradation path. Provider-agnostic: `sport` + raw ids only, no provider branch.
 */
export async function resolvePlayerMetadata(
  sport: string,
  ids: string[],
  port: PlayerMetadataPort = defaultPlayerMetadataPort,
): Promise<PlayerMetadataResult> {
  const requested = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0)))
  if (requested.length === 0) {
    return { byId: new Map(), complete: false, unresolvedIds: [], warnings: [] }
  }
  try {
    const rows = await port.loadRows(sport, requested)
    return projectPlayerMetadata(rows, requested)
  } catch {
    return {
      byId: new Map(requested.map((id) => [id, emptyMeta(id)])),
      complete: false,
      unresolvedIds: requested,
      warnings: ['player_metadata_missing', 'player_metadata_source_unavailable'],
    }
  }
}
