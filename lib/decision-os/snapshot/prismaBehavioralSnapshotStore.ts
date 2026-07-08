/**
 * Decision OS — Phase A Increment 5: Prisma-backed {@link BehavioralSnapshotStore}.
 *
 * Concrete adapter over the `DecisionOsBehavioralSnapshot` model. Idempotent by the unique
 * `(leagueId, managerId, periodKey)` constraint.
 *
 * ⚠ Deliberate design note (a real Postgres gotcha, caught before it shipped): a UNIQUE index on
 * a NULLABLE column does not enforce uniqueness against NULL in Postgres (NULL is never equal to
 * itself), which would silently break idempotency for league-scope rows if `managerId` were
 * nullable. The DB column is therefore `managerId String @default("__league__")` — a stable,
 * non-null sentinel for league-scope rows. The domain/pure layers never see this sentinel
 * (`BehavioralSnapshotRecord.managerId` stays `string | null`); this adapter is the ONLY place
 * that maps `null ↔ '__league__'`.
 *
 * Depends on a NARROW delegate (the shape of `prisma.decisionOsBehavioralSnapshot`), not the full
 * `PrismaClient` type — type-checks and unit-tests without regenerating the Prisma client.
 */

import type {
  BehavioralSnapshotStore,
  ListTrendParams,
  SnapshotUpsertResult,
} from './behavioralSnapshotStore'
import type {
  BehavioralSnapshotRecord,
  LeagueBehavioralSnapshotRecord,
  ManagerBehavioralSnapshotRecord,
} from './behavioralSnapshotCapture'
import type { LeagueBehavioralFacts, ManagerBehavioralFacts } from '../behavioral/facts'

export const LEAGUE_SCOPE_SENTINEL = '__league__'

export interface DecisionOsBehavioralSnapshotRow {
  leagueId: string
  managerId: string
  scope: string
  cadence: string
  periodKey: string
  capturedAt: Date
  lookbackDays: number | null
  eventCount: number
  completeness: number
  facts: unknown
  createdAt: Date
  updatedAt: Date
}

type CreateInput = Omit<DecisionOsBehavioralSnapshotRow, 'createdAt' | 'updatedAt'>
type UpdateInput = Omit<CreateInput, 'leagueId' | 'managerId' | 'periodKey'>

export interface DecisionOsBehavioralSnapshotDelegate {
  /** Explicit existence check BEFORE the upsert — see the note on `upsertByPeriod` below for why
   * this is required instead of inferring created-vs-updated from timestamps. */
  findUnique(args: {
    where: { leagueId_managerId_periodKey: { leagueId: string; managerId: string; periodKey: string } }
  }): Promise<{ id: string } | null>
  upsert(args: {
    where: { leagueId_managerId_periodKey: { leagueId: string; managerId: string; periodKey: string } }
    create: CreateInput
    update: UpdateInput
  }): Promise<unknown>
  findMany(args: {
    where: { leagueId: string; managerId: string }
    orderBy: { periodKey: 'asc' }
    take?: number
  }): Promise<DecisionOsBehavioralSnapshotRow[]>
  count(args?: { where?: Record<string, unknown> }): Promise<number>
}

function toManagerIdColumn(managerId: string | null): string {
  return managerId ?? LEAGUE_SCOPE_SENTINEL
}

function toManagerIdDomain(managerIdColumn: string): string | null {
  return managerIdColumn === LEAGUE_SCOPE_SENTINEL ? null : managerIdColumn
}

export function toBehavioralSnapshotCreateInput(record: BehavioralSnapshotRecord): CreateInput {
  return {
    leagueId: record.leagueId,
    managerId: toManagerIdColumn(record.managerId),
    scope: record.scope,
    cadence: record.cadence,
    periodKey: record.periodKey,
    capturedAt: new Date(record.capturedAt),
    lookbackDays: record.lookbackDays,
    eventCount: record.eventCount,
    completeness: record.completeness,
    facts: record.facts,
  }
}

function rowToRecord(row: DecisionOsBehavioralSnapshotRow): BehavioralSnapshotRecord {
  const managerId = toManagerIdDomain(row.managerId)
  const base = {
    leagueId: row.leagueId,
    cadence: row.cadence as BehavioralSnapshotRecord['cadence'],
    periodKey: row.periodKey,
    capturedAt: row.capturedAt.toISOString(),
    lookbackDays: row.lookbackDays,
    eventCount: row.eventCount,
    completeness: row.completeness,
  }
  if (managerId === null) {
    const record: LeagueBehavioralSnapshotRecord = {
      ...base,
      scope: 'league',
      managerId: null,
      facts: row.facts as LeagueBehavioralFacts,
    }
    return record
  }
  const record: ManagerBehavioralSnapshotRecord = {
    ...base,
    scope: 'manager',
    managerId,
    facts: row.facts as ManagerBehavioralFacts,
  }
  return record
}

export class PrismaBehavioralSnapshotStore implements BehavioralSnapshotStore {
  constructor(private readonly delegate: DecisionOsBehavioralSnapshotDelegate) {}

  async upsertByPeriod(record: BehavioralSnapshotRecord): Promise<SnapshotUpsertResult> {
    const create = toBehavioralSnapshotCreateInput(record)
    const { leagueId, managerId, periodKey, ...update } = create
    const where = { leagueId_managerId_periodKey: { leagueId, managerId, periodKey } }
    // Explicit existence check BEFORE the upsert (matches the Increment 3 ImportedActivityStore
    // adapter). Deliberately NOT inferring created-vs-updated from createdAt===updatedAt — that
    // comparison is a real re-run-safety hazard: two upserts issued back-to-back (the exact
    // "cron fires twice" scenario this increment must be safe against) can land in the same
    // millisecond, making a fresh row's createdAt/updatedAt collide with a re-run's timestamps
    // and misreport 'created' twice.
    const existing = await this.delegate.findUnique({ where })
    await this.delegate.upsert({ where, create, update })
    return { status: existing ? 'updated' : 'created' }
  }

  async listTrend(params: ListTrendParams): Promise<BehavioralSnapshotRecord[]> {
    const managerId = toManagerIdColumn(params.managerId ?? null)
    const rows = await this.delegate.findMany({
      where: { leagueId: params.leagueId, managerId },
      orderBy: { periodKey: 'asc' },
      take: params.limit,
    })
    return rows.map(rowToRecord)
  }

  count(): Promise<number> {
    return this.delegate.count()
  }
}
