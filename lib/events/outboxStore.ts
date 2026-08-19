/**
 * G15.1 — Event Foundation: outbox stores (transactional outbox pattern).
 *
 * `enqueue` writes BOTH the durable DomainEvent row and its EventOutbox dispatch
 * row. When a caller passes its active transaction via `opts.tx`, both rows commit
 * ATOMICALLY with the business write — so an event can never exist without its
 * state change, nor a state change without its event (no dual-write hazard).
 *
 * Delivery is intentionally NOT done here — the OutboxRelay (./outboxRelay) reads
 * pending rows and publishes to the bus. This decouples persistence from transport
 * and is what makes horizontal scaling possible without a Redis dependency today.
 */
import type { DomainEvent, EventActor, EventPeriod, EventSubjectRef, IOutboxStore, OutboxItem, PersistOptions } from './types'

// ── Row <-> DomainEvent mapping ──────────────────────────────────────────────

interface DomainEventRow {
  eventId: string
  type: string
  schemaVersion: number
  occurredAt: Date
  recordedAt: Date
  sport: string | null
  leagueConcept: string | null
  tenantId: string
  leagueId: string | null
  seasonId: string | null
  actorType: string
  actorId: string | null
  source: string
  correlationId: string | null
  causationId: string | null
  idempotencyKey: string
  payload: unknown
  metadata: unknown
  period: unknown
  subjects: unknown
}

function toRow(event: DomainEvent): Omit<DomainEventRow, 'recordedAt'> & { recordedAt?: Date } {
  return {
    eventId: event.eventId,
    type: event.type,
    schemaVersion: event.schemaVersion,
    occurredAt: new Date(event.occurredAt),
    sport: event.sport,
    leagueConcept: event.leagueConcept,
    tenantId: event.tenantId,
    leagueId: event.leagueId,
    seasonId: event.seasonId,
    actorType: event.actor.type,
    actorId: event.actor.id ?? null,
    source: event.metadata.source,
    correlationId: event.metadata.correlationId ?? null,
    causationId: event.metadata.causationId ?? null,
    idempotencyKey: event.idempotencyKey,
    payload: event.payload,
    metadata: event.metadata,
    period: event.period,
    subjects: event.subjects,
  }
}

export function rowToDomainEvent(row: DomainEventRow): DomainEvent {
  return Object.freeze({
    eventId: row.eventId,
    type: row.type,
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    sport: row.sport,
    leagueConcept: row.leagueConcept,
    tenantId: row.tenantId,
    leagueId: row.leagueId,
    seasonId: row.seasonId,
    actor: { type: row.actorType as EventActor['type'], id: row.actorId },
    period: (row.period as EventPeriod | null) ?? null,
    subjects: (row.subjects as EventSubjectRef[]) ?? [],
    payload: (row.payload as Record<string, unknown>) ?? {},
    metadata: { source: row.source, ...((row.metadata as Record<string, unknown>) ?? {}) } as DomainEvent['metadata'],
    idempotencyKey: row.idempotencyKey,
  })
}

// ── Prisma-backed store (production) ─────────────────────────────────────────

/** Minimal shape of the Prisma delegates this store needs (keeps it loosely coupled). */
export interface PrismaLike {
  domainEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>
    findMany(args: Record<string, unknown>): Promise<DomainEventRow[]>
  }
  eventOutbox: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>
    findMany(args: Record<string, unknown>): Promise<{ eventId: string; attempts: number }[]>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  /** Raw query for the atomic claim (FOR UPDATE SKIP LOCKED + CAS). */
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>
}

export class PrismaOutboxStore implements IOutboxStore {
  /**
   * @param client the base Prisma client (used for relay reads/marks).
   *   `enqueue` prefers `opts.tx` so writes join the caller's transaction.
   */
  constructor(private readonly client: PrismaLike) {}

  private db(opts?: PersistOptions): PrismaLike {
    return (opts?.tx as PrismaLike | undefined) ?? this.client
  }

