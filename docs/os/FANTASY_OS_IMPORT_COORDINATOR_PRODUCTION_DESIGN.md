# Import Coordinator — Production-Safe Deduplication Design (Phase 23)

**Status: design only. Nothing in this document was implemented this phase.**

## Framing

The Phase 21/22 guardrail's **primary goal** — a customer request never blocks on a full importer run — does not depend on cross-route or cross-instance deduplication at all. That goal is fully achieved and does not need a distributed lock. This document is about the **secondary goal**: bounding how many redundant importer executions (external API calls, DB writes) can happen for the same sport in a short window, across routes and across serverless instances, in real Vercel production.

## Option evaluations

### Option A — Keep current process-local guard

**What it gives you today**: proven same-warm-instance dedup (Phase 22 measured concurrent same-route misses collapsing 3→1 importer execution repeatedly); proven cooldown recovery with real wall-clock timing; zero infrastructure, zero schema, zero new failure modes beyond what already exists.

**What it does not give you**: any dedup guarantee across different serverless function instances, which — per the Phase 23 runtime-scope audit — is the *normal* case in Vercel's per-route function deployment model, not an edge case. In the worst case (a real burst of traffic across multiple routes/instances hitting the same sport miss simultaneously), each instance independently starts its own importer run: N instances → N redundant imports for the same sport, each with its own 3 external-provider-chain calls and its own chunked upsert batch to the same rows.

**Verdict**: sufficient to ship for the primary latency goal (already true since Phase 21). Not sufficient if "at most one import per sport across the whole deployment" needs to be an operational guarantee.

### Option B — Shared Postgres advisory lock (Neon)

This app already runs on Neon Postgres via Prisma — the natural first choice for "reuse existing infrastructure, no new managed service."

