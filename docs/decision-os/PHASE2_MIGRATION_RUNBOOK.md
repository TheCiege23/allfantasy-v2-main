# Decision OS Phase 2 — Production Migration Runbook

**Three** migrations ship the Phase 2 managed-intelligence persistence + token-reservation layer. All are **purely
additive** and were generated offline (no DB connection):

| Order | Migration | Objects created |
| --- | --- | --- |
| 1 | `20260728120000_decision_intelligence_runs` | table `decision_intelligence_runs` + 1 unique + 5 non-unique indexes. **No existing table touched.** |
| 2 | `20260728130000_token_reservations` | `ALTER TABLE user_token_balances ADD COLUMN reserved_balance INTEGER NOT NULL DEFAULT 0`; table `token_reservations` + 1 unique + 3 non-unique indexes + 1 FK (`token_reservations.user_token_balance_id → user_token_balances.id`). |
| 3 | `20260729120000_intelligence_run_provider_exec_marker` | `ALTER TABLE decision_intelligence_runs ADD COLUMN provider_exec_started_at TIMESTAMP(3)` (nullable — the hard-crash UNKNOWN-outcome marker). **No other table touched.** |

Static DDL audit: **zero `DROP`, zero column drop, zero type change, zero data mutation.** The only mutations of a
pre-existing table are additive `ADD COLUMN`s (`user_token_balances.reserved_balance DEFAULT 0`;
`decision_intelligence_runs.provider_exec_started_at` nullable — a metadata-only change on Postgres ≥ 11, no table
rewrite, no long lock). None of the other 60+ externally-managed tables are referenced by any migration. Apply in
the order above (migration 3 depends on migration 1's table). The `scripts/verify-phase2-migration-prodlike.mjs`
proof exercises all **three** against the real 626-table structure (checksums match, additive-only, idempotent).

## Maintenance activation flag — `DECISION_OS_MAINTENANCE_ENABLED` (OFF by default)

The maintenance cron (`/api/cron/decision-os-intelligence-maintenance`, scheduled every 10 min in `vercel.json`)
is gated by a single server-side env flag. It runs the drain + reconcile **only** when the value is EXACTLY
`true`; missing / empty / `false` / `1` / `yes` / any other value keeps it disabled. When disabled, an
authenticated request returns an inert `{ ok: true, enabled: false, status: "maintenance_disabled" }` **without**
querying Phase 2 tables, draining jobs, reconciling reservations, invoking providers, mutating tokens, minting
freshness, or writing any DB state. (An unauthenticated request still returns `401` regardless of the flag.)

Operational rules:

- **Off by default.** Merging or deploying PR #349 does **not** enable maintenance — the flag is absent, so the
  cron is inert even before the migrations exist, even with provider credentials configured, and even after
  Phase 3 begins enqueueing refresh jobs.
- **Apply + verify the three migrations BEFORE enabling.** Set `DECISION_OS_MAINTENANCE_ENABLED=true` only after
  the three migrations above are applied and verified (`prisma migrate status` clean; the two new tables + the
  `reserved_balance` column present). Enabling before the tables exist would only produce a harmless `500` (the
  gate/route never mutates state), but activation should follow a clean migration regardless.
- **Phase 3 must not auto-enable it.** Wiring `runManagedIntelligence` into the live Decision OS routes (Phase 3)
  must NOT set this flag. Activation is a **separate, deliberate operator decision**, made only when the operator
  intends maintenance (job drain + provider spend on material-change refreshes) to run.
- **Disable / rollback:** set `DECISION_OS_MAINTENANCE_ENABLED=false` (or remove the variable) and redeploy /
  restart. This immediately stops new maintenance processing. It does **not** erase stored state — persisted runs,
  reservations, and ledger entries are untouched; in-flight holds continue to auto-expire and are reconciled once
  maintenance is re-enabled. Never commit a production value for this flag; the repo documents only the safe
  default (`DECISION_OS_MAINTENANCE_ENABLED=false`, see `.env.example`).

## Why NOT `prisma migrate deploy` against production

This database carries a large set of externally-managed tables (created by direct SQL, `db push`, and provider
tooling) that are **not** represented in Prisma's `_prisma_migrations` history — measured on the production-like
sandbox as **18 of 127 migration folders unrecorded** (drift). `prisma migrate deploy` would treat *all 18* as
pending and try to re-create objects that already exist → failure. So `migrate deploy` is **not** usable here.

The **established repository convention** (proven by `docs/dynasty-pick-capital-audit.md`,
`docs/g15-1-event-foundation.md`, and `docs/deployment.md`) is: **apply the migration SQL directly, then record
history with `prisma migrate resolve --applied <migration_name>`**, guarded by a `_prisma_migrations` preflight.
`migrate resolve --applied` writes the row with Prisma's own checksum. The raw SQL is *not* self-idempotent
(`CREATE TABLE` / `ADD COLUMN` error if re-run); the preflight guard is what makes the rollout safe to re-run.

Checksum note: Prisma's `_prisma_migrations.checksum` is `sha256` of the migration.sql content **normalized to
LF** (`content.replace(/\r\n/g, '\n')`) — empirically confirmed against recorded rows. `migrate resolve --applied`
computes this for you; any out-of-band recording MUST use this exact value or a future `migrate status` will flag
the migration as modified.

## Preflight (before applying)

1. Confirm the target is production and you have a **fresh logical backup / PITR restore point** (Neon: note the
   current LSN / create a branch as a restore point).
2. Verify the two objects do **not** already exist (a partial prior attempt):
   ```sql
   SELECT to_regclass('public.decision_intelligence_runs') AS runs,
          to_regclass('public.token_reservations')          AS reservations,
          EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='user_token_balances'
                    AND column_name='reserved_balance')       AS reserved_col;
   ```
   Expected on an un-migrated DB: `runs = NULL`, `reservations = NULL`, `reserved_col = false`.
3. Confirm the bookkeeping rows are absent:
   ```sql
   SELECT migration_name FROM _prisma_migrations
   WHERE migration_name IN ('20260728120000_decision_intelligence_runs','20260728130000_token_reservations');
   ```
   Expected: 0 rows. **If any object OR any row already exists, STOP** and reconcile manually — do not re-run raw
   `CREATE`.

## Apply (in order, each migration in ONE transaction)

For each migration, in the order in the table above, apply the DDL then record it via the repo convention:

```bash
# 1) Apply the exact checked-in SQL (transactional; a mid-apply failure rolls the whole migration back).
npx prisma db execute --file prisma/migrations/<name>/migration.sql --schema prisma/schema.prisma
# 2) Record history with Prisma's own checksum (the established convention — see the docs cited above).
npx prisma migrate resolve --applied <name>
```

Apply migration 1 fully (both steps), then migration 2. `db execute` runs the DDL; `migrate resolve --applied`
writes the `_prisma_migrations` row with the correct LF-normalized checksum. Ensure the CLI targets the intended
database (`npm run db:target` reports it) — the Prisma CLI reads `.env`, not the shell, so confirm before running.

## Expected objects after apply

- `decision_intelligence_runs`: 34 columns, PK `id`, unique index on `result_key`, indexes on
  `(user_id, tool)`, `league_id`, `(status, lease_expires_at)`, `input_hash`, `expires_at`.
- `user_token_balances.reserved_balance`: `integer NOT NULL DEFAULT 0` (existing rows back-fill to 0).
- `token_reservations`: 18 columns, PK `id`, unique index on `idempotency_key`, indexes on
  `(user_id, status)`, `(status, expires_at)`, `intelligence_run_id`, FK to `user_token_balances(id)` `ON DELETE CASCADE`.

## Verification queries (run after apply)

```sql
-- both migrations recorded, not rolled back
SELECT migration_name, applied_steps_count, rolled_back_at IS NULL AS ok
FROM _prisma_migrations WHERE migration_name LIKE '20260728%' ORDER BY migration_name;
-- objects present
SELECT to_regclass('public.decision_intelligence_runs'), to_regclass('public.token_reservations');
-- column + default
SELECT column_default FROM information_schema.columns
WHERE table_name='user_token_balances' AND column_name='reserved_balance'; -- expect '0'
-- FK + unique
SELECT conname FROM pg_constraint WHERE conname='token_reservations_user_token_balance_id_fkey';
SELECT indexname FROM pg_indexes WHERE indexname IN
  ('decision_intelligence_runs_result_key_key','token_reservations_idempotency_key_key');
```

## Failure handling & rollback

- **Mid-apply error**: the transaction rolls back automatically; no bookkeeping row was written → safe to
  investigate and re-run the same migration.
- **Forward-fix policy (preferred)**: because both migrations are additive, the standard recovery is to fix
  forward (re-run the failed migration after correcting the cause), not to drop objects on production.
- **Explicit rollback (only if required)** — additive, so reversible with no data loss:
  ```sql
  BEGIN;
  DROP TABLE IF EXISTS token_reservations;             -- migration 2
  ALTER TABLE user_token_balances DROP COLUMN IF EXISTS reserved_balance;
  DROP TABLE IF EXISTS decision_intelligence_runs;     -- migration 1
  DELETE FROM _prisma_migrations WHERE migration_name LIKE '20260728%';
  COMMIT;
  ```
  `decision_intelligence_runs` and `token_reservations` are result caches / holds — dropping them loses only
  regenerable cache + in-flight reservations, never customer ledger data (the immutable `token_ledger` is
  untouched by these migrations).

## Re-run safety (idempotency)

The rollout is safe to re-run because step-2/3 preflight and the `_prisma_migrations` guard cause an
already-applied migration to be **skipped**, not re-executed. This was proven end-to-end (see below).

## Proof of safety (executed against the isolated sandbox, never production)

### Against the REAL 626-table production-like structure — `scripts/verify-phase2-migration-prodlike.mjs`

The definitive proof. Runs against the full isolated sandbox (626 base tables, 109 real history rows): snapshots
the entire structure + representative `user_token_balances` (292 rows) and `token_ledger` (122 rows) → DROPs the
3 Phase 2 objects to reach a faithful pre-Phase-2 state → applies both migrations via the repo mechanism (direct
SQL + LF-normalized-checksum bookkeeping) → diffs **every** other table → runs again → self-heals. Result (exit 0):

- `otherTablesUnchanged: true`, `columnsDiff: []` — **no** column/constraint/index of any of the 624 other tables
  changed; `token_ledger` (122) and `user_token_balances` (292) row counts unchanged; the sentinel balance (4242)
  preserved, `reserved_balance` back-filled to 0.
- Table count `624 → 626` (exactly +2); FK + unique present; migrated tables accept writes.
- `checksumsMatch: true` — the recorded checksums equal `sha256(migration.sql, LF)` for both files.
- Second run → both `skipped` (idempotent); the full integration suite (`npm run test:phase2:db`, 46 tests) then
  passes against the migrated sandbox, exercising the real TypeScript adapters end-to-end.

### Runbook-mechanics proof — `scripts/verify-phase2-migration-rollout.mjs`

Models the guarded direct-SQL + bookkeeping flow in a disposable `p2rb` schema with sentinel "externally-managed"
tables and a pre-Phase-2 `user_token_balances` row, applies both migrations **twice**, then drops the schema.
Result (exit 0):

- First run → both `applied`; tables `4 → 6` (**exactly +2**, additive only).
- `reserved_balance` added with default `0`; the pre-existing row back-filled to `0` (**data preserved**).
- Sentinel tables' row counts and `user_token_balances.balance` (137) **unchanged** — zero drop/alter of
  externally-managed tables.
- FK + unique `idempotency_key` index present; 12 indexes across the two new tables.
- Second run → both `skipped` (guarded no-op); table count unchanged.
- `_prisma_migrations`: exactly two Phase 2 rows, `applied_steps_count = 1`, `rolled_back_at IS NULL`.

Run it against any isolated DB with:
```bash
TEST_DATABASE_URL=<isolated-db-url> node scripts/verify-phase2-migration-rollout.mjs
```
