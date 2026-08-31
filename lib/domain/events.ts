/**
 * Commissioner OS · domain event emission. T-007, step 9.
 *
 * ⚠ THIS ADAPTS ONTO THE EXISTING OUTBOX. IT DOES NOT BUILD ONE.
 * `lib/events/outboxStore.ts` already implements a transactional outbox whose
 * `enqueue(event, { tx })` joins the caller's transaction, backed by the
 * `DomainEvent` + `EventOutbox` tables. `DomainEvent` already carries
 * `tenantId`, `idempotencyKey`, `correlationId`/`causationId` and
 * `schemaVersion` — everything this needs. Building a second event store beside
 * a working one would be waste, and two stores means two answers to "did that
 * event fire".
 *
 * ─── WHY IN THE TRANSACTION, WHEN `CLAUDE.md` FORBIDS EXACTLY THAT ───────────
 * The rule is "never EMIT inside the transaction — it may roll back and you
 * push a notification about a trade that didn't happen". That is about
 * DELIVERY, and this does not deliver. It writes a row saying an event is due.
 *
 * The row rolls back with the mutation, so it cannot describe something that
 * did not happen. A separate relay delivers after commit, so nothing is lost if
 * the process dies. Emitting after commit in-process — which is what the
 * `EmitEvents` port does — closes the first hole and opens the second, and no
 * ordering of two in-process steps closes both.
 */

import { randomUUID } from 'node:crypto'
import type { ActorContext } from './actorContext'
import type { Tx } from './db'
import type { DomainEventDraft, EnqueueEvents } from './ports'

/** The slice of `IOutboxStore` this needs. Narrow on purpose. */
export type OutboxLike = {
  enqueue(event: Record<string, unknown>, opts?: { tx?: unknown }): Promise<void>
}

/**
 * Map a Commissioner OS actor onto the event store's actor vocabulary.
 *
 * `EventActorType` is `'user' | 'commissioner' | 'system' | 'provider'` — an
 * AllFantasy vocabulary that predates the three-axis context and does not line
 * up with it. Mapping it here, once, is better than every producer guessing.
 *
 * ⚠ The synthetic integration actor (`integration:<provider>`) maps to
 * `provider`, NOT to `system`. T-203 requires sync-caused rows to be
 * distinguishable from human writes, and `system` is what a cron job is; a
 * provider is untrusted input wearing an actor.
 */
export function eventActorFor(ctx: ActorContext): { type: string; id: string | null } {
  if (ctx.userId.startsWith('integration:')) return { type: 'provider', id: ctx.userId }
  if (ctx.leagueRole === 'COMMISSIONER' || ctx.leagueRole === 'CO_COMMISSIONER') {
    return { type: 'commissioner', id: ctx.userId }
  }
  return { type: 'user', id: ctx.userId }
}

/**
 * Build the store's event envelope from a draft plus context.
 *
 * Pure, so the mapping is testable without an outbox or a database.
 */
export function buildDomainEvent(
  ctx: ActorContext,
  draft: DomainEventDraft,
  now: Date,
  eventId: string,
): Record<string, unknown> {
  const occurredAt = now.toISOString()
  return {
    eventId,
    type: draft.type,
    schemaVersion: 1,
    occurredAt,
    recordedAt: occurredAt,
    sport: null,
    leagueConcept: null,
    tenantId: ctx.tenantId,
    leagueId: ctx.onBehalfOfLeagueId ?? null,
    seasonId: null,
    actor: eventActorFor(ctx),
    period: null,
    subjects: [],
    payload: draft.payload,
    metadata: {
      source: 'commissioner-os',
      // The request id ties this event to the audit row and the log line for
      // the same request. It is the only field that makes a "what happened
      // here" question answerable across all three.
      correlationId: ctx.requestId,
      causationId: null,
    },
    // Defaults to eventId. Distinct field because a producer that can compute a
    // natural key should use it — two retries of the same intent then collapse
    // to one event instead of two.
    idempotencyKey: eventId,
  }
}

export type OutboxEnqueueOptions = {
  readonly outbox: OutboxLike
  /** Injectable for tests; production passes nothing. */
  readonly now?: () => Date
  readonly newEventId?: () => string
}

/**
 * The `EnqueueEvents` implementation, backed by the existing outbox.
 *
 * ⚠ SEQUENTIAL, NOT `Promise.all`. These writes share the caller's transaction
 * and therefore one connection; issuing them concurrently on a single
 * interactive transaction is not a speed-up, and Prisma does not promise
 * ordering across concurrent calls on the same `tx`. Events from one mutation
 * should land in the order the definition declared them.
 */
export function createOutboxEnqueue(options: OutboxEnqueueOptions): EnqueueEvents {
  const now = options.now ?? (() => new Date())
  const newEventId = options.newEventId ?? (() => randomUUID())

  return async (tx: Tx, ctx: ActorContext, events: readonly DomainEventDraft[]) => {
    for (const draft of events) {
      await options.outbox.enqueue(buildDomainEvent(ctx, draft, now(), newEventId()), { tx })
    }
  }
}
