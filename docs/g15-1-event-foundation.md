# G15.1 — Event Foundation

**Status:** complete. Infrastructure layer only — no Intelligence/Story/Chimmy/Commissioner
features. Nothing existing is rerouted onto this layer (that is G15.2+).

The Event Foundation is the durable, normalized, transport-agnostic spine every future system
(Intelligence Engine, Story Engine, Chimmy, Commissioner Hub, external API) will read from.
See `docs/g15-commissioner-intelligence-architecture.md` for the surrounding architecture.

---

## 1. Architecture

```
 Business code ──tx──►  EventPublisher.publish(input, { tx })
                              │ 1. EventNormalizer (defaults + envelope + payload validation)
                              │ 2. OutboxStore.enqueue  →  DomainEvent row + EventOutbox row
                              ▼  (both committed in the SAME transaction as the business write)
                        ┌─────────────────────────┐
                        │  domain_events (log)     │  append-only system of record for events
                        │  event_outbox (dispatch) │  pending → dispatched / retry
                        └───────────┬─────────────┘
                                    │  OutboxRelay.dispatchPending()  (separate process/cron/worker)
                                    ▼
                              IEventBus.publish  ──►  subscribers (idempotent consumers)
```

**Modules (`lib/events/`, imported via `@/lib/events`):**

| File | Responsibility | Port / Impl |
|---|---|---|
| `types.ts` | Contracts: `DomainEvent`, `DomainEventInput`, `IEventBus`, `IOutboxStore`, `IEventPublisher`, `IEventSchemaRegistry` | ports |
| `envelope.ts` | `normalizeDomainEvent` + Zod `domainEventEnvelopeSchema` | — |
| `schemaRegistry.ts` | `InMemoryEventSchemaRegistry`, `zodValidator` | impl |
| `eventBus.ts` | `InProcessEventBus` + `inProcessEventBus` singleton | adapter |
| `normalizer.ts` | `EventNormalizer` (defaults → envelope → payload validation) | impl |
| `outboxStore.ts` | `PrismaOutboxStore` (prod), `InMemoryOutboxStore` (tests) | adapters |
| `eventPublisher.ts` | `EventPublisher` | impl |
| `outboxRelay.ts` | `OutboxRelay` (drains outbox → bus, retry/backoff) | impl |
| `container.ts` | DI composition root: `getEventInfrastructure`, `configureEventInfrastructure`, `reset…` | wiring |
| `index.ts` | public barrel | — |

Every component is an interface with a swappable implementation (DIP). The default graph is
built lazily and cached on `globalThis`; tests/adapters swap any part via
`configureEventInfrastructure`.

---

## 2. The DomainEvent (normalized, future-proof)

Sport-, concept-, and provider-agnostic by construction:

- **Cadence lives in `period`** (`week | day | gameday | stage | continuous | none`) — no NFL
  "week" assumption; NBA/MLB/NHL daily, soccer continuous, brackets by stage all fit.
- **Sport-specific detail lives in `payload` / `metadata`** (JSON) — a new sport adds keys, not
  columns.
- **`subjects[]` carry CANONICAL ids** (`{kind,id,label}`) — raw provider ids
  (`sleeper:`, `nfl:def:`) must be resolved before emit.
- **`tenantId`** is present from day one for future white-label/multi-tenant.
- **Versioning** is the `schemaVersion` field + the schema registry (additive — new version,
  never mutate an old one). **Metadata** is the open `metadata` map (`source`, `correlationId`,
  `causationId`, …). These satisfy the "event metadata" + "event versioning" needs as
  first-class fields rather than extra tables.

---

## 3. Event lifecycle

1. **Define** (G15.2+): register a payload schema — `getEventSchemaRegistry().register(type, version, zodValidator(schema))`.
2. **Emit**: `publish(input, { tx })` inside the business transaction.
3. **Normalize + validate**: defaults filled; envelope validated; payload validated if the
   `(type, version)` is registered (non-strict mode lets unregistered types through, flagged
   `metadata.schemaUnregistered=true`; flip `strict` once schemas exist).
4. **Persist atomically**: `domain_events` + `event_outbox` rows commit with the business write.
5. **Dispatch**: `OutboxRelay.dispatchPending()` publishes pending events to the bus and marks
   them `dispatched`, or schedules a backed-off retry on failure.
6. **Consume**: subscribers handle events idempotently (keyed on `eventId`).

---

## 4. Publishing flow (how to emit an event)

