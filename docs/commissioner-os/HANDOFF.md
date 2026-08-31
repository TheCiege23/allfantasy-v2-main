# Commissioner OS — build handoff

For Claude Code. Ordered tickets with acceptance criteria. Work them in
sequence; each assumes the previous one landed.

Read first: `CLAUDE.md` (invariants), `TENANCY.md` (isolation). Full product
spec: https://claude.ai/code/artifact/0c2a9ae3-eec5-4b3a-af7b-809bd1a8f145

File placement before starting:

```
CLAUDE.md                          → repo root
docs/commissioner-os/HANDOFF.md    → this file
docs/commissioner-os/TENANCY.md
prisma/tenancy.prisma              → merged into schema.prisma at T-101
```

What we're building: a multi-tenant B2B platform. Fantasy operators license
Commissioner OS to run commissioner tooling for their users. We do not build a
draft board — we integrate with Sleeper/ESPN/Yahoo and own the pain points
around the draft.

Two decisions to settle before T-101 (both are architectural and cannot be
retrofitted cheaply): the `User`/`TenantUser` PII split in `TENANCY.md` §4, and
the `commish_platform` role replacing any session-variable override, §3.3.

## T-000 · Survey the repo · READ ONLY, DO NOT WRITE CODE

The repo predates this plan and is early. Nothing in `CLAUDE.md` should be
assumed to exist. Produce a report, then stop and wait.

1. Stack reality — Next.js version and router, TypeScript strictness, Prisma
   version, Postgres version and host, connection pooler (pgbouncer? Supabase?
   RDS Proxy?), package manager.
2. Schema — every model, which have `deletedAt`, which have `@unique`, whether
   `User`/`Team` exist and whether `User` currently holds PII. Does
   `prisma validate` pass?
3. Data access — where is the Prisma client constructed? How many files import
   it? Any raw SQL? Any DB access from `app/**`?
4. Auth — what exists? Session shape? Can it carry a three-axis actor context,
   or does it need replacing?
5. DB roles — how many roles exist today? Does the app connect as the table
   owner? Does that role have `BYPASSRLS` or `SUPERUSER`?
6. Migrations — history clean or drifted? Any raw SQL already present?
7. Tests — framework, test database, anything data-related covered?
8. Existing data — real leagues/users in production? This decides whether T-101
   is a three-step backfill or a fresh column.
9. Gap list — for each of the five invariants in `CLAUDE.md`: holds, partially
   holds, or absent.

**Acceptance:** `docs/commissioner-os/SURVEY.md`. No code, no migrations, no
installs. Flag anything that makes this plan wrong — especially production
data, PII already on `User`, or an auth system that can't carry the context.

## Phase 0 — Foundations

Nothing user-visible ships. Every later phase is cheaper or more expensive
depending on whether this is done properly.

### T-001 · Four database roles

First, because RLS and append-only audit are both decorative without it.

- `commish_migrate` — owns tables; Prisma Migrate, CI, backfills
- `commish_app` — owns nothing; the running app, RLS enforced
- `commish_platform` — cross-tenant read, separate pool, platform path only
- `commish_purge` — the only role that deletes

Three connection URLs in `.env.example` (pooled app, direct `directUrl` for
migrations, platform pool), each commented with its role and why. Document
local setup — this trips people on a fresh clone.

**Acceptance:** a test asserts `commish_app` has `rolbypassrls = false` and
`rolsuper = false`, owns no tables, and is not a member of any other role (so
it cannot `SET ROLE`). `prisma migrate dev` works via `directUrl`. App boots as
`commish_app`.

### T-002 · `withTenant`

Moved into Phase 0 — T-003 depends on it. Needs only T-001.

Implement per `TENANCY.md` §3.4: re-entrant via `AsyncLocalStorage`,
`set_config(..., true)`, explicit `timeout`/`maxWait`. `lib/domain/db.ts`
exports `withTenant` only — never the bare Prisma client.

Tenant-scoped tables don't exist yet, so this ships against a seeded default
tenant and is verified properly at T-102.

**Acceptance:** a test proves nested `withTenant` reuses the outer transaction
rather than opening a second connection, and that a mismatched inner tenantId
throws `TENANT_MISMATCH`. A test proves the session value does not survive the
transaction.

