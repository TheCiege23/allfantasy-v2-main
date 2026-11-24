/**
 * Decision OS — Phase A Increment 3: Prisma-backed {@link ImportedActivityStore}.
 *
 * Concrete persistence adapter over the `DecisionOsImportedActivity` model. Idempotent by the
 * unique `externalSourceKey` (= the normalizer's deterministic natural key): repeated ingestion
 * `UPDATE`s the existing row instead of inserting a duplicate.
 *
 * It depends on a NARROW delegate interface (mirroring the shape of
 * `prisma.decisionOsImportedActivity`), not the full `PrismaClient` type — so the adapter
 * type-checks and unit-tests against an in-memory fake WITHOUT regenerating the Prisma client,
 * and the real client is injected in production (valid after `prisma generate`).
 */

import type {
  ImportedActivityStore,
  PersistedActivityRecord,
  UpsertResult,
} from './importedActivityStore'

/** The persisted row shape (mirrors the DecisionOsImportedActivity model). */
export interface DecisionOsImportedActivityRow {
  externalSourceKey: string
  provider: string
  providerLeagueId: string
  afLeagueId: string | null
  activityType: string
  providerEventId: string | null
  occurredAt: Date
  externalManagerId: string | null
  stableExternalManagerKey: string | null
  appUserId: string | null
  rosterId: string | null
  payload: unknown
  normalized: unknown
  createdAt: Date
  updatedAt: Date
}

type CreateInput = Omit<DecisionOsImportedActivityRow, 'createdAt' | 'updatedAt'>
/** Everything except identity/immutable columns is safe to overwrite on re-ingest. */
type UpdateInput = Omit<CreateInput, 'externalSourceKey'>

/** Narrow slice of `prisma.decisionOsImportedActivity` the adapter uses. */
export interface DecisionOsImportedActivityDelegate {
  findUnique(args: { where: { externalSourceKey: string } }): Promise<DecisionOsImportedActivityRow | null>
  /** Optional so in-memory fakes without it keep working; the real Prisma delegate has it. */
  findMany?(args: { where: { externalSourceKey: { in: string[] } } }): Promise<DecisionOsImportedActivityRow[]>
  upsert(args: {
    where: { externalSourceKey: string }
    create: CreateInput
    update: UpdateInput
  }): Promise<DecisionOsImportedActivityRow>
  count(args?: { where?: Record<string, unknown> }): Promise<number>
}

/** Map the provider-neutral persistence record to the row's create input (honest nullable defaults). */
export function toImportedActivityCreateInput(record: PersistedActivityRecord): CreateInput {
  return {
    externalSourceKey: record.naturalKey,
    provider: record.provider,
    // `record.leagueId` is the PROVIDER's league id; the AF canonical id travels separately as
    // `afLeagueId`. Writing the canonical id here corrupts both this column and the natural key.
    providerLeagueId: record.leagueId,
    afLeagueId: record.afLeagueId ?? null, // null when the provider league maps to no AF league — never fabricated
    activityType: record.activityType,
    providerEventId: null,
    occurredAt: new Date(record.occurredAt),
    externalManagerId: null,
    stableExternalManagerKey: null,
    appUserId: null, // per-manager AF linkage is Increment 4 — null, not fabricated
    rosterId: null,
    payload: record.payload ?? null,
    // Authoritative Decision OS attribution — the behavioral reader consumes managerKeys.
    normalized: {
      managerKeys: [...record.managerKeys],
      hasExternalOnlyManager: record.hasExternalOnlyManager,
      activityType: record.activityType,
    },
  }
}

/** Keys sorted at every depth, Dates as ISO strings — so a JSONB round trip compares equal. */
function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k]
      if (v !== undefined) out[k] = stable(v)
    }
    return out
  }
  return value
}

