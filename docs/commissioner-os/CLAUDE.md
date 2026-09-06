# Commissioner OS — working context

> ⚠ **PLACEMENT DEVIATION.** The handoff says this file belongs at the repo
> root. The repo root already holds a large, load-bearing `CLAUDE.md` — the
> AllFantasy repo instructions (provider contracts, the DB-first API boundary
> guard, the git/push/deploy conventions). Overwriting it would delete
> conventions several concurrent sessions are working under. It is parked here
> instead. Merging the two, or replacing root deliberately, is your call — see
> `SURVEY.md`.

> ⚠ **"Commissioner OS" ALSO names three other, unrelated things in this
> repo — added 2026-09-06.** This doc and its siblings (`HANDOFF.md`,
> `TENANCY.md`, `SCOPE.md`, `SURVEY.md`) are the **B2B multi-tenant** product
> described above — licensing commissioner tooling to *other* fantasy
> platforms. They are NOT: the live `lib/decision-os/commissioner-health/`
> decision engine; the consumer-facing `app/commissioner-os/` UI (scored in
> `docs/decision-os/OS_INVENTORY_AND_ROADMAP.md`, flatlined at 35%,
> demo-mode); or the older (July 2026) B2C plan in
> `docs/os/B2C_COMMISSIONER_USER_OS_PROJECT_PLAN.md` (superseded, historical
> only). Those three have no overlap with the tenancy work described here.

Multi-tenant B2B platform. Fantasy sports **operators** license Commissioner OS
to run commissioner tooling for their own users. We are not the end-user brand.

**Three parties, always:**

| Party | Who | Example |
|---|---|---|
| Platform | us | Commissioner OS staff |
| Tenant | an operator who licenses us | "DynastyCo", a fantasy site |
| League | a tenant's customer's league | "Mike's Money League" |

Read `docs/commissioner-os/HANDOFF.md` for the ordered work plan and
`docs/commissioner-os/TENANCY.md` for the isolation architecture.
`tenancy.prisma` merges into `prisma/schema.prisma`. Place all four at those
paths before starting — this file belongs at the repo root.

Stack: Next.js (App Router) · Postgres · Prisma · TypeScript.

**Four database roles**, not one. `commish_migrate` owns tables; `commish_app`
runs the app under RLS; `commish_platform` holds cross-tenant access;
`commish_purge` is the only role that deletes. Mixing them is how RLS ends up
decorative — see `TENANCY.md` §3.

---

## The five invariants

These are not style preferences. Violating any of them is a defect, not a
tradeoff. If a task seems to require breaking one, stop and raise it.

### 1. Tenant isolation is enforced by the database, not by application code

Every tenant-scoped table has `tenantId`. Every such table has Postgres
**row-level security** enabled with a policy keyed on
`current_setting('app.tenant_id')`. The app sets that session variable at the
start of every request transaction.

Application-level scoping (a Prisma extension injecting `tenantId`) is a
**convenience layer, not the control**. Prisma client extensions do not
intercept nested relation reads — `findMany({ include: { leagues: true } })`
will happily return another tenant's leagues. For soft-delete that's a bug.
For tenancy it's a breach. RLS is the thing that actually holds.

RLS is enforced by **database role**, never by a session variable. Any role can
set an `app.*` GUC, so a policy gated on one is not a security boundary.
Cross-tenant access belongs to `commish_platform`, a role `commish_app` is not
a member of and cannot `SET ROLE` into.

All four raw methods — `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`,
`$executeRawUnsafe` — are lint-banned outside `lib/domain/db.ts` (which
implements `withTenant`) and `lib/db/admin/`.

### 2. One write path

All mutations go through `lib/domain/`. The Prisma client is exported **only**
from `lib/domain/db.ts` and is not re-exported. Route handlers, server actions,
admin screens, and integration sync all call the same domain services with
different actor contexts.

An ESLint `no-restricted-imports` rule fails CI on Prisma imports from
`app/**`. Do not add exceptions. If admin needs something the domain layer
can't do, the domain layer is missing a method.

### 3. Every mutation is audited, in the same transaction

Audit rows are written inside the transaction they describe. Domain events are
emitted **after** commit. Audit is append-only, enforced by a non-owning
runtime DB role plus a `BEFORE UPDATE OR DELETE` trigger — `REVOKE` alone does
not bind a table owner and the app role usually owns its tables.

`AuditEvent` carries `tenantId` and is RLS-protected like everything else. An
operator sees their own audit trail and never another tenant's.

### 4. Soft delete, never hard delete

No application code issues `DELETE`. Deletable models carry `deletedAt`,
`deletedBy`, `deleteReason`, `purgeAfter` — all four, on every one of them.
Only the purge job deletes, and it runs as `commish_purge`.

`delete` and `deleteMany` are **lint-banned** outside the purge path. Filtering
them in the soft-delete extension is not enough: injecting `deletedAt: null`
into a `deleteMany` still hard-deletes every row it matches.

