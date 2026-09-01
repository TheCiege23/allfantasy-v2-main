# Tenancy architecture

How Commissioner OS isolates operators from each other. Read this before
touching anything with `tenantId` on it.

---

## 1. The decision: shared schema + RLS

| Model | Isolation | Ops cost | Verdict |
|---|---|---|---|
| Database per tenant | Strongest | Migrations × N, pool explosion | No — not at this stage |
| Schema per tenant | Strong | Prisma multi-schema is weak; migrations painful | No |
| Shared schema, app-scoped only | **Weak** | Cheapest | **No — one missed `where` is a breach** |
| Shared schema + Postgres RLS | Strong | One migration, one pool, some Prisma friction | **Yes** |

**Revisit if:** an operator contractually requires physical separation, or one
tenant's volume justifies its own database. The `tenantId` column keeps the
migration path to database-per-tenant open; app-level-only scoping would not.

---

## 2. Why app-level scoping is not enough

The tempting approach is a Prisma extension injecting `tenantId` into every
`where`. Do it — but it is a convenience, not the control.

**Prisma client extensions do not intercept nested relation reads.**

```ts
// The extension fires on `findMany`. NOT on the included relation.
await db.tenant.findMany({ include: { leagues: true } })
// ^ returns other tenants' leagues unless RLS stops it.
```

For soft-delete the consequence is a stale row in a list. Here it is one
operator reading another's customer data — a breach, a contract violation, and
likely a notification obligation.

Other holes: `$queryRaw` bypasses extensions entirely; `findUnique` can't be
filtered; `count`/`aggregate`/`groupBy` need separate handling and get
forgotten; a new developer's first query is written from memory.

RLS closes these **for tables that have a policy**. It does nothing for a
table you forgot to enable it on — which is why §3.5 exists.

---

## 3. Implementation

### 3.1 Four database roles

| Role | Owns tables | RLS | Used by |
|---|---|---|---|
| `commish_migrate` | yes | applies, with an explicit bypass policy | Prisma Migrate, CI, backfills |
| `commish_app` | no | **enforced** | the running app |
| `commish_platform` | no | cross-tenant read policy | platform support path only |
| `commish_purge` | no | bypass policy, delete rights | the purge job |

Postgres table owners bypass RLS by default, and Prisma Migrate creates tables
as whoever is in `DATABASE_URL`. If app and migrations share a role, that role
owns every table, RLS silently does nothing, and isolation tests pass against
a control that isn't running.

`commish_app` must have `rolbypassrls = false` and `rolsuper = false`, and must
not be a member of any other role here. Managed Postgres default roles
(Supabase `postgres`, RDS `rds_superuser`) often carry `BYPASSRLS` — assert
against it rather than assuming.

> 🛑 **MEASURED 2026-09-01: NEON'S `neondb_owner` CARRIES `BYPASSRLS`, AND THAT
> IS THE ROLE THIS APP CONNECTS AS.** The list above named Supabase and RDS and
> not Neon, which is the provider we are actually on. Run against the All Fantasy
> project (Postgres 17):
>
> ```
> role            neondb_owner
> bypasses_rls    true      ← policies are never evaluated
> is_superuser    false
> in_migrate      true
> in_purge        true
> policies_exist  true
> ```
>
> ⚠ **THREE INDEPENDENT REASONS, AND THE DOCUMENTED ONE IS THE WEAKEST.** §3.1
> anticipates "the app owns the tables"; `prisma/migrations-pending/README.md`
> found "the app INHERITS the owner". Both are real, and neither is what would
> bite first — `BYPASSRLS` means RLS is skipped before any policy is consulted.
> So the 9 tables and 27 policies applied by T-102 currently do nothing for the
> application connection, and would not start doing anything by fixing the
> membership alone.
>
> This is asserted at runtime now rather than remembered: `lib/domain/
> isolationGuard.ts` refuses to run a tenant-scoped query on a connection that
> reports any of the three, and `withTenant` calls it before it sets
> `app.tenant_id` or runs the callback.

### 3.2 Policies: `FORCE`, scoped `TO` a role

```sql
ALTER TABLE "League" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "League" FORCE ROW LEVEL SECURITY;   -- applies to the owner too

-- The app: one tenant at a time. nullif() guards against an empty-string
-- reset value matching rows; the explicit WITH CHECK stops cross-tenant
-- INSERT even if someone later narrows this to FOR SELECT.
CREATE POLICY tenant_isolation ON "League"
  FOR ALL TO commish_app
  USING      ("tenantId" = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), ''));

-- Migrations, backfills, purge: full access, by ROLE.
CREATE POLICY maintenance ON "League"
  FOR ALL TO commish_migrate, commish_purge
  USING (true) WITH CHECK (true);

-- Platform support: read-only, cross-tenant, by ROLE.
CREATE POLICY platform_read ON "League"
  FOR SELECT TO commish_platform USING (true);
```

