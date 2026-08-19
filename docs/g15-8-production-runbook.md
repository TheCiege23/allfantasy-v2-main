# G15.8 — Production Operationalization Runbook

**Status:** deploy-readiness plan only. **No production writes performed.** Apply the steps below
only with explicit approval. Read-only audit + status tooling + plans.

The G15 stack (events → outbox → relay → read models → `/api/v1/intelligence` → Commissioner Hub)
is browser-verified on staging (G15.7). This runbook gets it safely live.

---

## 0. Audited state (read-only, via `scripts/g15-prod-status.cjs`, 2026-06-28)

| Object | Production (`ep-curly-block`) | Staging (`ep-winter-salad`) |
|---|---|---|
| `domain_events` | ✅ exists, 0 rows | ✅ 0 rows |
| `event_outbox` | ✅ exists, 0 rows | ✅ 0 rows |
| `event_outbox.claimedBy/claimedAt` | ❌ **missing** | ✅ present |
| `event_audit_feed` | ❌ **missing** | ✅ |
| `intelligence_projection_checkpoint` | ❌ **missing** | ✅ |
| `intelligence_league_snapshot` | ❌ **missing** | ✅ |
| `intelligence_manager_snapshot` | ❌ **missing** | ✅ |
| `intelligence_processed_event` | ❌ **missing** | ✅ |
| `_prisma_migrations` G15 entries | ❌ none recorded | ❌ none recorded |

**Run the audit any time:** `AF_STATUS_URL=<db-url> node scripts/g15-prod-status.cjs` (read-only).

### Migration gap (prod)
- `20260627010000_add_event_foundation` — tables **exist** but **not recorded** in history.
- `20260627020000_add_event_projections` — **missing** + not recorded.
- `20260627030000_add_outbox_claim` — columns **missing** + not recorded.
- `20260627040000_add_intelligence_read_models` — **missing** + not recorded.