**Evaluated specifics**:
- Postgres advisory locks (`pg_advisory_lock`/`pg_try_advisory_lock`) are keyed by a bigint — a sport string would need a stable hash into that keyspace (e.g., a simple deterministic hash of the normalized sport code).
- **Session-scoped advisory locks require the lock to be held on the same underlying database connection for its full duration.** Neon (and most serverless Postgres setups) commonly serve app connections through pooled/PgBouncer-style connection strings, frequently in *transaction pooling* mode — which does **not** guarantee the same physical connection persists across separate statements. Session-scoped advisory locks are explicitly unreliable under transaction-mode pooling.
- **Transaction-scoped advisory locks** (`pg_advisory_xact_lock`) auto-release at transaction end, which is more compatible with pooled connections — but that means the lock is only held for the lifetime of one open transaction. To actually protect the ~90-190 second importer run, the entire import would need to execute inside one long-running database transaction, which is a real anti-pattern (long transactions hold resources, risk pool exhaustion, and don't match how `runSportsDataImporter()` is structured today — it already uses many short-lived `prisma.$transaction` calls internally, not one enclosing transaction).
- **Failure cleanup**: session-scoped locks release automatically if the connection drops (a real serverless function timeout/crash would naturally release it) — a genuine advantage over a hand-rolled lease if session-mode pooling were reliably available. Transaction-scoped locks release even more simply (transaction end), but reintroduce the long-transaction problem above.

**Verdict**: technically available, but has real friction specific to this app's serverless/pooled-connection setup — not a trivial drop-in. Worth a dedicated implementation phase with its own connection-mode verification, not a default recommendation without that verification.

### Option C — Database-backed refresh lease

A `sports_data_refresh_lease` (or similar) table: one row per sport, holding `lockedBy`/`lockedAt`/`expiresAt`. A caller `UPDATE ... WHERE sport = ? AND (expiresAt IS NULL OR expiresAt < now())` to atomically claim the lease before starting an import, clearing it on completion or letting it expire naturally on crash.

**Evaluated specifics**:
- **Requires a schema migration** — explicitly out of scope this phase ("no schema migration without explicit approval").
- **Crash recovery** is clean (lease `expiresAt` bounds the worst case even if a function dies mid-import) — genuinely more robust than Option B's connection-pooling friction.
- **Race behavior**: a single atomic `UPDATE ... WHERE` claim is safe under Postgres's MVCC without needing advisory locks at all.
- **Write volume**: trivially small (one row read/write per sport per refresh attempt) — not a concern.

**Verdict**: the most architecturally clean long-term option, but blocked on the explicit "no schema migration without approval" boundary this phase. Recommended as the concrete follow-up **if** the residual cross-instance risk (quantified below) is judged to warrant fixing.

### Option D — Existing queue or job system

Audited: no existing durable job queue was found in this codebase that `runSportsDataImporter()` could be routed through without building new infrastructure (`vercel.json`'s ~45 cron jobs are schedule-triggered HTTP routes, not a queue/worker pool; no BullMQ/SQS/similar consumer for this specific workload was found, though `bullmq` appears as a dependency elsewhere in the build config's webpack ignore-list — its actual usage is outside this coordinator's scope and wasn't audited further this phase).

**Verdict**: no existing queue to reuse for this specific purpose; building one is explicitly out of scope ("no new managed queue... unless the evidence justifies it" — the evidence gathered this phase does not clear that bar).

### Option E — External distributed lock (Redis, etc.)

**Verdict**: explicitly out of scope ("Do not add Redis by default"); no existing Redis/distributed-lock infrastructure was found in this codebase to reuse. Not evaluated further.

### Option F — Route consolidation / shared internal refresh endpoint

All incidental miss-triggered refresh requests could instead call one internal, protected `/api/internal/sports-data-refresh` endpoint (itself still just another Vercel Function, so it doesn't solve cross-instance sharing directly) — but centralizing *where* the fire-and-forget call is made doesn't change *how many separate function instances* might independently invoke it under real concurrent load, unless that endpoint itself uses Option B or C internally. In other words, Option F is a routing/organizational change, not a coordination mechanism on its own — it would need to be paired with B or C to actually help, and doesn't reduce complexity versus just adding B/C directly at the coordinator level.

**Verdict**: does not independently solve the problem; not recommended as a standalone option.

## Quantified residual risk

Real, measured data (Phase 22 soak) plus labeled extrapolation:

| Scenario | Same-instance dedup rate | Cross-route dedup rate | Cross-instance dedup rate |
|---|---|---|---|
| Measured (Phase 22, `next dev`, single process) | High — proven repeatedly (3 concurrent same-route same-sport misses → 1 import) | Unreliable on cold route compilation (3 anomalies observed); reliable once warm (proven via controlled follow-up) | **Not measurable this phase** — no multi-instance/multi-process test was performed (would require a real multi-instance deployment) |
| **Measured (Phase 23, `next build` + `next start`, single process)** | High — unchanged | **Perfect — 100% (identical `coordinatorInstanceId`/`pid` across `player-search` and `player-detail`, dedup joined correctly)** | Still not measurable (single-process test, cannot exercise multiple instances) |
| Extrapolated for real Vercel production | Same-route sharing likely holds (same function, warm-instance reuse) | **Reduces to "does Vercel run these routes in one shared process or not"** — the coordinator's own logic is now proven correct either way; this is purely a deployment-topology question, unresolved without live Vercel access | **Likely near-zero if Vercel uses per-route functions** — each concurrent instance independently starts its own import, regardless of the (now-proven-correct) in-process logic |

**Worst-case importer amplification** (extrapolated, not measured): if `N` different serverless instances (across any mix of routes and/or concurrent invocations) simultaneously miss on the same sport, the current guard bounds duplication to **1 redundant import per instance that misses in that window**, not 1 total. For 2 instances: up to 2x external-call/DB-write volume for that sport in that window. For 10: up to 10x. This is bounded (never unbounded — each instance's own single-flight guard still caps *that instance's* concurrent requests to 1), but not globally deduplicated.

**Customer-facing latency**: unaffected by any of this — every miss-path request returns in seconds regardless of how many redundant background imports run, since the guardrail's core mechanism (fire-and-forget, non-blocking) doesn't depend on cross-instance coordination at all.

**External API call / database write amplification**: this is the actual cost of the residual gap — up to `N`x the external provider calls and upsert-batch writes for a genuinely concurrent, multi-instance burst on the same sport. Given the existing 6-hour cron pre-warming already keeps most real, previously-seen players fresh (established since Phase 20), the scenario where this amplification actually triggers requires multiple simultaneous *true misses* (brand-new/mistyped players) across multiple instances in the same ~5-minute cooldown window — a real but narrower risk than "every request."

## Recommended strategy

**Retain Option A (process-local guard) for the current controlled rollout.** The primary goal it exists for — decoupling customer latency from importer completion — is fully achieved and does not need cross-instance coordination. Do not implement Option B or C this phase: Option B has real, unresolved connection-pooling friction specific to this app's Neon setup that needs its own verification pass; Option C is clean but requires a schema migration explicitly withheld from this phase's authorization.

**If** the residual cross-instance/cross-route amplification risk is judged operationally significant after real production traffic is observed (not before — this phase found no evidence of actual harm, only a bounded, quantifiable theoretical exposure), **Option C (database-backed refresh lease)** is the recommended next step: cleaner crash-recovery semantics than advisory locks, no long-transaction anti-pattern, small and well-understood schema footprint. This should be proposed as its own phase with explicit schema-migration approval requested up front, not folded into a no-migration phase.

## What this phase did NOT do

- Did not implement Option B, C, D, E, or F.
- Did not add Redis, a queue, or a database table.
- Did not enable `PLAYER_LOOKUP_NON_BLOCKING_REFRESH` in production.
- Did not modify `runSportsDataImporter()`, `runNewsImporter()`, or any provider-fetch logic.
- Did not extend coverage to `lib/data/news.ts` (the real gap disclosed in the Runtime Scope doc) — that is new-surface expansion, not this phase's audit/design scope.