### T-003 · Actor context and typed errors

`ActorContext` from `CLAUDE.md`, the `DomainError` union, `Result<T, E>`, and a
builder that constructs a context from a request. T-001 seeds a default tenant
so `tenantId` is satisfiable before T-101.

**Acceptance:** `ActorContext` cannot be constructed without `tenantId` —
enforced at the type level, not by convention. Unit tests cover each
`DomainError` variant round-tripping to an HTTP response shape.

### T-004 · The mutation wrapper

`lib/domain/mutation.ts`. Every write goes through it:

1. `withTenant` (T-002)
2. Re-read the target `SELECT … FOR UPDATE` — phase gates checked before the
   transaction are a TOCTOU bug
3. `authorize(ctx, def.requires, resource)`
4. Phase gate
5. `precondition` hook — non-phase preconditions (draft status, rate limits,
   entitlements) live here, not squeezed into the phase gate
6. Reason present and valid when required
7. `def.run`
8. Write `AuditEvent` in this transaction
9. Commit, then emit the domain event

"Valid reason" is defined, not left to judgement: >= 12 characters, not equal to
the action name, not in a stoplist (`test`, `fix`, `asdf`, `n/a`).

**Acceptance:** a test proves no event is emitted when the transaction rolls
back. A test proves the audit row is written in the same transaction. A test
proves a concurrent phase change yields `CONFLICT`, not a write against a stale
phase.

### T-005 · Prisma boundary + lint rules

Client constructed only in `lib/domain/db.ts`. ESLint `no-restricted-imports`
bans `@prisma/client` from `app/**`. Ban all four raw methods (`$queryRaw`,
`$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe`) outside
`lib/domain/db.ts` and `lib/db/admin/` — the `Unsafe` variants are the
dangerous ones and are easy to forget. Ban `delete`/`deleteMany` outside the
purge path.

**Acceptance:** run ESLint programmatically against a fixture containing each
violation and assert it errors; exclude the fixture path from the normal lint
run so CI isn't permanently red.

### T-006 · Soft delete

Extension injecting `deletedAt: null` on `findMany`, `findFirst`, `count`,
`aggregate`, `groupBy`, `findFirstOrThrow`, `updateMany`. Model-aware —
injecting into a model without the column throws. `findUnique` banned for
soft-deletable models via lint.

`deleteMany` is not filtered — it's banned (T-005). Injecting `deletedAt: null`
into a delete still hard-deletes everything it matches.

The `withDeleted()` escape is an action (`data.readDeleted`), platform and
tenant-support only, reason required.

**Acceptance:** tests cover every intercepted operation. One test documents the
known hole — a nested `include` returning soft-deleted children — with a
comment pointing at the service-layer filter. Don't paper over it; the same
limitation is load-bearing in T-102.

### T-007 · Append-only audit

`AuditEvent` model, `REVOKE UPDATE, DELETE` from `commish_app`, and a
`BEFORE UPDATE OR DELETE` trigger that raises. `actorLabel` denormalised. `id`
is `Int`, not `BigInt` (BigInt doesn't survive JSON serialization to a client
component).

**Acceptance:** a test asserts `UPDATE` and `DELETE` against `AuditEvent` both
raise, as `commish_app` and as `commish_migrate` (the trigger is what catches
the owner; `REVOKE` alone does not).

### T-008 · Non-tenant constraints

Raw SQL for what Prisma's DSL can't express — excluding anything with a tenant
dimension, which T-101 owns:

- `Membership.teamId` unique, `DEFERRABLE INITIALLY DEFERRED` — a
  non-deferrable constraint makes owner swaps impossible inside a transaction
- `DraftPick` live-slot and live-player partial uniques
  (`WHERE "supersededById" IS NULL`)

`League.slug` and the `RosterSlot` open-interval unique are deferred to T-101,
because both become per-tenant and would be written twice otherwise.

**Acceptance:** a test per constraint proving the violation is rejected. A test
proving an owner swap (two UPDATEs, one transaction) succeeds.

### T-009 · Purge job

