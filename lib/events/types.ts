/**
 * G15.1 — Event Foundation: core contracts.
 *
 * These types are the platform-wide vocabulary for domain events. They are:
 *   - sport agnostic        (no NFL/NCAAF/NBA assumptions; cadence lives in `period`)
 *   - league-concept agnostic (no redraft/dynasty/etc. assumptions)
 *   - provider agnostic     (subjects carry CANONICAL ids, never raw provider ids)
 *   - transport agnostic    (no Redis/BullMQ types leak here)
 *
 * Everything is an interface so every component is replaceable (DIP). Concrete
 * adapters live in sibling files; nothing here imports infrastructure.
 */

export const DEFAULT_TENANT = 'allfantasy'

export type EventActorType = 'user' | 'commissioner' | 'system' | 'provider'

export interface EventActor {
  type: EventActorType
  /** Canonical user/system id; null for anonymous/system actors. */
  id?: string | null
}

/**
 * Cadence-agnostic competition period. "week" is just one kind — daily-lineup
 * sports (NBA/MLB/NHL), continuous (soccer), and bracket stages are first-class.
 * This is what keeps the model free of NFL weekly assumptions.
 */
export type EventPeriodKind = 'week' | 'day' | 'gameday' | 'stage' | 'continuous' | 'none'

export interface EventPeriod {
  kind: EventPeriodKind
  index?: number | null
  label?: string | null
}

/**
 * A normalized reference to a platform entity. `id` is always an AllFantasy
 * canonical id — provider ids (sleeper:, nfl:def:, …) must be resolved before
 * an event is emitted.
 */
export interface EventSubjectRef {
  kind: string // 'player' | 'team' | 'roster' | 'matchup' | 'league' | 'season' | …
  id: string
  label?: string | null
}

export interface DomainEventMetadata {
  /** Origin of the event: 'engine' | 'ingestion:<provider>' | 'commissioner' | … */
  source: string
  correlationId?: string | null
  causationId?: string | null
  /** Open for additive, non-authoritative annotations. */
  [key: string]: unknown
}

/**
 * The normalized, persisted, fully-formed domain event (the envelope).
 * Immutable once created.
 */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  /** Globally unique id (idempotency anchor for consumers). */
  eventId: string
  /** Namespaced type, e.g. "competition.matchup.finalized". */
  type: string
  /** Additive schema version for `payload` (see EventSchemaRegistry). */
  schemaVersion: number
  /** Domain time (when it happened). */
  occurredAt: string
  /** Ingest time (when it was recorded). */
  recordedAt: string
  sport: string | null
  leagueConcept: string | null
  tenantId: string
  leagueId: string | null
  seasonId: string | null
  actor: EventActor
  period: EventPeriod | null
  subjects: EventSubjectRef[]
  payload: TPayload
  metadata: DomainEventMetadata
  /** Dedupe key for storage; defaults to eventId when not supplied. */
  idempotencyKey: string
}

/** Loose input accepted by the normalizer/publisher; envelope fields are derived. */
export interface DomainEventInput<TPayload = Record<string, unknown>> {
  type: string
  payload: TPayload
  schemaVersion?: number
  occurredAt?: string | Date
  sport?: string | null
  leagueConcept?: string | null
  tenantId?: string
  leagueId?: string | null
  seasonId?: string | null
  actor?: Partial<EventActor>
  period?: EventPeriod | null
  subjects?: EventSubjectRef[]
  metadata?: Partial<DomainEventMetadata> & { source?: string }
  eventId?: string
  idempotencyKey?: string
}

// ── Ports (interfaces) ───────────────────────────────────────────────────────

export type EventHandler = (event: DomainEvent) => void | Promise<void>

/**
 * Transport-agnostic event bus. The in-process adapter ships now; a Redis/BullMQ
 * adapter can replace it with zero call-site changes (LSP).
 */
export interface IEventBus {
  publish(event: DomainEvent): Promise<void>
  /**
   * Subscribe to an exact type ("a.b.c") or a wildcard prefix ("a.b.*" / "*").
   * Returns an unsubscribe function.
   */
  subscribe(typePattern: string, handler: EventHandler): () => void
}

/** Per-type, versioned payload validation registry. */
export interface IEventSchemaRegistry {
  register(type: string, version: number, validate: PayloadValidator): void
  has(type: string, version?: number): boolean
  latestVersion(type: string): number | undefined
  validate(type: string, version: number, payload: unknown): ValidationResult
}

export type ValidationResult = { ok: true } | { ok: false; error: string }
export type PayloadValidator = (payload: unknown) => ValidationResult

/** Optional handle to an active DB transaction (kept `unknown` to stay infra-agnostic). */
export interface PersistOptions {
  tx?: unknown
}

/** A pending outbox row with its delivery-attempt count (for retry/dead-letter decisions). */
export interface OutboxItem {
  event: DomainEvent
  attempts: number
}

/** Options for an atomic claim by a relay worker. */
export interface ClaimOptions {
  batchSize: number
  /** A claimed row whose `claimedAt` is older than this many ms is treated as stale and reclaimable. */
  staleClaimMs: number
  now?: Date
}

/**
 * Durable store for the transactional outbox. `enqueue` MUST run inside the
 * caller's transaction (when `tx` is provided) so the event commits atomically
 * with the business write. Delivery is a separate concern (OutboxRelay).
 */
export interface IOutboxStore {
  enqueue(event: DomainEvent, opts?: PersistOptions): Promise<void>
  /** Read-only peek: pending events only, oldest first. Used for dry-run (no claiming). */
  fetchPending(limit: number, now?: Date): Promise<DomainEvent[]>
  /** Read-only peek with attempt counts (oldest first). No state change. */
  claimPending(limit: number, now?: Date): Promise<OutboxItem[]>
  /**
   * ATOMICALLY claim a batch for `workerId`: marks rows 'claimed' (claimedBy/claimedAt)
   * and returns them. Claims rows that are due ('pending'/'retry' with availableAt<=now)
   * OR stale ('claimed' with claimedAt older than staleClaimMs). Two workers never get the
   * same row. Returns claimed events with their attempt counts.
   */
  claimBatch(workerId: string, opts: ClaimOptions): Promise<OutboxItem[]>
  markDispatched(eventId: string): Promise<void>
  /** Failed attempt: status='retry', attempts++, reschedule at nextAvailableAt, release claim. */
  markRetry(eventId: string, error: string, nextAvailableAt: Date): Promise<void>
  /** @deprecated use markRetry — kept for compatibility. */
  markFailed(eventId: string, error: string, nextAvailableAt: Date): Promise<void>
  /** Terminal failure: status becomes 'dead' (excluded from future claims). */
  markDead(eventId: string, error: string): Promise<void>
}

/**
 * A durable consumer of dispatched events. Handlers MUST be idempotent (keyed on
 * `event.eventId`) because delivery is at-least-once. A thrown error signals the
 * relay to retry (and eventually dead-letter) the event.
 */
export interface EventConsumer {
  readonly name: string
  handle(event: DomainEvent): Promise<void> | void
}

/** Persists a normalized event (and its outbox entry) — does NOT dispatch. */
export interface IEventPublisher {
  publish<T extends Record<string, unknown>>(
    input: DomainEventInput<T>,
    opts?: PersistOptions,
  ): Promise<DomainEvent<T>>
}

export class EventValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EventValidationError'
  }
}