```ts
import { getEventPublisher } from '@/lib/events'
import { prisma } from '@/lib/prisma'

await prisma.$transaction(async (tx) => {
  // ... your business writes on `tx` ...
  await getEventPublisher().publish(
    {
      type: 'lifecycle.season.activated',
      sport: 'NFL',
      leagueConcept: 'redraft',
      leagueId,
      seasonId,
      actor: { type: 'commissioner', id: userId },
      period: { kind: 'week', index: 1 },
      subjects: [{ kind: 'season', id: seasonId }],
      idempotencyKey: `season.activated:${seasonId}`, // optional; enables dedupe
      metadata: { source: 'engine', correlationId },
      payload: { seasonId },
    },
    { tx }, // ← REQUIRED for the atomic guarantee
  )
})
```

Pass `{ tx }` whenever an event corresponds to a state change, so they commit together.
Omit `tx` only for standalone events with no business write.

---

## 5. Transactional guarantees

- **Atomicity (no dual-write):** with `{ tx }`, the event + outbox rows are part of the
  caller's transaction. If the business write rolls back, the event is gone; if it commits, the
  event is guaranteed present. *(Proven in `__tests__/events/outbox-db.integration.test.ts`:
  rollback leaves no `domain_events`/`event_outbox` row.)*
- **At-least-once delivery + idempotent consumers:** the relay may deliver an event more than
  once (crash between publish and `markDispatched`); consumers must dedupe on `eventId`. The bus
  isolates subscriber failures so one bad handler never blocks others.
- **Dedupe at storage:** `domain_events.idempotencyKey` is unique — re-emitting the same logical
  event is rejected by the DB rather than double-stored.
- **Ordering:** outbox is drained `createdAt asc`. Strict global ordering is **not** guaranteed
  (don't depend on it); a distributed bus (G15.3) provides per-partition ordering.

---

## 6. Database

Migration `prisma/migrations/20260627010000_add_event_foundation/migration.sql` (additive,
idempotent, no FK, no changes to existing tables):

- **`domain_events`** — append-only event log. Indexes: `(leagueId, occurredAt)`,
  `(seasonId, occurredAt)`, `(type, occurredAt)`, `(tenantId, occurredAt)`, `(correlationId)`;
  unique `eventId`, unique `idempotencyKey`.
- **`event_outbox`** — dispatch state (`status`, `attempts`, `availableAt`, `lastError`,
  `dispatchedAt`). Index `(status, availableAt)`; unique `eventId`.

Apply on Neon with the **direct (non-pooled)** host (migrations use `directUrl`):
`DIRECT_URL=<…neon… without -pooler> npx prisma db execute --schema prisma/schema.prisma --file <migration.sql>`,
then `npx prisma migrate resolve --applied 20260627010000_add_event_foundation`.

---

## 7. Dependency injection / swapping (extension guide)

```ts
import { configureEventInfrastructure, InMemoryOutboxStore } from '@/lib/events'

// tests: full in-memory pipeline
configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

// G15.3: distributed transport — implement IEventBus over Redis Streams/BullMQ, then:
configureEventInfrastructure({ bus: new RedisStreamsEventBus(/* … */) })
// No call-site changes: publishers/relay are rewired from the swapped parts.
```

**Adding a new event type (G15.2+):**
1. Define a Zod payload schema; `register(type, version, zodValidator(schema))` at startup.
2. Emit it with `{ tx }` from the engine that owns the state change.
3. Add an idempotent subscriber (projection) — never reach into raw provider/DB data; consume
   the normalized event.
4. Keep types namespaced (`domain.subject.verb`) and additive (new `schemaVersion`, never mutate).

**Hard rules preserved:** no NFL/redraft assumptions; no direct Redis dependency (in-process
adapter only); existing realtime systems (`lib/league-events/realtime-store.ts`) untouched and
independent; BullMQ/Redis are future adapters behind `IEventBus`/`OutboxRelay`.

---

## 8. Tests

- `envelope-and-registry.test.ts`, `event-bus.test.ts`, `normalizer-publisher-relay.test.ts`,
  `container-and-backward-compat.test.ts` — unit (30 tests).
- `migration.test.ts` — static migration/schema verification.
- `outbox-db.integration.test.ts` — opt-in (`RUN_EVENT_DB_IT=1`), proves atomicity + rollback +
  relay delivery against a real DB.
- Backward compatibility: the legacy realtime store is asserted independent and unchanged; the
  new bus never invokes legacy subscribers.
