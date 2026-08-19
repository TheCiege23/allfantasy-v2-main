import 'server-only'
/**
 * Fantasy OS Phase 5B — database-backed runtime store (Part 3).
 *
 * Implements the Phase 4 sync `SyncLock` + `SyncStore` interfaces against the NON-PRODUCTION `sports_data`
 * schema, plus append-only snapshot + idempotent event persistence. Env-gated (same gate as the exec reader);
 * fails closed. Invariants preserved: partial/failed scope never certifies; freshness advances only after a
 * completed run; reruns create no duplicate records/events (deterministic keys + ON CONFLICT).
 */
import type { SyncLock, SyncStore, RunResult } from '@/lib/fantasy-os/sync/runner'
import type { SnapshotDraft } from './snapshot'
import { canCertify, countSnapshot } from './snapshot'
import { diffSnapshot, type DiffEvent } from './events'

type PgPool = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> }

let poolPromise: Promise<PgPool | null> | null = null

function gate(): { ok: true; url: string } | { ok: false; detail: string } {
  if (process.env.FANTASY_OS_EXEC_ENABLED !== 'true') return { ok: false, detail: 'FANTASY_OS_EXEC_ENABLED != true' }
  const url = process.env.FANTASY_OS_EXEC_DATABASE_URL
  if (!url) return { ok: false, detail: 'FANTASY_OS_EXEC_DATABASE_URL not set' }
  return { ok: true, url }
}

async function getPool(): Promise<PgPool> {
  const g = gate()
  if (!g.ok) throw new Error(`sports runtime store disabled: ${g.detail}`)
  if (!poolPromise) {
    poolPromise = (async () => {
      const mod = (await import('pg')) as unknown as { default?: { Pool: new (c: unknown) => PgPool }; Pool?: new (c: unknown) => PgPool }
      const Pool = mod.Pool ?? mod.default?.Pool
      if (!Pool) return null
      return new Pool({ connectionString: g.url, max: 3, statement_timeout: 15000 })
    })()
  }
  const p = await poolPromise
  if (!p) throw new Error('sports runtime store pool unavailable')
  return p
}

export class SportsRuntimeStore {
  // ── SyncLock (leased; stale-lease recovery via expires_at) ────────────────────
  async acquire(key: string, leaseMs: number, now: Date): Promise<{ acquired: boolean; token?: string }> {
    const pool = await getPool()
    const token = `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`
    const expires = new Date(now.getTime() + leaseMs).toISOString()
    const res = await pool.query(
      `INSERT INTO sports_data.sync_lock (lock_key, token, expires_at, acquired_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (lock_key) DO UPDATE SET token=EXCLUDED.token, expires_at=EXCLUDED.expires_at, acquired_at=EXCLUDED.acquired_at
       WHERE sports_data.sync_lock.expires_at < $4
       RETURNING token`,
      [key, token, expires, now.toISOString()],
    )
    return res.rows[0] ? { acquired: true, token } : { acquired: false }
  }
  async release(key: string, token: string): Promise<void> {
    const pool = await getPool()
    await pool.query(`DELETE FROM sports_data.sync_lock WHERE lock_key=$1 AND token=$2`, [key, token])
  }