/** Everything an update would write, as one comparable string. */
function contentOf(row: UpdateInput | DecisionOsImportedActivityRow): string {
  return JSON.stringify(
    stable({
      provider: row.provider,
      providerLeagueId: row.providerLeagueId,
      afLeagueId: row.afLeagueId ?? null,
      activityType: row.activityType,
      providerEventId: row.providerEventId ?? null,
      occurredAt: row.occurredAt,
      externalManagerId: row.externalManagerId ?? null,
      stableExternalManagerKey: row.stableExternalManagerKey ?? null,
      appUserId: row.appUserId ?? null,
      rosterId: row.rosterId ?? null,
      payload: row.payload ?? null,
      normalized: row.normalized ?? null,
    }),
  )
}

/** Keys per `IN (...)` read. Postgres takes far more; this keeps each statement small. */
const PREFETCH_CHUNK = 500

export class PrismaImportedActivityStore implements ImportedActivityStore {
  constructor(private readonly delegate: DecisionOsImportedActivityDelegate) {}

  /**
   * 🛑 WHY THIS EXISTS (2026-11-23). Every record cost TWO sequential round trips — `findUnique` to
   * learn created-vs-updated, then `upsert` — and the cron re-ingests a league's WHOLE season each
   * visit, so ~500 unchanged rows meant ~1,000 queries to land a handful of new moves. Measured in
   * `sync_job_runs`: ~38 leagues per 180s fire (52 of 90 deferred), ~21,000 "rows written" a fire,
   * and 811 eligible leagues — about three weeks per lap, which left the inactive-manager ladder
   * calling a manager who moved yesterday "quiet 29 days".
   *
   * With a prefetch: ONE read per 500 keys; an unchanged row is not written at all; a changed or new
   * row is one upsert. Keys that were not prefetched fall back to the original two-step path.
   */
  private known: Map<string, string> | null = null

  async prefetch(naturalKeys: readonly string[]): Promise<void> {
    if (!this.delegate.findMany) return
    const known = new Map<string, string>()
    const keys = [...new Set(naturalKeys)]
    for (let i = 0; i < keys.length; i += PREFETCH_CHUNK) {
      const rows = await this.delegate.findMany({ where: { externalSourceKey: { in: keys.slice(i, i + PREFETCH_CHUNK) } } })
      for (const row of rows) known.set(row.externalSourceKey, contentOf(row))
    }
    // Absent keys are recorded too (as ''), so "not in the table" is known without another read.
    for (const k of keys) if (!known.has(k)) known.set(k, '')
    this.known = known
  }

  async upsertByNaturalKey(record: PersistedActivityRecord): Promise<UpsertResult> {
    const create = toImportedActivityCreateInput(record)
    const { externalSourceKey: _drop, ...update } = create
    const cached = this.known?.get(record.naturalKey)
    let existed: boolean
    if (cached !== undefined) {
      existed = cached !== ''
      if (existed && cached === contentOf(update)) return { status: 'unchanged' }
    } else {
      existed = (await this.delegate.findUnique({ where: { externalSourceKey: record.naturalKey } })) != null
    }
    await this.delegate.upsert({
      where: { externalSourceKey: record.naturalKey },
      create,
      update,
    })
    // What is now stored, so a duplicate key later in the same batch compares against it.
    this.known?.set(record.naturalKey, contentOf(update))
    return { status: existed ? 'updated' : 'created' }
  }

  count(): Promise<number> {
    return this.delegate.count()
  }

  async getByNaturalKey(naturalKey: string): Promise<PersistedActivityRecord | null> {
    const row = await this.delegate.findUnique({ where: { externalSourceKey: naturalKey } })
    if (!row) return null
    const normalized = (row.normalized ?? {}) as { managerKeys?: unknown; hasExternalOnlyManager?: unknown }
    const managerKeys = Array.isArray(normalized.managerKeys)
      ? normalized.managerKeys.filter((k): k is string => typeof k === 'string')
      : []
    return {
      naturalKey: row.externalSourceKey,
      provider: row.provider as PersistedActivityRecord['provider'],
      leagueId: row.providerLeagueId,
      afLeagueId: row.afLeagueId,
      activityType: row.activityType as PersistedActivityRecord['activityType'],
      occurredAt: row.occurredAt.toISOString(),
      managerKeys,
      hasExternalOnlyManager: normalized.hasExternalOnlyManager === true,
      payload: row.payload,
    }
  }
}
