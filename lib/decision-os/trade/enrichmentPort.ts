/**
 * Decision OS — Phase E.5: the read-only trade-enrichment port (market seam).
 *
 * The canonical `TradeWorld` (E.3) owns MARKET INTERPRETATION (P1 corollary): ADP, position, projection,
 * market value. The Canonical World never carries these — they are decision-specific. This port is the
 * read-only seam that supplies them to `MarketContext`/`CanonicalTradeMemo` from already-persisted caches.
 *
 * SOURCES (audited E.5, all already-persisted, read-only — no new source invented):
 *   • ADP        — `AdpDataRecord` via `loadAdpRecords` (the SAME table+key the redraft snapshot-capture
 *                  path reads). Keyed by playerId + sport, freshest by createdAt. Live FFC is NEVER called.
 *   • position   — the D.1 `resolvePlayerMetadata` seam (persisted SportsPlayer cache). Authoritative;
 *                  the ADP record's position is a fallback only.
 *   • projection — persisted `FantasyProjection` rows via the F2.5 world port (playerId-keyed), anchored
 *                  to the canonical world's season/currentWeek. Unanchored/empty ⇒ honest `projection_*`
 *                  warnings — NEVER fabricated (P3).
 *   • marketValue— Phase F enrichment; honest-absent today.
 *
 * HONEST & READ-ONLY: never writes, never warms a cache, never calls a live provider API, never throws
 * (a prisma-unavailable env — e.g. local jsdom where `@/lib/prisma` is null — degrades to honest-empty
 * enrichment + warnings, so the canonical shadow keeps its honest-degraded path). Provider-agnostic:
 * `sport` + raw player ids only, no provider branch. Injectable for tests.
 *
 * The output is a `CanonicalMemoEnrichment` (the exact shape `resolveTradeWorld` consumes) — missing
 * values remain absent/null so the engine degrades honestly rather than inventing a value.
 */
import type { CanonicalMemoEnrichment } from './canonicalMemo'
import { loadAdpRecords, type AdpRecordRow } from './loader'
import { resolvePlayerMetadata, type PlayerMetadataResult } from '@/lib/decision-os/world'
import { loadProjectionRows } from '@/lib/decision-os/world/port'
import { projectProjectionContext } from '@/lib/decision-os/world/projectionEnrichedWorld'
import type { RawProjectionRow } from '@/lib/decision-os/world/facts'

export interface TradeEnrichmentPort {
  /** READ-ONLY: freshest-first persisted ADP records for the sport + player ids. NEVER writes/calls APIs. */
  loadAdp: (sport: string, playerIds: string[]) => Promise<AdpRecordRow[]>
  /** READ-ONLY: persisted player metadata (authoritative position) via the D.1 substrate seam. */
  resolveMetadata: (sport: string, playerIds: string[]) => Promise<PlayerMetadataResult>
  /**
   * READ-ONLY: persisted weekly projections via the F2.5 world port (`FantasyProjection`,
   * playerId-keyed — the provider-id-keyed source the D.1 audit predated). NEVER calls a live API.
   */
  loadProjections: (sport: string, playerIds: string[], season: string, week: number) => Promise<RawProjectionRow[]>
}

export const defaultTradeEnrichmentPort: TradeEnrichmentPort = {
  loadAdp: (sport, ids) => loadAdpRecords(sport, ids),
  resolveMetadata: (sport, ids) => resolvePlayerMetadata(sport, ids),
  loadProjections: (sport, ids, season, week) => loadProjectionRows(sport, ids, season, week),
}

export interface TradeEnrichmentResult {
  /** The market enrichment the trade resolver consumes — missing values stay absent/null (never faked). */
  enrichment: CanonicalMemoEnrichment
  /** Provenance/debug ONLY — which read-only sources contributed (e.g. `adp_data_record+sports_player_cache`); null when none did. */
  valuationSource: string | null
  /** Count of requested ids that resolved a real ADP value. */
  adpResolved: number
  /** Count of requested ids that resolved a real position. */
  positionResolved: number
  /** Count of requested ids that resolved a real stored projection (F2.5 port). */
  projectionResolved: number
  /** Requested ids that resolved NEITHER adp nor position. */
  unresolvedIds: string[]
  /** Honest missing-field notes (provenance/debug only — never consumed by decision rules). */
  warnings: string[]
}

function emptyResult(): TradeEnrichmentResult {
  return {
    enrichment: {},
    valuationSource: null,
    adpResolved: 0,
    positionResolved: 0,
    projectionResolved: 0,
    unresolvedIds: [],
    warnings: [],
  }
}