  // ── SyncStore ─────────────────────────────────────────────────────────────────
  async getCheckpoint(runKey: string, scope: string): Promise<string | null> {
    const pool = await getPool()
    const r = await pool.query(`SELECT checkpoint FROM sports_data.sync_checkpoint WHERE run_key=$1 AND scope=$2`, [runKey, scope])
    return r.rows[0]?.checkpoint ? String(r.rows[0].checkpoint) : null
  }
  async saveCheckpoint(runKey: string, scope: string, checkpoint: string): Promise<void> {
    const pool = await getPool()
    await pool.query(
      `INSERT INTO sports_data.sync_checkpoint (run_key, scope, checkpoint, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (run_key, scope) DO UPDATE SET checkpoint=EXCLUDED.checkpoint, updated_at=now()`,
      [runKey, scope, checkpoint],
    )
  }
  async setLastSuccessfulSyncAt(runKey: string, iso: string): Promise<void> {
    const pool = await getPool()
    await pool.query(
      `INSERT INTO sports_data.sync_freshness (run_key, last_successful_sync_at, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (run_key) DO UPDATE SET last_successful_sync_at=EXCLUDED.last_successful_sync_at, updated_at=now()`,
      [runKey, iso],
    )
  }
  async getLastSuccessfulSyncAt(runKey: string): Promise<string | null> {
    const pool = await getPool()
    const r = await pool.query(`SELECT last_successful_sync_at FROM sports_data.sync_freshness WHERE run_key=$1`, [runKey])
    return r.rows[0]?.last_successful_sync_at ? String(r.rows[0].last_successful_sync_at) : null
  }
  async recordRun(result: RunResult): Promise<void> {
    const pool = await getPool()
    const a = result.accounting
    await pool.query(
      `INSERT INTO sports_data.sync_run (run_id, run_key, sport, season_state, status, started_at, finished_at, checkpoint, request_attempts, logical_requests, retries, cache_hits, successful, not_found, permanent_failures, imported, unchanged, rejected, advanced_freshness, warnings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
       ON CONFLICT (run_id) DO NOTHING`,
      [result.runKey + ':' + result.startedAt, result.runKey, null, result.seasonState, result.status, result.startedAt, result.finishedAt, JSON.stringify(result.checkpoint), a.requestAttempts, a.logicalRequests, a.retries, a.cacheHits, a.successful, a.notFound, a.permanentFailures, a.imported, a.unchanged, a.rejected, result.advancedFreshness, JSON.stringify(result.warnings)],
    )
  }