  async enqueue(event: DomainEvent, opts?: PersistOptions): Promise<void> {
    const db = this.db(opts)
    await db.domainEvent.create({ data: toRow(event) as Record<string, unknown> })
    await db.eventOutbox.create({
      data: { eventId: event.eventId, status: 'pending', attempts: 0, availableAt: new Date() },
    })
  }

  async fetchPending(limit: number, now: Date = new Date()): Promise<DomainEvent[]> {
    return (await this.claimPending(limit, now)).map((i) => i.event)
  }

  /** Read-only peek of due rows (no claiming) — used for dry-run. */
  async claimPending(limit: number, now: Date = new Date()): Promise<OutboxItem[]> {
    const due = await this.client.eventOutbox.findMany({
      where: { status: { in: ['pending', 'retry'] }, availableAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
    if (due.length === 0) return []
    const ids = due.map((p) => p.eventId)
    const attemptsById = new Map(due.map((p) => [p.eventId, p.attempts]))
    const rows = await this.client.domainEvent.findMany({ where: { eventId: { in: ids } } })
    const byId = new Map(rows.map((r) => [r.eventId, r]))
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is DomainEventRow => Boolean(r))
      .map((r) => ({ event: rowToDomainEvent(r), attempts: attemptsById.get(r.eventId) ?? 0 }))
  }

  /**
   * Atomic claim via Postgres `FOR UPDATE SKIP LOCKED` + a CAS status flip to 'claimed'.
   * Two workers can never claim the same row. Picks due rows (pending/retry, availableAt<=now)
   * and stale claims (status='claimed', claimedAt older than staleClaimMs).
   */
  async claimBatch(workerId: string, opts: { batchSize: number; staleClaimMs: number; now?: Date }): Promise<OutboxItem[]> {
    const now = opts.now ?? new Date()
    const staleThreshold = new Date(now.getTime() - opts.staleClaimMs)
    const sql = `
      UPDATE "event_outbox"
      SET status = 'claimed', "claimedBy" = $1, "claimedAt" = $2
      WHERE id IN (
        SELECT id FROM "event_outbox"
        WHERE ((status IN ('pending','retry') AND "availableAt" <= $2)
               OR (status = 'claimed' AND "claimedAt" IS NOT NULL AND "claimedAt" < $3))
        ORDER BY "createdAt" ASC
        LIMIT $4
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "eventId", attempts`
    const claimed = (await this.client.$queryRawUnsafe(sql, workerId, now, staleThreshold, opts.batchSize)) as {
      eventId: string
      attempts: number | bigint
    }[]
    if (!claimed.length) return []
    const ids = claimed.map((c) => c.eventId)
    const attemptsById = new Map(claimed.map((c) => [c.eventId, Number(c.attempts)]))
    const rows = await this.client.domainEvent.findMany({ where: { eventId: { in: ids } } })
    const byId = new Map(rows.map((r) => [r.eventId, r]))
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is DomainEventRow => Boolean(r))
      .map((r) => ({ event: rowToDomainEvent(r), attempts: attemptsById.get(r.eventId) ?? 0 }))
  }

  async markDispatched(eventId: string): Promise<void> {
    await this.client.eventOutbox.update({
      where: { eventId },
      data: { status: 'dispatched', dispatchedAt: new Date(), claimedBy: null, claimedAt: null },
    })
  }

  async markRetry(eventId: string, error: string, nextAvailableAt: Date): Promise<void> {
    await this.client.eventOutbox.update({
      where: { eventId },
      data: { status: 'retry', attempts: { increment: 1 }, lastError: error.slice(0, 1000), availableAt: nextAvailableAt, claimedBy: null, claimedAt: null },
    })
  }

  /** @deprecated use markRetry */
  async markFailed(eventId: string, error: string, nextAvailableAt: Date): Promise<void> {
    await this.markRetry(eventId, error, nextAvailableAt)
  }

  async markDead(eventId: string, error: string): Promise<void> {
    await this.client.eventOutbox.update({
      where: { eventId },
      data: { status: 'dead', attempts: { increment: 1 }, lastError: error.slice(0, 1000), claimedBy: null, claimedAt: null },
    })
  }
}

// ── In-memory store (tests / local) ──────────────────────────────────────────

type OutboxStatus = 'pending' | 'claimed' | 'retry' | 'dispatched' | 'dead'
interface InMemoryOutboxRow {
  status: OutboxStatus
  attempts: number
  availableAt: Date
  createdAt: Date
  lastError?: string
  dispatchedAt?: Date
  claimedBy?: string | null
  claimedAt?: Date | null
}

export class InMemoryOutboxStore implements IOutboxStore {
  readonly events = new Map<string, DomainEvent>()
  readonly outbox = new Map<string, InMemoryOutboxRow>()

