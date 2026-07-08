/**
 * G15.2 — Event Producers: the publishing convention layer.
 *
 * `PlatformEventProducer` is the ONE way business code emits catalog events. It is
 * fully type-checked against the catalog (`emit(type, args)` requires the matching
 * payload), and offers two modes:
 *
 *   • emit(type, args)            — BEST-EFFORT, post-commit. NEVER throws. Use when
 *                                   an event must not be able to affect the business
 *                                   action (the default for instrumentation).
 *   • emitInTx(tx, type, args)    — TRANSACTIONAL. Persists in the caller's tx so the
 *                                   event commits atomically with the state change.
 *                                   Propagates errors (atomicity). Use a RANDOM
 *                                   idempotencyKey (the default) so a duplicate can
 *                                   never abort the business tx.
 *
 * Sport/concept-agnostic: callers pass `sport`/`leagueConcept` from the league;
 * the producer makes no assumptions.
 */
import { getEventInfrastructure } from './container'
import { registerPlatformEventSchemas, EVENT_SCHEMA_VERSION, type EventType, type PayloadByType } from './catalog'
import type {
  DomainEvent,
  DomainEventInput,
  EventActor,
  EventPeriod,
  EventSubjectRef,
  IEventPublisher,
  IEventSchemaRegistry,
  PersistOptions,
} from './types'

/** Envelope context supplied per emit (everything except `type` + `payload`). */
export interface EmitContext {
  sport?: string | null
  leagueConcept?: string | null
  leagueId?: string | null
  seasonId?: string | null
  actor?: Partial<EventActor>
  period?: EventPeriod | null
  subjects?: EventSubjectRef[]
  /** Provide a deterministic key only when emitting best-effort and dedupe is desired. */
  idempotencyKey?: string
  correlationId?: string | null
  causationId?: string | null
  /** Origin tag; defaults to 'engine'. */
  source?: string
}

export type EmitArgs<T extends EventType> = EmitContext & { payload: PayloadByType[T] }

export class PlatformEventProducer {
  constructor(
    private readonly publisher: IEventPublisher,
    registry?: IEventSchemaRegistry,
  ) {
    if (registry) registerPlatformEventSchemas(registry)
  }

  private build<T extends EventType>(type: T, args: EmitArgs<T>): DomainEventInput<PayloadByType[T]> {
    return {
      type,
      schemaVersion: EVENT_SCHEMA_VERSION[type],
      payload: args.payload,
      sport: args.sport ?? null,
      leagueConcept: args.leagueConcept ?? null,
      leagueId: args.leagueId ?? null,
      seasonId: args.seasonId ?? null,
      actor: args.actor,
      period: args.period ?? null,
      subjects: args.subjects ?? [],
      idempotencyKey: args.idempotencyKey,
      metadata: {
        source: args.source ?? 'engine',
        correlationId: args.correlationId ?? null,
        causationId: args.causationId ?? null,
      },
    }
  }

  /** Best-effort, post-commit emission. NEVER throws — safe to call from any business path. */
  async emit<T extends EventType>(type: T, args: EmitArgs<T>): Promise<DomainEvent | null> {
    try {
      return await this.publisher.publish(this.build(type, args))
    } catch (err) {
      // Instrumentation must never break the business action it observes.
      console.warn(`[events] best-effort emit failed for ${type}:`, err instanceof Error ? err.message : err)
      return null
    }
  }

  /** Transactional emission — joins the caller's tx (atomic with the business write). Propagates errors. */
  async emitInTx<T extends EventType>(tx: unknown, type: T, args: EmitArgs<T>): Promise<DomainEvent> {
    const opts: PersistOptions = { tx }
    return this.publisher.publish(this.build(type, args), opts)
  }
}

// ── Default resolver (DI) ────────────────────────────────────────────────────

const g = globalThis as typeof globalThis & { __afPlatformEvents?: PlatformEventProducer }

/**
 * Resolve the process-wide producer. Wires the publisher + registers the catalog
 * schemas (idempotent) against the current event infrastructure. Swap the
 * underlying infra via `configureEventInfrastructure` before first resolve in tests.
 */
export function getPlatformEvents(): PlatformEventProducer {
  if (g.__afPlatformEvents) return g.__afPlatformEvents
  const infra = getEventInfrastructure()
  registerPlatformEventSchemas(infra.registry)
  g.__afPlatformEvents = new PlatformEventProducer(infra.publisher)
  return g.__afPlatformEvents
}

/** Clear the cached producer (tests). */
export function resetPlatformEvents(): void {
  delete g.__afPlatformEvents
}