/**
 * Resolve the read-only market enrichment for a set of player ids. Pure orchestration over two injectable
 * read-only reads; never throws. Each source is independently guarded so one failing (e.g. prisma null)
 * degrades that field to honest-empty without losing the other.
 */
export async function resolveTradeEnrichment(
  args: {
    sport: string
    playerIds: string[]
    /** F2.5 projection anchor — when either is absent, projections stay honestly unavailable. */
    season?: number | null
    week?: number | null
    /** League scoring preset for the projection match tier (null ⇒ any_scoring + mismatch note). */
    scoringPresetId?: string | null
  },
  port: TradeEnrichmentPort = defaultTradeEnrichmentPort,
): Promise<TradeEnrichmentResult> {
  const ids = Array.from(new Set(args.playerIds.filter((x) => typeof x === 'string' && x.length > 0)))
  if (ids.length === 0) return emptyResult()

  const adpByPlayerId: Record<string, number | null> = {}
  const positionByPlayerId: Record<string, string | null> = {}
  // F2.5-fed below when the season/week anchor is present; otherwise honestly empty.
  const projectionByPlayerId: Record<string, number | null> = {}
  const warnings: string[] = []
  const contributing: string[] = []

  // ADP (freshest-first dedup) — the rows are ordered createdAt desc, so the FIRST row per id wins.
  try {
    const rows = await port.loadAdp(args.sport, ids)
    const seen = new Set<string>()
    for (const r of rows) {
      if (!r.playerId || seen.has(r.playerId)) continue
      seen.add(r.playerId)
      if (typeof r.adp === 'number' && Number.isFinite(r.adp)) adpByPlayerId[r.playerId] = r.adp
      // The record's position is a FALLBACK only — overwritten below by the authoritative metadata source.
      if (typeof r.position === 'string' && r.position.trim()) positionByPlayerId[r.playerId] = r.position
    }
    if (Object.keys(adpByPlayerId).length > 0) contributing.push('adp_data_record')
  } catch {
    warnings.push('adp_source_unavailable')
  }

  // Position (authoritative) — persisted SportsPlayer cache via the D.1 seam. Overrides the ADP fallback.
  try {
    const meta = await port.resolveMetadata(args.sport, ids)
    let metaContributed = false
    for (const id of ids) {
      const position = meta.byId.get(id)?.position
      if (typeof position === 'string' && position.trim()) {
        positionByPlayerId[id] = position
        metaContributed = true
      }
    }
    if (metaContributed) contributing.push('sports_player_cache')
  } catch {
    warnings.push('player_metadata_source_unavailable')
  }

  // Projection — F2.5 wiring: persisted `FantasyProjection` rows via the world port, anchored to the
  // canonical world's season/week. Absent anchor or empty store ⇒ honest gap, surfaced not fabricated.
  let projectionResolved = 0
  if (args.season != null && args.week != null && args.week > 0) {
    try {
      const rows = await port.loadProjections(args.sport, ids, String(args.season), args.week)
      const rowsByPlayer = new Map<string, RawProjectionRow[]>()
      for (const row of rows) {
        const list = rowsByPlayer.get(row.playerId)
        if (list) list.push(row)
        else rowsByPlayer.set(row.playerId, [row])
      }
      const now = new Date()
      let scoringMismatch = false
      for (const id of ids) {
        const ctx = projectProjectionContext(rowsByPlayer.get(id) ?? [], args.scoringPresetId ?? null, now)
        if (ctx.projectedPoints == null) continue
        projectionByPlayerId[id] = ctx.projectedPoints
        projectionResolved += 1
        if (ctx.matchTier === 'any_scoring') scoringMismatch = true
      }
      if (projectionResolved > 0) contributing.push('fantasy_projection')
      if (scoringMismatch) warnings.push('projection_scoring_format_mismatch')
    } catch {
      warnings.push('projection_source_unavailable')
    }
  } else {
    warnings.push('projection_week_unanchored')
  }
  if (projectionResolved === 0) warnings.push('projection_unavailable')

  const adpResolved = Object.values(adpByPlayerId).filter((v) => v != null).length
  const positionResolved = Object.values(positionByPlayerId).filter((v) => v != null).length
  const unresolvedIds = ids.filter((id) => adpByPlayerId[id] == null && positionByPlayerId[id] == null)
  if (unresolvedIds.length > 0) warnings.push('enrichment_incomplete')

  return {
    enrichment: { adpByPlayerId, positionByPlayerId, projectionByPlayerId },
    valuationSource: contributing.length > 0 ? contributing.join('+') : null,
    adpResolved,
    positionResolved,
    projectionResolved,
    unresolvedIds,
    warnings: Array.from(new Set(warnings)),
  }
}
