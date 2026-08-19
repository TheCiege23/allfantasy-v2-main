# G15.3 — Outbox Relay + First Projection

**Status:** complete. Turns the event foundation from passive storage into a working
pipeline: `domain_events` → **relay** → **durable consumer** → **read model**. Builds on
G15.1/G15.2 (`docs/g15-1-event-foundation.md`, `docs/g15-2-event-producers.md`).

No Commissioner Hub UI, Story Engine, Chimmy, or external SDK — those are later phases. The
first projection is **disposable**; no business behavior depends on it.

---

## 1. Relay lifecycle

`OutboxRelay` (`lib/events/outboxRelay.ts`) drains the outbox in batches:

1. **claim** — `store.claimPending(batchSize, now)` returns pending rows (oldest first) whose
   `availableAt <= now`, with their `attempts` count.
2. **deliver** per event:
   - **consumers (durable):** every `EventConsumer.handle(event)` must succeed. A thrown error
     fails the whole event.
   - **bus (best-effort):** after consumers succeed, publish to the in-process bus for
     ephemeral real-time fan-out (SSE). A bus failure is logged, never fails the event.
3. **mark**:
   - all consumers ok → `markDispatched` (`status='dispatched'`).
   - a consumer threw → `attempts+1 >= maxRetries` → `markDead` (`status='dead'`, terminal);
     else `markFailed` → `status='pending'` with `availableAt = now + backoff`.
4. **backoff** — capped exponential: `min(baseRetryMs * 2^(attempts-1), maxRetryMs)`.

**Guarantees:** at-least-once delivery; storage dedupe via `domain_events.idempotencyKey`;
per-event isolation (one bad event never blocks the batch).

---

## 2. Consumer contract

```ts
interface EventConsumer {
  readonly name: string
  handle(event: DomainEvent): Promise<void> | void
}
```

- **Idempotent** — delivery is at-least-once; key all writes on `event.eventId` (the audit
  feed upserts on it).
- **Throw to retry** — a thrown error tells the relay to retry, then dead-letter after
  `maxRetries`. Return normally on success.
- **No raw provider data / PII** — consumers read normalized `DomainEvent`s only.

Register consumers on the relay: `new OutboxRelay(store, { consumers: [...], bus, ...opts })`.
The default container relay has **no** DB consumers (fan-out only) so unit tests + the default
runtime stay side-effect-light; durable consumers are wired by the runner.

---

## 3. Operational runbook

Runner: `scripts/run-outbox-relay.ts` (wires Prisma store + audit-feed consumer + bus).

```bash
# one batch, then exit
node --import tsx scripts/run-outbox-relay.ts --once

# dry run — report what WOULD be dispatched; no delivery, no state change
node --import tsx scripts/run-outbox-relay.ts --dry-run

# continuous drain (default): poll every --interval ms until stopped
node --import tsx scripts/run-outbox-relay.ts --interval=1000 --batch-size=200 --max-retries=8
```

Controls: `--once`, `--dry-run`, `--batch-size=N`, `--max-retries=N`, `--interval=MS`,
`--max-batches=N`. Logs every batch (`fetched/dispatched/retried/deadLettered`) + per-event
retry/dead-letter at `warn`/`error`. Always run against a **non-prod** DB for testing; the
runner prints the masked DB host on start.

**Inspecting failures:** dead-lettered rows are `event_outbox.status='dead'` with `lastError`
+ `attempts`. Re-drive a fixed dead-letter by resetting `status='pending', availableAt=now()`.

**Production:** run as a long-running worker (reuse the `lib/live-scoring/workerLoop.ts`
daemon pattern) or a scheduled job. Vercel cron floor is 1 min; a long-running worker on
Railway is the path to sub-minute drain.

---

## 4. First projection — Event Audit Feed (Activity Timeline)

`lib/events/projections/auditFeed.ts` + `event_audit_feed` table (migration
`20260627020000_add_event_projections`, additive/idempotent).

- **Consumer** (`createAuditFeedConsumer` / `createPrismaAuditFeedConsumer`): upserts one row
  per event (idempotent by `eventId`) with a **privacy-safe** `summary` (readable label +
  period; no payload content, no PII).
- **Read model** (`AuditFeedEntry` → `event_audit_feed`): `eventId` (unique), `tenantId`,
  `leagueId`, `seasonId`, `type`, `summary`, `sport`, `leagueConcept`, `actorType/Id`,
  `occurredAt`. Indexed for league/tenant timelines.
- **Disposable:** business logic must not read it as a source of truth — it is derived.

### Rebuild process
`rebuildAuditFeed(prisma, { batchSize })`:
1. `deleteMany({})` the read model.
2. Page through `domain_events` (oldest first, cursor by `id`) and replay each through the
   consumer.
3. Upsert the `intelligence_projection_checkpoint` row (`eventsProcessed`, `lastEventId`,
   `lastOccurredAt`).

Rebuild is safe to run any time (clears + re-derives). It is the recovery path for a corrupted
or schema-evolved projection. *(Note: rebuild clears the entire feed — coordinate on shared
environments.)* The checkpoint currently tracks rebuilds; incremental per-event checkpointing
can be added when multiple projections need independent cursors.

---

## 5. High-frequency events

