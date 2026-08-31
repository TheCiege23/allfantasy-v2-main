# `migrations-pending/` — written, reviewed by nobody, NOT in the deploy path

A migration in `prisma/migrations/` is **live**, whether or not it is committed:
`prisma migrate deploy` reads the **directory**, not git. Anyone running it from
this shared checkout applies every pending migration they find, regardless of
which one they meant to apply.

That is not hypothetical. On 2026-08-31 the commit/review session had already
handed its user `ALLOW_PROD_MIGRATION=1 npm run db:migrate:deploy:prod` to apply
*someone else's* Fantrax column, and had to retract it because an unrelated
324-line migration touching `leagues` was sitting in the same directory.

So: a migration lands here first, and moves to `prisma/migrations/` only when
its author's user has explicitly authorised applying it. Moving it is the
deliberate act; writing it is not.

## Why this is not just "commit it and be careful"

Committing makes a migration reviewable, which is good and should also happen.
It does **not** remove it from the deploy path — a committed migration in
`prisma/migrations/` is swept up by exactly the same command. Review and
reachability are different problems, and only this directory fixes the second.

## The cost of leaving one in the real directory

A migration that fails — including one that fails **correctly**, on a guard —
writes a `finished_at IS NULL` row into `_prisma_migrations`, and every later
`migrate deploy` then aborts with **P3009** until someone resolves it by hand.
A well-guarded refusal still blocks everyone. Parking it here means the guard
never has to fire.

## ✅ ALL SEVEN ARE APPLIED TO PRODUCTION (2026-08-31)

Only `t101b` below is still parked. Everything else in this directory has been
applied and recorded in `_prisma_migrations` with the real `sha256` of its
`migration.sql`, so a later `migrate deploy` matches and skips rather than
re-running:

| migration | |
|---|---|
| `…_t101` | tenancy tables, League.tenantId backfill |
| `…_t007_audit` | AuditEvent + append-only trigger |
| `…_t008_constraints` | PlatformGrant partial unique |
| `…_t102_rls` | RLS policies + `app.*` bootstrap functions |
| `…_t106_suspension` | `app.tenant_is_writable` + policy tightening |
| `…_t112_key_role` | TenantApiKey.role (**needed a fix — see below**) |
| `…_t201_binding` | LeagueBinding, SyncJob |

Verified on production by effect: 7 recorded, **0 rows with `finished_at IS NULL`**
(so no P3009 landmine), 9 tables with RLS, 27 policies, the audit trigger present,
5 `app.*` functions, and `leagues` still readable at 116 rows.

**T-001's second half is also done.** All 688 public tables are now owned by
`commish_migrate`; `commish_app` owns 0. `neondb_owner` — the role the running app
connects as — keeps SELECT/INSERT/UPDATE/DELETE because it is a member of
`commish_migrate` and inherits. That inheritance is what made the transfer safe;
it is also a trap, see below.

⚠ **The four roles are still `NOLOGIN`.** Nothing can connect as `commish_app`
yet, so the eleven `.spec.ts` suites still cannot run and no request path can be
routed through `withTenant` in a way that actually isolates.

🛑 **AND "ROUTE SOMETHING THROUGH `withTenant`" IS NOT A CODE TASK UNTIL THAT
CHANGES.** Measured on a branch: `neondb_owner` with `app.tenant_id` set to a
tenant owning 1 row saw **5** — every row in the table. It inherits
`commish_migrate`, matches the `maintenance` policy (`USING (true)`), and RLS
hands it everything. So a request path wired through `withTenant` on the current
connection sets the GUC, reads correctly, passes any test asserting `withTenant`
was called, and isolates nothing. That is the failure `TENANCY.md` §3.1 names,
reached from an angle the document does not: not "app and migrations share a
role", but "the app's role is a MEMBER of the migration role".

## Currently parked

### `20260831120000_commissioner_os_t101`

Commissioner OS T-101 — tenancy tables, `League.tenantId` three-step backfill,
partial uniques, GIN index. See `docs/commissioner-os/SCOPE.md`.

✅ **APPLIED TO PRODUCTION 2026-08-31, on the owner's explicit instruction.**
Rehearsed first on a Neon branch cloned from production at HEAD, then applied.
Verified by effect on production rather than by the command's exit status:
116/116 league rows backfilled to the bootstrap tenant, 0 NULL, column NOT NULL,
6 tenancy tables, 4 `leagues_tenantId*` indexes, the FK, and the GIN index.

T-001 was landed first, as the guard requires, with the four roles created
**`NOLOGIN`** — the owner's choice. Nothing connects as them yet, so no password
exists to leak, and every T-001 assertion still holds (the suite asserts
NOSUPERUSER / NOBYPASSRLS / member-of-nothing / owns-nothing, never LOGIN —
checked before relying on it). Verified on production: all four NOLOGIN,
`commish_app` a member of `NONE`, `commish_*` owning 0 tables, and the default
ACLs read back from `pg_default_acl` as `commish_app=arw`, `commish_platform=r`,
`commish_purge=rd`, sequences `commish_app=rU`.

⚠ `ALTER ROLE … LOGIN PASSWORD …` is the one-line follow-up when Phase 3 moves
the app behind `commish_app`. Until then T-102's RLS isolation suite cannot
connect as these roles, which is the accepted cost of holding no credentials.

⚠ **It is recorded in `_prisma_migrations` by hand, not by Prisma**, because
`psql` and Neon connection-string retrieval were both unavailable to the session
that applied it, so the SQL went through the Neon MCP. The row carries the real
`sha256` of `migration.sql` (`63cf8df2…`), so a later `migrate deploy` matches
and skips rather than re-running. **If you edit that file, the checksum no longer
matches and Prisma will complain about a modified applied migration.**

⚠ **The directory is still HERE rather than in `prisma/migrations/`.** That is
harmless — the record simply has no local directory, which is already true of
eight other rows — and it keeps the migration out of every peer's deploy path.
Moving it is safe whenever convenient, since it is already recorded.

### `20260831200000_commissioner_os_t101b_drop_tenant_default`

🛑 **PARKED ON PURPOSE. DO NOT APPLY YET.**

T-101 sets `leagues.tenantId DEFAULT 'allfantasy'` and this drops it. The default
is a deployment-window safety net for the app that is **currently serving**,
whose Prisma client predates the column and whose INSERTs therefore do not
mention it — without the default those hit a NOT NULL violation the minute T-101
lands, taking out league creation and every import path.

Apply this only once the tenant-aware build is **serving traffic** — merged is
not the same as serving. And note it does not weaken the invariant meanwhile:
`schema.prisma` still carries no `@default`, so the generated client makes
`tenantId` required and application code cannot omit it.