`FORCE` without the `maintenance` policy is a trap: T-101's backfill runs as
`commish_migrate` with `app.tenant_id` unset, matches zero rows, and the
subsequent `SET NOT NULL` either fails or silently succeeds against unchanged
data. Same for the purge job.

### 3.3 Cross-tenant access is a role, not a variable

> **This is the single most important thing in this document.**

An earlier design gated platform access on a session variable:

```sql
-- WRONG. Do not do this.
USING (current_setting('app.platform_override', true) = 'on')
```

Custom GUCs in an unregistered `app.*` namespace are settable by **any role,
with no privilege check**. `commish_app` can run
`SELECT set_config('app.platform_override','on',true)` freely. The entire
cross-tenant boundary would rest on application code never calling it — which
is exactly the class of control this architecture rejects. Combined with the
`lib/db/admin/` raw-SQL allowance and the `withDeleted()` escape, any injection
or careless statement becomes full cross-tenant read.

Cross-tenant access therefore belongs to `commish_platform`, reached through a
**separate connection pool** used only by the platform-support path.
`commish_app` is not a member and cannot `SET ROLE` into it. Every use is the
audited action `tenant.crossTenantRead`, requires a reason, and marks resulting
audit rows `isPlatformRead = true`.

### 3.4 `withTenant`, re-entrant

```ts
// lib/domain/db.ts — the ONLY place the client is constructed, and it
// exports withTenant, never the bare client.
const als = new AsyncLocalStorage<{ tenantId: string; tx: Prisma.TransactionClient }>()

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const open = als.getStore()
  if (open) {
    // Re-entry. Reuse the live transaction — opening a second one takes a
    // second connection, which then blocks on the outer transaction's
    // SELECT ... FOR UPDATE. Self-deadlock, under load, not in tests.
    if (open.tenantId !== tenantId) throw new TenantMismatchError()
    return fn(open.tx)
  }
  return prisma.$transaction(
    async (tx) => {
      // set_config(..., true) = LOCAL to this transaction. The `true` is
      // load-bearing: without it the value outlives the transaction and
      // leaks to the next request borrowing this pooled connection.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return als.run({ tenantId, tx }, () => fn(tx))
    },
    { timeout: 15_000, maxWait: 5_000 },
  )
}
```

Notes that matter:

- `set_config()` rather than `SET LOCAL` because `SET` cannot take a bind
  parameter. Don't "simplify" this into string interpolation.
- Interactive `$transaction` pins one pooled connection for the callback —
  that guarantee is what the design relies on. The `$transaction([...])` array
  form **cannot** carry the `set_config` and silently loses tenancy.
- Every read now sits in a transaction, so raise the default 5s timeout and
  keep callbacks short.

### 3.5 A policy-coverage test, not a checklist

Fifteen-plus tables need identical policies applied by hand, forever. The
failure mode is someone adding a table in month eight and forgetting.

CI asserts: every table with a `tenantId` column has `relrowsecurity` and
`relforcerowsecurity` true and at least one policy. Cheap, and the highest-value
test in the suite after the isolation suite itself.

### 3.6 Bootstrap: queries that run before `tenantId` is known

Some lookups cannot be tenant-scoped because they are what *determines* the
tenant: resolving an inbound API key by prefix, resolving a tenant by slug from
the request path, listing a user's `TenantMember` rows at login.

These run outside `withTenant` and would return zero rows. Do **not** add an
ad-hoc bypass — that bypass becomes the real hole. Use a small, reviewed set of
`SECURITY DEFINER` functions owned by `commish_migrate`, each returning only an
identifier, with `EXECUTE` granted to `commish_app`:

```sql
CREATE FUNCTION app.resolve_api_key(p_prefix text)
RETURNS TABLE (tenant_id text, key_id text, hash text, scopes text[])
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT "tenantId", id, hash, scopes FROM "TenantApiKey"
   WHERE prefix = p_prefix AND "revokedAt" IS NULL
     AND ("expiresAt" IS NULL OR "expiresAt" > now());
$$;
```

Keep this set tiny, review every addition, and never let one return a business
object — only enough to establish identity.

### 3.7 Connection pooling