> Both prod and staging were built via scoped `prisma db execute` (not `prisma migrate`), so
> `_prisma_migrations` does not list the G15 migrations on either. The migration SQL files are all
> **additive + idempotent** (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

---

## 1. Production migration plan (scoped, idempotent)

**Do NOT use `prisma migrate deploy`** here — it would run *every* unapplied migration in the
folder (prod history is behind), risking unrelated non-idempotent migrations. Apply **only** the
G15 files via scoped `db execute` on the Neon **direct (non-pooled)** host, then record history.

Set env (do not echo secrets):
```bash
# Neon migrations require the DIRECT (non-pooled) host:
export DIRECT_URL="<prod direct host = prod DATABASE_URL with '-pooler' removed>"
export DATABASE_URL="<prod DATABASE_URL>"
```

Steps:
```bash
# (a) 010000 — tables already exist on prod: record as applied (no DDL run)
npx prisma migrate resolve --applied 20260627010000_add_event_foundation

# (b) 020000 — create projection tables
npx prisma db execute --schema prisma/schema.prisma \
  --file prisma/migrations/20260627020000_add_event_projections/migration.sql
npx prisma migrate resolve --applied 20260627020000_add_event_projections

# (c) 030000 — add outbox claim columns
npx prisma db execute --schema prisma/schema.prisma \
  --file prisma/migrations/20260627030000_add_outbox_claim/migration.sql
npx prisma migrate resolve --applied 20260627030000_add_outbox_claim

# (d) 040000 — create intelligence read models
npx prisma db execute --schema prisma/schema.prisma \
  --file prisma/migrations/20260627040000_add_intelligence_read_models/migration.sql
npx prisma migrate resolve --applied 20260627040000_add_intelligence_read_models
```

`prisma db execute --schema` reads `directUrl` → ensure `DIRECT_URL` points at the **direct** host
(not `-pooler`), or it will hit the wrong endpoint / fail to connect.

### Expected schema state
- **Before:** `domain_events` + `event_outbox` (no claim cols); 5 G15 objects missing; history empty.
- **After:** all 7 tables present; `event_outbox` has `claimedBy`/`claimedAt`; `_prisma_migrations`
  records all four G15 migrations. (All tables empty until the relay runs.)

### Verification (read-only)
```bash
AF_STATUS_URL="$DATABASE_URL" node scripts/g15-prod-status.cjs
# expect: allTablesPresent=true, columns.event_outbox.{claimedBy,claimedAt}=true,
#         migrations.recorded = all 4, missingFromHistory = []
```

### ⚠️ Warning
**Do NOT start the relay before migrations are applied.** `claimBatch` references
`claimedBy`/`claimedAt` and the consumers write to `event_audit_feed` / `intelligence_*`. Running
the relay against the pre-migration prod schema would error on every batch.

---

## 2. Relay deployment plan

**Entry point:** `scripts/run-outbox-relay.ts` (already wires the audit-feed + intelligence
consumers). Multi-worker-safe (G15.3b `FOR UPDATE SKIP LOCKED`); start with **one** worker.

| Concern | Recommendation |
|---|---|
| Where | A long-running worker (Railway service) — sub-minute drain. Alt: Vercel cron `* * * * *` calling `--once` (1-min floor). |
| Mode | Continuous: `node --import tsx scripts/run-outbox-relay.ts --interval=2000` (loops, drains, sleeps). Cron alt: `--once` per tick. |
| Env | `DATABASE_URL` = prod (pooled OK for runtime). **Not** `ALLOW_E2E_SEED`. `SENTRY_DSN` optional. |
| Worker id | `--worker-id=$RAILWAY_REPLICA_ID` (or hostname); defaults to `relay-<pid>`. |
| Batch size | `--batch-size=100` (default). Raise if backlog grows. |
| Claim timeout | `--claim-timeout=60000` (default) — stale claims from a crashed worker reclaimed after 60s. |
| Max retries | `--max-retries=5` (default) → dead-letter after 5 failed attempts. |
| Logging | Structured per-batch + per-event (retry/dead-letter), stamped with `workerId` → platform logs. |
| Health check | Alert if `event_outbox` pending grows monotonically or `lastDispatchedAt` goes stale (status script). |
| Failure handling | Relay never throws on a single bad event; worker restart is safe (stale-claim recovery). |
| Dead-letter monitoring | Alert on `status='dead' > 0`; inspect `lastError`; re-drive: `UPDATE event_outbox SET status='pending', "availableAt"=now(), "claimedBy"=null, "claimedAt"=null WHERE status='dead' AND "eventId"=…`. |

Scaling note: durable consumers are multi-worker safe; the in-process **bus** fan-out is single-node
(ephemeral SSE only — not used by the relay's durable consumers). Cross-node real-time SSE would
need the Redis `IEventBus` adapter (future, not required for the relay).

---

## 3. Production verification checklist (post-deploy)

1. **Migrations** — status script: `allTablesPresent=true`, claim columns true, all 4 recorded.
2. **Relay drains** — start the worker; confirm `event_outbox` rows move `pending → dispatched`
   (status script `relay.outboxByStatus`), `deadLettered=0`, `lastDispatchedAt` recent.
3. **Audit feed populates** — `counts.auditFeed > 0` after real events flow.
4. **Snapshots populate** — `counts.leagueSnapshots > 0` (manager snapshots grow with user-actor events).
5. **Hub route loads** — `GET /league/<id>/intelligence` returns the page (200) for a logged-in member.
6. **Nav link** — "League Intelligence" appears in the Commissioner Hub tab and routes correctly.
7. **Permissions** — member: `activity`/`audit-feed` 200, `health`/`action-items` 403 (UI shows
   "Commissioner only."); commissioner: all 200.
8. **Empty states** — a league with no events shows clean empty states (no errors).
9. **No leaks** — responses/UI contain no payload/PII/tokens/server-only text.

(The G15.7 spec `e2e/commissioner-intelligence-hub.spec.ts` reproduces 5–9 against a build; do not
run its seed/relay e2e routes in prod — they require `ALLOW_E2E_SEED`, which prod must not set.)

---

## 4. Rollback plan

The G15 objects are **additive, empty, and inert** (no existing code references them until the
relay/UI are live; the API returns clean empty states if absent). Rollback is low-risk:

```sql
-- 1) stop the relay worker first
-- 2) drop read models (disposable) + claim columns + event tables (empty)
DROP TABLE IF EXISTS "intelligence_manager_snapshot";
DROP TABLE IF EXISTS "intelligence_league_snapshot";
DROP TABLE IF EXISTS "intelligence_processed_event";
DROP TABLE IF EXISTS "intelligence_projection_checkpoint";
DROP TABLE IF EXISTS "event_audit_feed";
ALTER TABLE "event_outbox" DROP COLUMN IF EXISTS "claimedBy";
ALTER TABLE "event_outbox" DROP COLUMN IF EXISTS "claimedAt";
-- optional: DROP TABLE "event_outbox", "domain_events" (only if abandoning G15 entirely)
```
```bash
# 3) remove migration history records so a future re-apply is clean
#    DELETE FROM "_prisma_migrations" WHERE migration_name IN (…the four…);
```
Partial rollback (keep schema, stop processing): just **stop the relay worker** — events queue in
the outbox harmlessly; the Hub shows empty/stale data; no errors. This is the safest "pause".

App-side rollback: hide the nav link / route — but it degrades gracefully (empty states) even if
left visible with no data.

---

## 5. Files / tooling
- `scripts/g15-prod-status.cjs` — read-only status/audit (table existence, claim columns, counts,
  dead-letter, last relay activity, recorded migrations). `npm run status:g15`.
- Migrations: `prisma/migrations/2026062701/02/03/04…` (additive, idempotent).
- Relay: `scripts/run-outbox-relay.ts`.

## 6. Remaining risks
- Prod migrations not yet applied (this is a plan; awaiting approval) — Hub will show empty states
  until applied + relay running.
- `intelligence_processed_event` + `domain_events` grow over time — add retention/partitioning
  before high-frequency events (`score.updated`, deferred) are enabled.
- Single relay worker recommended initially; multi-worker is safe (claim-locking) if backlog warrants.
- Feature gate is allow-all; enable entitlement gating before charging for premium intelligence.