  async enqueue(event: DomainEvent): Promise<void> {
    if (this.events.has(event.idempotencyKey)) {
      throw new Error(`duplicate idempotencyKey: ${event.idempotencyKey}`)
    }
    this.events.set(event.idempotencyKey, event)
    this.outbox.set(event.eventId, { status: 'pending', attempts: 0, availableAt: new Date(), createdAt: new Date() })
  }

  async fetchPending(limit: number, now: Date = new Date()): Promise<DomainEvent[]> {
    return (await this.claimPending(limit, now)).map((i) => i.event)
  }

  /** Read-only peek of due rows (no claiming). */
  async claimPending(limit: number, now: Date = new Date()): Promise<OutboxItem[]> {
    const byEventId = new Map([...this.events.values()].map((e) => [e.eventId, e]))
    return [...this.outbox.entries()]
      .filter(([, o]) => (o.status === 'pending' || o.status === 'retry') && o.availableAt <= now)
      .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime())
      .slice(0, limit)
      .map(([id, o]) => ({ event: byEventId.get(id), attempts: o.attempts }))
      .filter((i): i is OutboxItem => Boolean(i.event))
  }

  /**
   * Atomic claim. The read+mark critical section is synchronous (no await), so
   * concurrent callers in a single JS runtime can never claim the same row —
   * mirroring Postgres FOR UPDATE SKIP LOCKED for tests.
   */
  async claimBatch(workerId: string, opts: { batchSize: number; staleClaimMs: number; now?: Date }): Promise<OutboxItem[]> {
    const now = opts.now ?? new Date()
    const staleThreshold = new Date(now.getTime() - opts.staleClaimMs)
    const byEventId = new Map([...this.events.values()].map((e) => [e.eventId, e]))
    const eligible = [...this.outbox.entries()]
      .filter(
        ([, o]) =>
          ((o.status === 'pending' || o.status === 'retry') && o.availableAt <= now) ||
          (o.status === 'claimed' && o.claimedAt != null && o.claimedAt < staleThreshold),
      )
      .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime())
      .slice(0, opts.batchSize)
    const items: OutboxItem[] = []
    for (const [id, o] of eligible) {
      o.status = 'claimed'
      o.claimedBy = workerId
      o.claimedAt = now
      const event = byEventId.get(id)
      if (event) items.push({ event, attempts: o.attempts })
    }
    return items
  }

  async markDispatched(eventId: string): Promise<void> {
    const o = this.outbox.get(eventId)
    if (o) {
      o.status = 'dispatched'
      o.dispatchedAt = new Date()
      o.claimedBy = null
      o.claimedAt = null
    }
  }

  async markRetry(eventId: string, error: string, nextAvailableAt: Date): Promise<void> {
    const o = this.outbox.get(eventId)
    if (o) {
      o.attempts += 1
      o.lastError = error
      o.availableAt = nextAvailableAt
      o.status = 'retry'
      o.claimedBy = null
      o.claimedAt = null
    }
  }

  /** @deprecated use markRetry */
  async markFailed(eventId: string, error: string, nextAvailableAt: Date): Promise<void> {
    await this.markRetry(eventId, error, nextAvailableAt)
  }

  async markDead(eventId: string, error: string): Promise<void> {
    const o = this.outbox.get(eventId)
    if (o) {
      o.attempts += 1
      o.lastError = error
      o.status = 'dead'
      o.claimedBy = null
      o.claimedAt = null
    }
  }
}
