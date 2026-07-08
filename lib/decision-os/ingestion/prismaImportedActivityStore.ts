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
    providerLeagueId: record.leagueId,
    afLeagueId: null, // AF-league mapping is Increment 4 — null, not fabricated
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

export class PrismaImportedActivityStore implements ImportedActivityStore {
  constructor(private readonly delegate: DecisionOsImportedActivityDelegate) {}

  async upsertByNaturalKey(record: PersistedActivityRecord): Promise<UpsertResult> {
    const existing = await this.delegate.findUnique({
      where: { externalSourceKey: record.naturalKey },
    })
    const create = toImportedActivityCreateInput(record)
    const { externalSourceKey: _drop, ...update } = create
    await this.delegate.upsert({
      where: { externalSourceKey: record.naturalKey },
      create,
      update,
    })
    return { status: existing ? 'updated' : 'created' }
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
      activityType: row.activityType as PersistedActivityRecord['activityType'],
      occurredAt: row.occurredAt.toISOString(),
      managerKeys,
      hasExternalOnlyManager: normalized.hasExternalOnlyManager === true,
      payload: row.payload,
    }
  }
}
