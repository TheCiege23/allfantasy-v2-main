# Scope decision — Commissioner OS is a separate B2B product on the AllFantasy site

Decided by the repo owner, 2026-08-31, answering open question 4 in `SURVEY.md`.

> "A separate product that runs off the Commissioner OS in the AllFantasy site,
> that is B2B specific."

`HANDOFF.md` and `TENANCY.md` were written as though this repo were greenfield.
It is not, and it already contains a shipped Commissioner OS. This file records
what that changes. **Where it disagrees with `HANDOFF.md`, this file is
current** — per the handoff's own instruction to update the docs when a ticket
changes a schema decision.

---

## What already exists

A Commissioner OS surface is live in the repo and was not built by this plan:

```
app/commissioner-os/          20 files   — routes: mission control, activity,
                                           analytics, automations, league
                                           health, managers, notifications,
                                           recommendations, reports, help
components/commissioner-os/   shell + component library, 19 modules
lib/commissioner-os/          108 TS files + ~29 integration reports
```

It is **single-tenant and consumer-shaped**. `resolveActiveLeagueId.ts` picks
the current user's active league from their `Roster` rows; there is no operator
concept anywhere in it. `grep -rn "tenant"` across the whole surface returns
nothing.

## The decision, stated precisely

The B2B product is a **new tenancy layer over this existing surface**, not a
new application and not a rewrite of AllFantasy.

- **Platform** = AllFantasy staff
- **Tenant** = an operator licensing Commissioner OS (new — does not exist yet)
- **League** = **AllFantasy's existing `League`**, gaining `tenantId`

That last line is the one that matters, and it means **the `League.tenantId`
added at T-101 is correct**. The alternative reading — that Commissioner OS
needs its own league entity — was live until this decision, and would have
required reverting that column.

---

## What this changes about the plan — the numbers

`SURVEY.md` §9 measured the five invariants against the **whole repo** and found
them absent at a scale that made the plan look unworkable. Measured against the
**Commissioner OS surface**, which is what the invariants actually govern, the
picture is completely different:

| | whole repo | Commissioner OS surface |
|---|---|---|
| Files importing Prisma | 2,250 | **3** |
| …under `app/**` | 647 | **0** |
| Raw SQL call sites | 180 | **0** |
| Models touched | ~710 | **3** (`appUser`, `roster`, `league`) |

**Invariant 2 — "one write path" — is a three-file migration, not a
four-figure refactor.** The three:

- `lib/commissioner-os/decision-os-client/live.ts`
- `lib/commissioner-os/managers/decision-os-client/live.ts`
- `lib/commissioner-os/resolveActiveLeagueId.ts`

And the surface is already structured for it. Data reaches the UI through
`decision-os-client` adapters rather than through Prisma at the page level —
zero of the 20 route files and zero of the component files import Prisma. That
adapter seam is where `lib/domain/` belongs; it does not need to be invented,
only formalised and given `withTenant`.

**Zero raw SQL in the surface** means invariant 1's `$queryRaw` ban costs
nothing here. The 180 raw sites are all AllFantasy's, outside the boundary.

---

## Revised ticket scoping

Ordering from `HANDOFF.md` is unchanged. Scope is not.

| Ticket | As written | As scoped here |
|---|---|---|
| T-001 roles | whole database | unchanged — roles are cluster-wide |
| T-002 `withTenant` | `lib/domain/db.ts` | unchanged, new file |
| T-005 lint boundary | bans Prisma from **`app/**`** | bans it from **`app/commissioner-os/**` and `lib/commissioner-os/**`** only. Banning it repo-wide would fail CI on 647 unrelated AllFantasy files and get switched off within a day. |
| T-006 soft delete | all deletable models | tenancy models only. 4 of 710 AllFantasy models have `deletedAt`; retrofitting the rest is not this product. |
| T-007 audit | new `AuditEvent` | unchanged. Note four audit-ish models already exist (`AuditFeedEntry`, `DomainEvent`, `LeagueAuditLog`, `FinanceAuditEvent`) — decide whether `AuditEvent` supersedes or sits beside them before building. |
| T-101 identity split | move PII off `User` | **still blocked, and still the biggest open item.** See below. |
| T-102 RLS | "every tenant-scoped table" | the six tenancy tables + `PlatformGrant`. **NOT `leagues`** — see below. Not all 710. |
| T-103 coverage test | every table with `tenantId` | ⚠ this one **does** hit the whole repo — see below. |

### Two that do not shrink

**T-103's policy-coverage test will fail on five pre-existing tables.**
`TradeExecutionSnapshot`, `DomainEvent`, `AuditFeedEntry`,
`IntelligenceLeagueSnapshot` and `IntelligenceLeagueSnapshotHistory` each carry
`tenantId String @default("allfantasy")` from an earlier FK-less attempt. The
test's rule is "every table with a `tenantId` column has a policy", so those
five are in scope by definition. Either they join the scheme properly (FK,
tenant-leading index, RLS policy) or the column is renamed off them. Leaving
them is the one outcome that makes the coverage test lie.