The only code permitted to `DELETE`, running as `commish_purge`. Decide and
implement cascade: `onDelete: Cascade` on FKs to `League` and `Tenant`, or an
explicitly ordered delete. `AuditEvent.leagueId` and `LeagueFeature.leagueId`
are deliberately exempt so they survive. The retention interval lives in
config, not prose.

**Acceptance:** a test purges a fully-populated league — teams, rosters,
drafts, memberships, features — with no FK violation, and asserts audit rows
survive. This path runs long after anyone last looked at it; the test is the
only thing that will catch a regression.

## Phase 1 — Tenancy

### T-101 · Tenant schema, identity split, and backfill

Apply `tenancy.prisma` including its commented `League` changes — it does not
validate standalone. Implement the `User`/`TenantUser` split from `TENANCY.md`
§4: move all PII off `User`.

If T-000 found production data, the backfill is three steps: create a default
tenant, assign existing rows, then add `NOT NULL`. Not one migration.

Add the tenant-dimension constraints deferred from T-008: `(tenantId, slug)`
and `(tenantId, leagueId, playerId) WHERE "effectiveTo" IS NULL`, plus the
`TenantWebhook.events` GIN index.

**Acceptance:** `prisma validate` passes. Every tenant-scoped model has
`tenantId` leading its composite indexes. `User` holds no PII. No model
reachable from `League` lacks the column — except `LeagueBinding`, which
doesn't exist until T-201.

### T-102 · RLS policies and bootstrap functions

Enable and force RLS on every tenant-scoped table, with policies scoped `TO` a
role per `TENANCY.md` §3.2 — app, maintenance, and platform policies are three
separate grants. Add the `SECURITY DEFINER` bootstrap functions from §3.6 for
lookups that run before `tenantId` is known.

**Acceptance — the most important tests in the codebase:**

- First, assert `current_user = 'commish_app'` and fail loudly otherwise.
  Without this the whole suite can pass against a control that isn't running.
- Seed two tenants with overlapping-looking data; assert a query under tenant A
  returns zero rows of tenant B for every tenant-scoped model
- Same for a nested `include` — where app-level scoping fails and RLS has to
  carry it
- Set `connection_limit=1` on the test datasource, run tenant A's transaction
  then tenant B's, and verify no residue. Without the connection limit this
  test passes vacuously.
- Assert a raw query without `withTenant` returns nothing, not everything
- Assert `commish_app` cannot `SET ROLE commish_platform`
- Assert a backfill as `commish_migrate` sees rows (the FORCE + maintenance
  policy interaction — this is what silently no-ops if you get it wrong)

### T-103 · Policy coverage test

CI asserts every table with a `tenantId` column has `relrowsecurity` and
`relforcerowsecurity` true and at least one policy. Cheap, and the thing that
catches the table someone adds in month eight.

**Acceptance:** add a table with `tenantId` and no policy; CI fails.

### T-104 · Three-axis authorization

Extend `authorize()` and the matrix for `TenantRole`. Rewrite per `TENANCY.md`
§6: most current platform-admin actions become tenant-admin actions scoped to
that tenant's leagues. `ActionKey` is exhaustive so a missing row is a compile
error.

**Acceptance:** one test per matrix row. A test proving `TENANT_ADMIN` cannot
act on another tenant's league even with a valid league ID. A test proving
`TENANT_SUPPORT` has no write actions at all.

### T-105 · Cross-tenant read for platform staff

The `commish_platform` role and its separate pool. Use is the audited action
`tenant.crossTenantRead`, reason required, and marks audit rows
`isPlatformRead = true`.

**Acceptance:** a test proving `commish_app` cannot reach the platform policy
by any means available to it. A test proving every override use produces an
audit row. A test proving `isPlatformRead` rows appear redacted in the
operator-facing audit view — not hidden (`TENANCY.md` §7).

### T-106 · Tenant provisioning and suspension

Create a tenant, invite the first `TENANT_OWNER`, seed plan limits. Suspension
puts a tenant read-only.

Read-only is enforced in the RLS `WITH CHECK`, not in application code — the
invariant says the database holds the boundary, and suspension is no exception.

**Acceptance:** a suspended tenant's writes are rejected at the database, not
just the service layer; reads and export still work.

