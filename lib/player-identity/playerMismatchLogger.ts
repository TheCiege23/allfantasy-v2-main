/**
 * Bounded rollup of draft-enrichment identity mismatches.
 *
 * Supersedes the per-event `player_identity_mismatch_logs` table, which reached 2,126,004 rows
 * / 787 MB in production (73% of the database) without ever being read. ~97% of those rows were
 * the same facts re-logged on every draft-pool resolve: the worst league wrote 512,840 rows
 * carrying only 3,981 distinct facts.
 *
 * Shape now:
 *   - `record()` is pure in-memory — zero I/O inside the enrichment loop.
 *   - Repeat facts collapse onto one bucket keyed by `mismatchFingerprint()`.
 *   - `flush()` persists the whole pass in ONE batched INSERT ... ON CONFLICT DO UPDATE.
 *
 * Row count is therefore bounded by the cardinality of the underlying data problem rather than
 * by traffic: re-opening the same draft room bumps `occurrences` instead of appending rows.
 *
 * Failures still never block draft resolution, but they are no longer invisible in production —
 * see `flush()`.
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logStructured } from '@/lib/logging/structured'

export type PlayerMismatchReason =
  | 'NO_SPORT_PLAYER_RECORD_MATCH'
  | 'AMBIGUOUS_LOOSE_MATCH_SKIPPED'
  | 'STRICT_TEAM_MISMATCH'
  | 'LOW_CONFIDENCE_MATCH'
  | 'ID_DRIFT_STRICT_MATCH_USED'
  | 'CROSS_SPORT_BLOCKED'
  | 'INVALID_PLAYER_ID'

export type PlayerMismatchLogPayload = {
  leagueId?: string | null
  sport: string
  poolPlayerId?: string | null
  poolExternalId?: string | null
  sportsPlayerRecordId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
  attemptedMatchType?: string | null
  confidence?: number | null
  reason: PlayerMismatchReason
  details?: Record<string, unknown> | null
}

/**
 * Hard ceiling on distinct facts held by one collector. The worst real league observed in
 * production carried 3,981 distinct facts, so this is ~25% headroom over the known worst case.
 * Past the cap we stop tracking NEW fingerprints but keep counting known ones, and report the
 * drop count on flush — a silent cap would misreport a widespread break as a small one.
 */
export const MAX_TRACKED_MISMATCHES = 5_000

/** Rows per INSERT. 16 params/row keeps us far below Postgres' 65535-parameter ceiling. */
const FLUSH_CHUNK_ROWS = 500

export type PlayerMismatchFlushResult = {
  /** Distinct facts held at flush time. */
  distinctFacts: number
  /** Raw record() calls represented by those facts. */
  occurrences: number
  /** Distinct facts discarded because MAX_TRACKED_MISMATCHES was hit. */
  dropped: number
  /** False when the write failed (already logged; never thrown). */
  ok: boolean
}

type MismatchBucket = {
  fingerprint: string
  leagueId: string | null
  sport: string
  reason: PlayerMismatchReason
  playerName: string | null
  position: string | null
  team: string | null
  occurrences: number
  lastPoolPlayerId: string | null
  lastPoolExternalId: string | null
  lastSportsPlayerRecordId: string | null
  lastAttemptedMatchType: string | null
  lastConfidence: number | null
  lastDetails: string | null
}