**The `User`/`TenantUser` PII split is unchanged in difficulty.** `AppUser`
holds email, username, displayName, avatarUrl and passwordHash, and is
referenced by ~100 relations across the consumer product. Commissioner OS being
a separate product does not make that cheaper — but it does make it **optional
for longer**, because the operator-facing PII (`TenantUser`) is new data about
new people. Operators' staff are not AllFantasy consumers.

Recommendation: **populate `TenantUser` for operator staff now, and leave
`AppUser` alone.** The leak `TENANCY.md` §4 warns about — `include: { user: true }`
crossing a tenant boundary — cannot happen until Commissioner OS code joins to
`AppUser` from a tenant-scoped model. It does not today. Revisit when it would.

---

## What the B2B layer has to add that the current surface lacks

Beyond tenancy itself, the single-tenant assumption is concentrated in one
place and it is worth naming:

`lib/commissioner-os/resolveActiveLeagueId.ts` answers "which league is this
person looking at" from *their own rosters*. A tenant's support agent has no
roster in their customer's league, so under B2B this function has no answer.
Replacing it with a tenant-scoped league resolver is the first real product
change, and it should happen after T-102 so that the replacement can rely on
RLS rather than re-implementing scoping in TypeScript.

---

## T-102 correction: `leagues` cannot take RLS yet

This file previously said T-102 covers "the six tenancy tables + `leagues`". The
second half was wrong, and measuring it is what found that out:

```
1,020   AllFantasy call sites reading prisma.league / db.league
    0   code paths that connect as commish_app
```

`FORCE ROW LEVEL SECURITY` plus policies scoped `TO` the `commish_*` roles means
a connection as any other role matches no policy — and a table with RLS enabled
and no matching policy returns **zero rows**. It does not error. So enabling RLS
on `leagues` today does not risk an outage, it **is** one, across 1,020 call
sites, presenting as "the app renders as though the database is empty" rather
than as anything resembling a permissions failure.

The prerequisite is not a Commissioner OS decision. Either the AllFantasy read
path connects as a role that has a policy here, or `leagues` gets an explicit
legacy policy naming whichever role it uses today. The SQL for both is written
and commented out at the end of the T-102 migration, with the role name left
blank deliberately — it differs per environment, and guessing it is how this
gets applied somewhere it means something else.

The same reasoning defers the five pre-existing `tenantId @default("allfantasy")`
tables. `DomainEvent` is the sharpest: it is the outbox T-007 writes to, so
enabling RLS there without a policy for the relay role stops event delivery
silently — and a relay that finds nothing looks exactly like a relay with
nothing to do.

`lib/domain/tenantScopedTables.ts` is the register of record, read by the
migration's policy loop, the isolation suite, and (next) T-103's coverage test.
Every deferred entry carries a written reason, and a test asserts it does — a
deferred table with no reason is indistinguishable from an oversight.

## Two hazards found while building Phase 0

**Partial unique indexes are invisible to Prisma, and `migrate dev` may drop
them.** T-101 creates four (`TenantUser` x2, `TenantMember` x2) and T-008 adds a
fifth on `PlatformGrant`; none can be expressed in `schema.prisma`, because
Prisma's DSL has no `WHERE`. `prisma migrate deploy` leaves them alone, but
`prisma migrate dev` diffs the schema against the database and will offer to
drop an index it cannot see a source for. The uniqueness rules that enforce
"one live member per tenant" and "one live platform grant per role" would go
away silently, and nothing would fail until a duplicate arrived.

Mitigation is a check, not a convention: T-103's policy-coverage test is the
natural place to also assert every expected partial index still exists. Until
then, treat any `migrate dev` output that drops a `*_live_key` index as a bug in
the migration, not a cleanup.

**A partial unique and a DEFERRABLE unique are mutually exclusive**, and T-008
asks for both. `DEFERRABLE` is a property of a constraint; a unique constraint
cannot carry `WHERE`. Partial uniqueness is only expressible as an index, and an
index cannot be deferred. Since invariant 4 makes every soft-deletable model's
uniqueness partial, the owner swap T-008 specifies cannot be built as written on
a soft-deletable model. `__tests__/commissioner-os/constraints.spec.ts` settles
this empirically — it is currently stated from documentation, not measured.

The likely resolution is neither of the two obvious ones: a single
`UPDATE … FROM (VALUES …)` swaps both rows in one statement, never produces an
intermediate duplicate, and therefore needs no deferral and keeps the partial
index. That path is also tested in the same spec.

## Still open

1. **`prisma/tenancy.prisma` contradicts itself on `TenantUser`** — the only
   relation without `onDelete: Cascade`, so a tenant purge hits `RESTRICT`,
   which the comment above it says the cascade exists to prevent. One word.
2. **The five `@default("allfantasy")` columns** — join the scheme or rename.
   T-103 forces the question; better to answer it deliberately.
3. **Root `CLAUDE.md`** — the Commissioner OS working context is parked at
   `docs/commissioner-os/CLAUDE.md` rather than overwriting AllFantasy's repo
   instructions. Merge, replace, or leave.