- Prisma's named prepared statements break under pgbouncer transaction mode.
  Use `?pgbouncer=true`, or pgbouncer >= 1.21 with `max_prepared_statements`.
- `prisma migrate` **cannot** run through a transaction-mode pooler (advisory
  locks + DDL). It needs a direct connection.
- So there are three URLs, not two: pooled app URL, direct `directUrl` for
  migrations, and the platform-support pool. Document the role against each.

### 3.8 There are TWO tenant ids in this repo, and only one is a boundary

> Added 2026-08-31, after a survey of the existing code. Not in the original
> spec — recorded here because it is a collision that will read as correct in a
> code review.

AllFantasy already has a `tenantId`, and it is **not** this one.

`lib/white-label/` resolves a **brand** from `NEXT_PUBLIC_TENANT_ID`. Its own
header says what it is: "Synchronous, pure, frontend-only. The active tenant is
chosen by `NEXT_PUBLIC_TENANT_ID` (build/runtime env — NOT a database or route)."
Measured: five source references, all under `lib/white-label/`; the only
consumer that could have been a gate, `isFeatureVisible`, is a pure predicate
over static config (`config.features[feature] !== false`) called from three JSX
render guards in client components. `grep -rln "isFeatureVisible" app/api`
returns **zero**, and nothing server-side reads the variable.

So it is a display value today, and fine as one.

🛑 **It becomes dangerous the moment tenancy makes "which tenant am I" a
security question — which is what §3.2 does.** `NEXT_PUBLIC_` means the value
ships in the client bundle: any viewer can read it and any viewer can change it.
When the policies land there will be a tenant id already resolved and
conveniently to hand on the client, and it is attacker-controlled.

**The tenant identity passed to `withTenant` must come from the server-side
session. Never from `NEXT_PUBLIC_TENANT_ID`, and never from a request body,
query parameter or header.** The two values will look interchangeable in a
review — same concept, same name, one is branding and one is the boundary — and
the failure is silent in the worst way: every page renders correctly and
cross-tenant reads succeed.

⚠ **The sharpest edge is `resolveTenantBrand(tenantId?: string)`**, which takes
a caller-supplied id that OVERRIDES the env var and falls back to the default
tenant for an unknown one. A function that accepts a tenant id and never fails
is exactly what someone reaches for when wiring §3.4, and it would hand back a
brand config while looking like it resolved an identity.

⚠ **AND THE TWO NAMESPACES DO NOT OVERLAP, SO THE FALLBACK IS THE DEFAULT
OUTCOME RATHER THAN A RARE MISCONFIGURATION.** `TENANT_REGISTRY` is a hardcoded
two-entry object — `allfantasy` and `apex` — not DB-backed. Once T-101 creates
the `Tenant` table there are two disjoint sets of things called a tenant id:
that static registry of white-label **brands**, and the `Tenant` rows. `Tenant.id`
is a `cuid()`, so **every real operator tenant misses the registry and silently
receives the default config**. Cosmetic while the return value is only theming;
cross-tenant presentation the moment anyone treats it as identity — and it
reports success either way.

🛑 **The dev case passes for the worst possible reason.** `DEFAULT_TENANT_ID` is
`allfantasy`, and T-101 seeds the bootstrap tenant with the literal id
`allfantasy` (it has to — it must match the five pre-existing
`tenantId @default("allfantasy")` columns). So through all of T-101 and T-102
development there is exactly one tenant, its id is the one id the registry
knows, and everything resolves correctly. It starts being wrong at the moment
the second tenant is created — which is precisely when nobody is looking at
branding, and long after the code was reviewed.

⚠ **The docstring argues FOR the fallback**, which makes it harder to challenge
in review than a bare one: "Falls back to the default tenant for an unset or
unknown id, so a misconfigured deployment renders the first-party brand rather
than crashing." That is correct reasoning for branding and exactly inverted for
identity. The next person does not find a silent fallback; they find one with a
rationale attached.

Two mitigations, both cheap:

1. Never import anything from `lib/white-label/` into `lib/domain/`. The
   dependency is the bug; forbidding it is the fix, and it is checkable.
2. Rename the white-label variable and its resolver so the collision cannot
   happen by autocomplete — `NEXT_PUBLIC_BRAND_ID` / `resolveBrand()` say what
   they are. With the namespace point above this is more than hygiene: it
   removes the shared vocabulary that makes two disjoint sets look like one.
3. Consider making the lookup THROW on an unknown id at any identity boundary
   while keeping the fallback for theming. A brand that cannot resolve should
   render the default; an identity that cannot resolve must not return one.