  // ── Snapshot + event persistence ────────────────────────────────────────────
  /** Previous certified content hashes (canonicalKey → contentHash) for change detection. */
  async previousCertifiedHashes(sport: string, capability: string, scopeRef: string | null = null): Promise<{ snapshotId: string | null; hashes: Map<string, string> }> {
    const pool = await getPool()
    const snap = await pool.query(
      `SELECT snapshot_id FROM sports_data.sports_snapshot WHERE sport=$1 AND capability=$2 AND scope_ref IS NOT DISTINCT FROM $3 AND status='certified' ORDER BY generated_at DESC LIMIT 1`,
      [sport, capability, scopeRef],
    )
    const id = snap.rows[0]?.snapshot_id ? String(snap.rows[0].snapshot_id) : null
    const hashes = new Map<string, string>()
    if (id) {
      const recs = await pool.query(`SELECT canonical_key, record->'__contentHash' AS h FROM sports_data.sports_snapshot_record WHERE snapshot_id=$1`, [id])
      for (const r of recs.rows) if (r.h) hashes.set(String(r.canonical_key), String(r.h).replace(/"/g, ''))
    }
    return { snapshotId: id, hashes }
  }

  /** Persist a certifiable snapshot draft (append-only) + its records. Returns counts. Never updates in place. */
  async persistCertifiedSnapshot(draft: SnapshotDraft): Promise<{ certified: boolean; reasons?: string[]; checksum?: string }> {
    const decision = canCertify(draft)
    if (!decision.certifiable) return { certified: false, reasons: decision.reasons }
    const pool = await getPool()
    const counts = decision.counts
    await pool.query(
      `INSERT INTO sports_data.sports_snapshot (snapshot_id, version, sport, capability, scope_ref, provider, status, generated_at, source_updated_at, record_count, resolved_count, ambiguous_count, unresolved_count, rejected_count, checksum, previous_snapshot_id, limitations)
       VALUES ($1,$2,$3,$4,$5,$6,'certified',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       ON CONFLICT (snapshot_id) DO NOTHING`,
      [draft.snapshotId, draft.version, draft.sport, draft.capability, draft.scopeRef ?? null, draft.provider, draft.generatedAt, draft.sourceUpdatedAt, counts.recordCount, counts.resolvedCount, counts.ambiguousCount, counts.unresolvedCount, counts.rejectedCount, decision.checksum, draft.previousSnapshotId, JSON.stringify(draft.limitations)],
    )
    for (const r of draft.records) {
      const stored = { ...(r.record as Record<string, unknown>), __contentHash: r.contentHash }
      await pool.query(
        `INSERT INTO sports_data.sports_snapshot_record (snapshot_id, canonical_key, resolution_status, record) VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (snapshot_id, canonical_key) DO NOTHING`,
        [draft.snapshotId, r.canonicalKey, r.resolutionStatus, JSON.stringify(stored)],
      )
    }
    return { certified: true, checksum: decision.checksum }
  }

  /** Idempotent event insert (ON CONFLICT on deterministic event_id → no duplicates on rerun). */
  async insertEvents(events: DiffEvent[], meta: { sport: string; provider: string; snapshotVersion: string; occurredAt: string }): Promise<number> {
    if (events.length === 0) return 0
    const pool = await getPool()
    let inserted = 0
    for (const e of events) {
      const res = await pool.query(
        `INSERT INTO sports_data.sports_event (event_id, event_type, sport, entity_id, occurred_at, observed_at, provider, snapshot_version, payload, provenance)
         VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8::jsonb,$9::jsonb)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [e.eventId, e.eventType, meta.sport, e.entityId, meta.occurredAt, meta.provider, meta.snapshotVersion, JSON.stringify(e.record), JSON.stringify({ provider: meta.provider, snapshotVersion: meta.snapshotVersion })],
      )
      if (res.rows[0]) inserted++
    }
    return inserted
  }

  /** Latest CERTIFIED snapshot metadata (never building/partial/rejected). Deterministic latest = newest generated_at. */
  async getCertifiedSnapshotMeta(sport: string, capability: string, scopeRef: string | null = null): Promise<CertifiedSnapshotMeta | null> {
    const pool = await getPool()
    const snap = await pool.query(
      `SELECT snapshot_id, version, checksum, provider, generated_at, source_updated_at, record_count, resolved_count, ambiguous_count, unresolved_count, rejected_count, limitations
       FROM sports_data.sports_snapshot WHERE sport=$1 AND capability=$2 AND scope_ref IS NOT DISTINCT FROM $3 AND status='certified' ORDER BY generated_at DESC LIMIT 1`,
      [sport, capability, scopeRef],
    )
    const r = snap.rows[0]
    if (!r) return null
    return {
      snapshotId: String(r.snapshot_id),
      version: String(r.version),
      checksum: String(r.checksum),
      provider: String(r.provider),
      generatedAt: String(r.generated_at),
      sourceUpdatedAt: r.source_updated_at ? String(r.source_updated_at) : null,
      recordCount: Number(r.record_count),
      resolvedCount: Number(r.resolved_count),
      ambiguousCount: Number(r.ambiguous_count),
      unresolvedCount: Number(r.unresolved_count),
      rejectedCount: Number(r.rejected_count),
      limitations: (r.limitations as string[] | null) ?? [],
    }
  }

  /** OS-consumer read: the latest certified snapshot's records (canonical, provider-neutral), deterministically ordered. */
  async getCertifiedRecords(sport: string, capability: string, scopeRef: string | null = null): Promise<{ snapshotId: string | null; version: string | null; records: unknown[] }> {
    const pool = await getPool()
    const snap = await pool.query(
      `SELECT snapshot_id, version FROM sports_data.sports_snapshot WHERE sport=$1 AND capability=$2 AND scope_ref IS NOT DISTINCT FROM $3 AND status='certified' ORDER BY generated_at DESC LIMIT 1`,
      [sport, capability, scopeRef],
    )
    const id = snap.rows[0]?.snapshot_id ? String(snap.rows[0].snapshot_id) : null
    if (!id) return { snapshotId: null, version: null, records: [] }
    const recs = await pool.query(`SELECT record FROM sports_data.sports_snapshot_record WHERE snapshot_id=$1 ORDER BY canonical_key ASC`, [id])
    return { snapshotId: id, version: snap.rows[0].version ? String(snap.rows[0].version) : null, records: recs.rows.map((r) => r.record) }
  }
}

export type CertifiedSnapshotMeta = {
  snapshotId: string
  version: string
  checksum: string
  provider: string
  generatedAt: string
  sourceUpdatedAt: string | null
  recordCount: number
  resolvedCount: number
  ambiguousCount: number
  unresolvedCount: number
  rejectedCount: number
  limitations: string[]
}

/** Adapt the store to the Phase 4 runner interfaces (so the existing runner drives it). */
export function asSyncLock(store: SportsRuntimeStore): SyncLock {
  return { acquire: (k, l, n) => store.acquire(k, l, n), release: (k, t) => store.release(k, t) }
}
export function asSyncStore(store: SportsRuntimeStore, persistScope: SyncStore['persistScope']): SyncStore {
  return {
    getCheckpoint: (rk, s) => store.getCheckpoint(rk, s),
    saveCheckpoint: (rk, s, c) => store.saveCheckpoint(rk, s, c),
    persistScope,
    recordRun: (r) => store.recordRun(r),
    setLastSuccessfulSyncAt: (rk, iso) => store.setLastSuccessfulSyncAt(rk, iso),
  }
}