/** Trim, treat blank as absent, and clamp to the column width so a long value can't fail the insert. */
function normalize(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  if (trimmed === '') return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

/**
 * ASCII unit/record separators. Neither can occur in a player name, league id or team code, so
 * joining on them is unambiguous without escaping.
 */
const FIELD_SEPARATOR = '\u001F'
const NULL_SENTINEL = '\u001E'

/**
 * Identity of a mismatch fact. Must stay stable across releases — changing the inputs, their
 * order, or the separators re-keys the whole table and silently restarts every counter.
 *
 * Deliberately NOT JSON.stringify: the historical backfill folds 2.1M old rows onto these same
 * keys from inside Postgres, and this construction is exactly reproducible in SQL as
 *   encode(sha256(convert_to(concat_ws(E'\x1F', coalesce(<field>, E'\x1E'), ...), 'UTF8')), 'hex')
 * whereas JSON.stringify's escaping and spacing rules are not.
 * See prisma/migrations/.../backfill and __tests__/player-identity/playerMismatchLogger.test.ts,
 * which pins the digest so a refactor can't silently re-key the table.
 */
export function mismatchFingerprint(parts: {
  leagueId: string | null
  sport: string
  reason: string
  playerName: string | null
  position: string | null
  team: string | null
}): string {
  const joined = [
    parts.leagueId,
    parts.sport,
    parts.reason,
    parts.playerName,
    parts.position,
    parts.team,
  ]
    .map((value) => value ?? NULL_SENTINEL)
    .join(FIELD_SEPARATOR)

  return createHash('sha256').update(joined, 'utf8').digest('hex')
}

/**
 * Per-resolve accumulator. Construct one, pass it down the enrichment path, `flush()` once.
 * Not shared across requests: buckets are request-scoped so a long-lived instance can't grow
 * without bound.
 */
export class PlayerMismatchCollector {
  private readonly buckets = new Map<string, MismatchBucket>()
  private dropped = 0

  /** In-memory only. Safe to call inside a hot synchronous loop. */
  record(payload: PlayerMismatchLogPayload): void {
    const leagueId = normalize(payload.leagueId, 191)
    const sport = normalize(payload.sport, 16)?.toUpperCase() ?? ''
    if (sport === '') return

    const playerName = normalize(payload.playerName, 256)
    const position = normalize(payload.position, 64)
    const team = normalize(payload.team, 64)

    const fingerprint = mismatchFingerprint({
      leagueId,
      sport,
      reason: payload.reason,
      playerName,
      position,
      team,
    })

    const existing = this.buckets.get(fingerprint)
    if (existing) {
      existing.occurrences += 1
      existing.lastPoolPlayerId = normalize(payload.poolPlayerId, 128)
      existing.lastPoolExternalId = normalize(payload.poolExternalId, 128)
      existing.lastSportsPlayerRecordId = normalize(payload.sportsPlayerRecordId, 128)
      existing.lastAttemptedMatchType = normalize(payload.attemptedMatchType, 32)
      existing.lastConfidence = toFiniteConfidence(payload.confidence)
      existing.lastDetails = serializeDetails(payload.details)
      return
    }

    if (this.buckets.size >= MAX_TRACKED_MISMATCHES) {
      this.dropped += 1
      return
    }

    this.buckets.set(fingerprint, {
      fingerprint,
      leagueId,
      sport,
      reason: payload.reason,
      playerName,
      position,
      team,
      occurrences: 1,
      lastPoolPlayerId: normalize(payload.poolPlayerId, 128),
      lastPoolExternalId: normalize(payload.poolExternalId, 128),
      lastSportsPlayerRecordId: normalize(payload.sportsPlayerRecordId, 128),
      lastAttemptedMatchType: normalize(payload.attemptedMatchType, 32),
      lastConfidence: toFiniteConfidence(payload.confidence),
      lastDetails: serializeDetails(payload.details),
    })
  }

  /** Distinct facts currently held. */
  get size(): number {
    return this.buckets.size
  }

  /** Distinct facts discarded after hitting MAX_TRACKED_MISMATCHES. */
  get droppedCount(): number {
    return this.dropped
  }

  /** Test/debug view of the pending buckets. */
  snapshot(): ReadonlyArray<Readonly<MismatchBucket>> {
    return [...this.buckets.values()]
  }

  /**
   * Persist and reset. One INSERT per FLUSH_CHUNK_ROWS buckets; repeat facts increment
   * `occurrences` rather than inserting.
   *
   * Never throws: mismatch logging is diagnostics, and a logging failure must not fail a draft
   * pool resolve. Unlike the previous implementation it is never silent either — a failure is
   * reported through logStructured at error level in every environment, production included.
   */
  async flush(): Promise<PlayerMismatchFlushResult> {
    const pending = [...this.buckets.values()]
    const dropped = this.dropped
    this.buckets.clear()
    this.dropped = 0

    const occurrences = pending.reduce((sum, b) => sum + b.occurrences, 0)
    const result: PlayerMismatchFlushResult = {
      distinctFacts: pending.length,
      occurrences,
      dropped,
      ok: true,
    }

    if (pending.length === 0) {
      if (dropped > 0) logDropped(dropped, null)
      return result
    }

    try {
      for (let i = 0; i < pending.length; i += FLUSH_CHUNK_ROWS) {
        await persistChunk(pending.slice(i, i + FLUSH_CHUNK_ROWS))
      }
    } catch (error) {
      result.ok = false
      // Deliberately loud in production: the previous logger swallowed this branch entirely
      // (`if (NODE_ENV !== 'production')`), so a connection storm from this path failed invisibly.
      // No player names or league-member data in `meta` — see lib/logging/structured.ts.
      logStructured('error', 'player_mismatch_logger', 'flush_failed', {
        distinctFacts: pending.length,
        occurrences,
        dropped,
        sports: [...new Set(pending.map((b) => b.sport))],
        reasons: [...new Set(pending.map((b) => b.reason))],
        error: error instanceof Error ? error.message : String(error),
      })
      return result
    }

    if (dropped > 0) logDropped(dropped, pending[0]?.sport ?? null)
    return result
  }
}

function logDropped(dropped: number, sport: string | null): void {
  logStructured('warn', 'player_mismatch_logger', 'tracking_cap_exceeded', {
    dropped,
    cap: MAX_TRACKED_MISMATCHES,
    sport,
  })
}

function toFiniteConfidence(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

function serializeDetails(details: Record<string, unknown> | null | undefined): string | null {
  if (details == null) return null
  try {
    return JSON.stringify(details)
  } catch {
    return null
  }
}

/**
 * Explicit casts on every parameter: multi-row VALUES gives Postgres no column context for
 * all-NULL parameter positions, which otherwise fails with "could not determine data type".
 */
async function persistChunk(chunk: MismatchBucket[]): Promise<void> {
  const values = chunk.map(
    (b) => Prisma.sql`(
      ${b.fingerprint}::varchar(64),
      ${b.leagueId}::text,
      ${b.sport}::varchar(16),
      ${b.reason}::varchar(64),
      ${b.playerName}::varchar(256),
      ${b.position}::varchar(64),
      ${b.team}::varchar(64),
      ${b.occurrences}::integer,
      ${b.lastPoolPlayerId}::varchar(128),
      ${b.lastPoolExternalId}::varchar(128),
      ${b.lastSportsPlayerRecordId}::varchar(128),
      ${b.lastAttemptedMatchType}::varchar(32),
      ${b.lastConfidence}::decimal(5,4),
      ${b.lastDetails}::jsonb,
      NOW(),
      NOW()
    )`,
  )

  await prisma.$executeRaw`
    INSERT INTO "player_identity_mismatch_stats" (
      "fingerprint", "league_id", "sport", "reason", "player_name", "position", "team",
      "occurrences", "last_pool_player_id", "last_pool_external_id", "last_sports_player_record_id",
      "last_attempted_match_type", "last_confidence", "last_details", "first_seen_at", "last_seen_at"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("fingerprint") DO UPDATE SET
      "occurrences" = "player_identity_mismatch_stats"."occurrences" + EXCLUDED."occurrences",
      -- COALESCE, not a bare assignment: a sighting that omits one of these must not erase a
      -- real earlier observation. Today every code path recording a given fingerprint populates
      -- the same fields, so this cannot fire -- it exists so that a future caller which reports
      -- less detail degrades to "last KNOWN value" instead of silently nulling the diagnostics.
      -- Same rule the historical backfill follows by omitting these columns entirely.
      "last_pool_player_id" = COALESCE(EXCLUDED."last_pool_player_id", "player_identity_mismatch_stats"."last_pool_player_id"),
      "last_pool_external_id" = COALESCE(EXCLUDED."last_pool_external_id", "player_identity_mismatch_stats"."last_pool_external_id"),
      "last_sports_player_record_id" = COALESCE(EXCLUDED."last_sports_player_record_id", "player_identity_mismatch_stats"."last_sports_player_record_id"),
      "last_attempted_match_type" = COALESCE(EXCLUDED."last_attempted_match_type", "player_identity_mismatch_stats"."last_attempted_match_type"),
      "last_confidence" = COALESCE(EXCLUDED."last_confidence", "player_identity_mismatch_stats"."last_confidence"),
      "last_details" = COALESCE(EXCLUDED."last_details", "player_identity_mismatch_stats"."last_details"),
      "last_seen_at" = GREATEST("player_identity_mismatch_stats"."last_seen_at", EXCLUDED."last_seen_at")
  `
}

export function summarizePlayerMismatchForAi(event: PlayerMismatchLogPayload): string {
  const parts = [
    `reason=${event.reason}`,
    `sport=${event.sport}`,
    event.leagueId ? `league=${event.leagueId}` : null,
    event.playerName ? `player=${event.playerName}` : null,
    event.position ? `pos=${event.position}` : null,
    event.team != null ? `team=${event.team}` : null,
    event.poolExternalId ? `poolExternalId=${event.poolExternalId}` : null,
    event.poolPlayerId ? `poolPlayerId=${event.poolPlayerId}` : null,
    event.sportsPlayerRecordId ? `sprId=${event.sportsPlayerRecordId}` : null,
    event.attemptedMatchType ? `attempted=${event.attemptedMatchType}` : null,
    event.confidence != null ? `confidence=${event.confidence}` : null,
  ].filter(Boolean)
  return `Player identity mismatch: ${parts.join('; ')}. Review IDs and team normalization before merging enrichment.`
}