- **`competition.matchup.updated` — NOW WIRED** (`scoringEngine.updateMatchupScores`), but only
  when the score **actually changed** vs. the prior persisted value, so no-op recalcs don't
  flood the log. Safe now that the relay drains the outbox. (Verified end-to-end on staging.)
- **`competition.score.updated` (per-player) — STILL DEFERRED.** Per-player-per-sync volume
  would grow the **permanent** `domain_events` log unbounded regardless of the relay. It needs
  coalescing/sampling and a retention/archival policy (a hot-store decision) — deferred to
  G15.4+ (Intelligence storage strategy). Documented, not wired.

---

## 6. Known scaling limits (read before multi-node production)

1. **Relay is single-node today.** `claimPending` reads `status='pending'` without locking, so
   two relays could dispatch the same row. **Before multi-node:** make claiming atomic — either
   Postgres `SELECT … FOR UPDATE SKIP LOCKED` (claim a batch in a tx) or a CAS
   `UPDATE … SET status='claimed', claimedBy, claimedAt WHERE status='pending' … RETURNING`.
   The `IOutboxStore` interface isolates this change to `PrismaOutboxStore`.
2. **In-process bus is single-node** (fan-out only). Cross-node real-time needs a Redis/BullMQ
   `IEventBus` adapter (the port already exists; `bullmq`+`ioredis` are dependencies).
3. **`domain_events` is an unbounded append-only log.** Add time-partitioning + archival before
   high-frequency events (`score.updated`) are enabled at scale.
4. **JSONB columns are unindexed.** Projections read-then-derive, so this is fine today; add GIN
   indexes only if ad-hoc payload querying is ever needed.

---

## 7. Tests
- Relay unit: dispatch + mark dispatched, **retry w/ backoff**, **dead-letter after maxRetries**,
  **dry-run** (no side effects), **run() drains across batches** (`__tests__/events/normalizer-publisher-relay.test.ts`).
- Projection unit: summarize (privacy-safe), event→entry mapping, **idempotent consumer**,
  **rebuild** via a fake client (`__tests__/events/audit-feed-projection.test.ts`).
- DB integration (opt-in `RUN_EVENT_DB_IT=1`): transactional outbox
  (`outbox-db.integration.test.ts`) + **relay→audit-feed drain, idempotency, rebuild**
  (`relay-projection-db.integration.test.ts`).
- Staging E2E: harness emitted 13 events → relay drained all (dispatched 13 / pending 0 /
  dead 0) → audit feed populated across 9 types incl. `matchup.updated`; then cleaned up.
  Engine harness **PASS 32 / FAIL 0** (no behavior change).

---

## 8. G15.3b — Production hardening (multi-worker safe)

### Claim states (`event_outbox.status`)
`pending` (new) → `claimed` (in-flight, `claimedBy`/`claimedAt` set) → `dispatched` (done).
On failure: `retry` (scheduled at `availableAt = now + backoff`) until `dead` (terminal,
`attempts >= maxRetries`). Migration `20260627030000_add_outbox_claim` adds `claimedBy`,
`claimedAt` (+ index).

### Claiming strategy — atomic, no double-processing
`PrismaOutboxStore.claimBatch(workerId, opts)` runs a single statement:

```sql
UPDATE "event_outbox" SET status='claimed', "claimedBy"=$1, "claimedAt"=$2
WHERE id IN (
  SELECT id FROM "event_outbox"
  WHERE ((status IN ('pending','retry') AND "availableAt" <= $2)
         OR (status='claimed' AND "claimedAt" < $3))   -- $3 = now - claimTimeout (stale)
  ORDER BY "createdAt" ASC LIMIT $4
  FOR UPDATE SKIP LOCKED
)
RETURNING "eventId", attempts
```

`FOR UPDATE SKIP LOCKED` makes two workers claim **disjoint** batches; the CAS flip to
`claimed` makes the claim durable. (Proven: two concurrent workers process each event exactly
once — `relay-claiming-db.integration.test.ts`.) The in-memory store mirrors this with a
synchronous critical section.

### Stale-claim recovery
A `claimed` row whose `claimedAt` is older than `claimTimeoutMs` (default 60s) is treated as a
crashed worker's claim and becomes eligible again — picked up by the same `claimBatch` query.
(Proven: crashed claim recovered + dispatched after timeout.)

### Operational controls (`scripts/run-outbox-relay.ts`)
`--worker-id`, `--claim-timeout=MS`, `--batch-size`, `--max-retries`, `--once`, `--dry-run`
(read-only peek — no claim/no state change), `--max-batches`, structured logs (every batch +
per-event retry/dead-letter, all stamped with `workerId`).

### Scaling status (updates §6)
- **Atomic claiming is implemented** → multiple relay workers are now safe against one Postgres.
- Still single-process **bus** fan-out (ephemeral SSE) — Redis/BullMQ `IEventBus` adapter is the
  cross-node path (port exists).
- DB integration tests share the **global** outbox, so they must run serially
  (`vitest --no-file-parallelism`); they clean the event tables in `beforeAll`.
- Edge case: an orphaned outbox row (its `domain_events` row deleted — should never happen in
  prod, since the log is append-only) is skipped by `claimBatch` (no domain event to load) and
  left claimed; harmless but noted.