Mitigations 2 and 3 are AllFantasy-side changes belonging to whoever owns
`lib/white-label/`, not to this ticket. Mitigation 1 is enforced now:
`__tests__/commissioner-os/domainBoundary.test.ts` fails if any file in
`lib/domain/` imports that module, in any of the four import forms.

---

## 4. Identity: `User` is global, PII is tenant-scoped

The tenant-scoped model list deliberately **excludes `User`** — and that is a
decision, not an omission.

One person may work for two operators, so `User` cannot be scoped by a simple
`tenantId` column, and a policy keyed on "exists a membership in this tenant"
needs a subquery, which §5 forbids. If PII sat on `User`, every
`include: { user: true }` from a `Membership` would leak names and emails
across tenants — the exact failure RLS is here to prevent.

So identity splits:

- **`User`** — global. Id, auth credentials, nothing else. No name, no email.
- **`TenantUser`** — tenant-scoped, RLS-protected. Display name, the email as
  this operator knows it, avatar, locale. All PII lives here.

`Membership` and `TenantMember` reference `TenantUser`, not `User`. The only
code that touches `User` is authentication.

This cannot be retrofitted cheaply. Settle it before T-101.

---

## 5. Schema additions

See `tenancy.prisma`. Every tenant-scoped model carries `tenantId` even where
it's reachable by join — an RLS policy must be evaluable on its own table
without a subquery, and a policy that joins is slow and easy to get wrong.
`Tenant` itself is the exception: it has no `tenantId`, so its policy keys on
its own primary key.

```sql
CREATE POLICY tenant_self ON "Tenant"
  FOR ALL TO commish_app
  USING (id = nullif(current_setting('app.tenant_id', true), ''));
```

---

## 6. What this changes about the spec

The published spec's §4 permission matrix has **two** actor tiers and needs
three. Concretely:

- A `TenantRole` axis: `TENANT_OWNER`, `TENANT_ADMIN`, `TENANT_SUPPORT`
- Most actions currently platform-admin-only become **tenant**-admin actions
  scoped to that tenant's leagues — an operator must run their own business
  without calling us
- Platform keeps: tenant provisioning, suspension, plan changes, cross-tenant
  reads
- `audit.read` and `analytics.read` gain a tenant scope between platform and
  league

New actions with no row in the current matrix: `tenant.provision`,
`tenant.suspend`, `tenant.changePlan`, `tenant.crossTenantRead`,
`tenant.member.invite`, `tenant.member.changeRole`, `tenant.apiKey.issue`,
`tenant.apiKey.revoke`, `tenant.webhook.configure`, `tenant.export`.

**T-103** covers rewriting the matrix. Until it lands, treat the spec's §4 as
correct on league-level actions and incomplete above them.

---

## 7. Operator-facing surface

Ticketed in Phase 1b. They arrive the moment there is a second customer, and
retrofitting is expensive.

- **API + webhooks.** Keys hashed at rest (SHA-256 + `timingSafeEqual`, not a
  password KDF), scoped, rate-limited per tenant. Webhook URLs are
  operator-controlled and the platform makes outbound requests to them — https
  only, reject private/link-local/loopback **after DNS resolution** (rebinding),
  no redirect following. Sign with an HMAC over a timestamp plus body, with a
  tolerance window, so signatures can't be replayed.
- **Branding.** `brandConfig` is untrusted operator input rendered into emails
  and pages. Zod-parse it like `League.config`; escape everything; require
  DKIM/SPF verification before a sender domain goes live.
- **Data export.** Contracts will require it, and T-105's suspended-tenant
  behaviour depends on it. Build it before someone asks under pressure.
- **SSO / SCIM.** `TenantMember` carries `externalId` from the start so SCIM
  doesn't need a migration later.
- **Per-tenant limits.** Leagues, seats, API rate. Enforced centrally; a plan
  change must never need a deploy.

### Two things to be honest about

**Platform reads are visible to the operator.** Operators are data controllers
and we are a sub-processor; DPAs and GDPR Art. 28 generally require
transparency about sub-processor access. `isPlatformRead` rows are shown to the
operator in redacted form — "platform support accessed this tenant at T, reason
category X" — not hidden. Suppressing them entirely becomes a contract problem.

**`Tenant.region` does not enforce residency.** Under shared-schema-single-
database, a tenant marked `eu-west-1` still has every row in the US database.
The field records intent for a future migration. Never let it appear in an
operator-facing UI or contract as a residency guarantee until
database-per-tenant exists.