### T-107 · Data export

Blocks T-106's acceptance and every future contract. A tenant can take their
data and leave: all leagues, members, rosters, audit, as structured files.

**Acceptance:** export a seeded tenant, assert every tenant-scoped model is
represented and that no other tenant's rows appear anywhere in the output.

## Phase 1b — Operator surface

Needed the moment there is a second customer.

### T-111 · API key issuance and verification

Generation (`cos_live_` + random, prefix >= 17 chars), SHA-256 hashing,
`timingSafeEqual` comparison, revocation, expiry enforcement, throttled
`lastUsedAt`. Verification uses the T-102 bootstrap function.

**Acceptance:** a test proving two keys can coexist (catches the prefix-
uniqueness bug), that an expired key is rejected, and that plaintext is
unrecoverable after creation.

### T-112 · API actor context and scopes

An API-key request has no `userId`. Either the matrix gains a scope dimension
or keys carry a `TenantRole` — decide and implement, because today `scopes` is
enforced by nothing.

**Acceptance:** a scoped key is refused an action outside its scopes.

### T-113 · Webhook delivery + SSRF guard

Worker, HMAC signing over timestamp + body with a tolerance window, retry with
backoff, disable at a failure threshold. SSRF guard per `TENANCY.md` §7: https
only, reject private/link-local/loopback after DNS resolution, no redirects.

**Acceptance:** tests reject `localhost`, `10.0.0.0/8`, and `169.254.169.254`,
including via a hostname that resolves to them (rebinding). A replayed
signature outside the tolerance window is rejected.

### T-114 · Per-tenant rate limiting

`Tenant.apiRateLimit` enforced centrally. A plan change must not need a deploy.

## Phase 2 — First integration

Only after Phase 1. Sleeper first: its API is public and documented. Yahoo
needs OAuth and is rate-limited. ESPN has no supported public API and is
typically reached through undocumented endpoints that break without notice —
not the one to learn on.

### T-201 · Provider interface and `LeagueBinding`

One `Provider` interface, one binding model, one sync-job table with status and
cursor. Both gain `tenantId` and RLS policies here — T-103's coverage test will
fail otherwise, which is the point. Credentials go to a secret store; the DB
holds a reference only.

**Acceptance:** the interface is implementable by a stub provider used in
tests. A test asserts no credential material appears in any audit row. T-103
passes.

### T-202 · Sleeper adapter

Connect a league by external ID, pull teams and managers, reconcile.

**Acceptance:** recorded fixtures in CI — no live third-party calls in the
gate. One optional live smoke test outside it. Reconnecting is idempotent:
running sync twice produces no duplicate rows and no spurious audit entries.

### T-203 · Reconciler with synthetic actor

Provider data enters through a reconciler with an integration `ActorContext`,
so `cause: SYNC` rows are distinguishable from human writes. A provider can
never trigger an action the matrix would deny a commissioner.

**Acceptance:** a test feeds hostile provider data — a team belonging to
another tenant, a manager ID that doesn't exist, a roster referencing an
unknown player — and asserts each is rejected with no partial writes.

### T-204 · Degraded sync

`SyncStatus` transitions on failure. A broken league goes read-only and clearly
flagged, never stale-as-live. Assume a provider goes dark mid-season.

**Acceptance:** a simulated provider failure moves the league to `DEGRADED`,
writes depending on external state are refused with a typed error, and the
state is exposed on the API (assert on the state field — no UI in this
handoff's scope).

## Working agreements

**Stop and ask when:** T-000 finds production data the plan doesn't account
for; an invariant in `CLAUDE.md` seems to require breaking; a provider API
doesn't support something a ticket assumes.

**Don't build ahead.** Tickets are sequenced because later ones depend on
earlier interfaces. A half-built T-201 before T-102 lands will be rewritten.

**Tests are part of done.** The criteria above are the minimum. T-102's
isolation suite, T-103's coverage test, and T-009's purge test are the three
that will save you a bad week.

**Update the docs.** If a ticket changes an invariant or a schema decision,
edit `CLAUDE.md` or `TENANCY.md` in the same PR. Stale architecture docs are
worse than none.