Unique constraints ignore `deletedAt`, so every uniqueness rule on a
soft-deletable model is a **partial unique index in raw SQL**
(`WHERE "deletedAt" IS NULL`). Prisma's `@unique` cannot express this. Check
`prisma/migrations/*_constraints/` before adding any `@unique`.

### 5. Roster membership is effective-dated, not current-state

`RosterSlot` has `effectiveFrom` / `effectiveTo` as a half-open interval
`[from, to)`. Removing a player **closes an interval**; it does not delete a
row and it does not set `deletedAt`. Scoring reads the roster as it stood at a
week's lock time, so history stays reproducible.

Soft delete and effective dating are different tools:

- Soft delete = "this should not exist, but I might want it back"
- Effective dating = "this was true, then stopped being true, both matter"

A backdated edit — `effectiveFrom` earlier than the last scored week — is a
separate, higher-privilege action that enqueues a rescore and notifies the
league. Never let it happen through the ordinary path.

---

## Actor context

Three independent axes. Do not collapse them into one enum.

```ts
type ActorContext = {
  userId: string
  actorLabel: string              // denormalised; survives user deletion
  tenantId: string                // ALWAYS present; drives RLS
  platformRole: PlatformRole | null   // us
  tenantRole:   TenantRole   | null   // the operator's staff
  leagueRole:   LeagueRole   | null   // commissioner / manager
  onBehalfOfLeagueId?: string     // act-as, never session takeover
  reason?: string
  requestId: string
}
```

`platformRole` is stored on its own `PlatformGrant` model, never as a column on
`User`. A column on a broadly-writable table is a privilege-escalation path; a
separate table with its own write path is not.

Authorization is one function reading one matrix:
`authorize(ctx, action, resource)`. No role checks scattered in route handlers.
Adding an action means adding a matrix row, and the `ActionKey` union makes a
missing row a compile error.

Platform staff acting inside a tenant keep their own `userId`. Impersonation
that rewrites the actor is banned — audit rows must never appear to have been
written by someone who didn't write them.

**Identity is split.** `User` is global (id + auth only, no PII) because one
person may work for two operators. Everything an operator sees about a person
lives on `TenantUser`, which is tenant-scoped and RLS-protected. Never put a
name or email on `User` — it makes every `include: { user: true }` a
cross-tenant PII leak, and `User` cannot be RLS-scoped by a simple column.

---

## Conventions

**Errors are typed, not thrown.** Domain methods return
`Result<T, DomainError>`. `DomainError` is a discriminated union (`FORBIDDEN`,
`WRONG_PHASE`, `INVARIANT`, `REASON_REQUIRED`, `NOT_ENTITLED`, `CONFLICT`,
`TENANT_MISMATCH`). Half of perceived admin-tool quality is refusals that
explain themselves — "pause the draft first" with a working Pause button, not a
red `Forbidden` toast.

**Validate at the boundary.** Zod on every input. `League.config` is JSON but is
never read raw — parse it, and bump `configVersion` when the shape changes.

**Phase gates go inside the transaction.** Read the league with
`SELECT … FOR UPDATE` as the first statement, then check. Checking before
opening the transaction is a TOCTOU bug.

**Integration input is untrusted.** Data from Sleeper/ESPN/Yahoo enters through
a reconciler with a synthetic actor, and can never trigger an action the matrix
would deny a human. Never write provider credentials into audit `before`/`after`
payloads.

**Tests that matter:** one per permission-matrix row; a tenant-isolation suite
that asserts cross-tenant reads return empty with RLS on; a purge test against a
fully-populated league.

---

## Anti-patterns — do not do these

- Adding `@unique` to a soft-deletable model (use a partial index)
- Importing Prisma outside `lib/domain/` — and note `db.ts` exports
  `withTenant` only, never the bare client
- Gating an RLS policy on a session variable instead of a role
- Calling `withTenant` from inside `withTenant` without going through the
  `AsyncLocalStorage` re-entry path (opens a second connection, then deadlocks
  on the outer transaction's row lock — under load, not in tests)
- `$transaction([...])` array form for tenant-scoped work (can't carry the
  `set_config`, so tenancy silently vanishes)
- `include`-ing relations across a tenant boundary and assuming scoping held
- Emitting a domain event inside the transaction (it may roll back — you'll
  push a notification about a trade that didn't happen)
- Using `findUnique` on a soft-deletable model (can't be filtered — use
  `findFirst`)
- `BigInt` primary keys on anything the Next.js server sends to a client
  (doesn't survive JSON serialization)
- Password-hashing an API key (bcrypt/argon2 buy nothing on a high-entropy
  random value, add ~100ms to every call, and bcrypt truncates at 72 bytes —
  use SHA-256 + `timingSafeEqual`)
- Building a draft board. We integrate with existing platforms — see HANDOFF.

---

## Current state

The repo predates this document and is early. **Do not assume anything above
already exists.** Ticket `T-000` is a read-only survey; run it first and report
before writing code.
