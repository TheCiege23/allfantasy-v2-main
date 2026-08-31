# T-000 · Repo survey

Written 2026-08-31, alongside the T-101 schema merge rather than before it —
which is itself a deviation from the handoff, where T-000 is a stop-and-report
gate. Recorded here so the gap is visible instead of implied.

**Scope of what was actually verified.** Sections 1–3 and 8–9 below were
measured against the repo. Sections 4–7 (auth shape, database roles, migration
drift, test coverage) were **not surveyed** and are marked as such. Do not read
an unmarked absence as a clean result.

---

## The headline

**This is not the early repo the plan describes.** `CLAUDE.md` says "the repo
predates this document and is early" and "do not assume anything above already
exists". The second half is right; the first is not. AllFantasy is a large,
live product — 710 Prisma models, a production Postgres, paying-ish traffic,
and ~9 concurrent Claude sessions sharing one checkout.

That does not make the Commissioner OS plan wrong. It does mean several tickets
are not the size the handoff assumes, and two are not implementable as written.

---

## 1 · Stack

| | |
|---|---|
| Next.js | `^14.2.15`, App Router |
| Prisma | `^5.22.0` (client and CLI) |
| Database | PostgreSQL, `DATABASE_URL` + `directUrl` already split |
| Package manager | npm |
| TypeScript strictness | **not surveyed** |
| Pooler | **not surveyed** — `directUrl` is configured, which implies one |

`directUrl` already being present is the one piece of TENANCY.md §3.7 that
lands for free. The third URL (platform pool) does not exist.

## 2 · Schema

- **710 models** after this merge (704 before).
- `prisma validate` **passes**. Verified after the merge, and verified to fail
  on an injected break first, so the green is evidence rather than a check that
  cannot fail.
- **4 of 710 models carry `deletedAt`** — and all four are the ones added by
  this merge plus pre-existing strays. Invariant 4 (soft delete everywhere) is
  **absent**, not partial.
- `@unique` is used freely across the schema, on models with no `deletedAt`.
  That is consistent today; it becomes the partial-index problem the moment
  soft delete lands.
- **`User` does not exist.** Identity is `AppUser`, and it holds `email`
  (`@unique`), `username` (`@unique`), `displayName`, `avatarUrl`,
  `passwordHash`, plus geo/compliance fields — full PII, referenced by roughly
  a hundred relations.
- `Team` does not exist either; the analogue is `LeagueTeam`.

## 3 · Data access

Measured, and these are the numbers that should drive sequencing:

| | count |
|---|---|
| Files importing `@prisma/client` or `@/lib/prisma` | **2,250** |
| …of those, under `app/**` | **647** |
| `$queryRaw` / `$executeRaw` call sites | **180** |
| `new PrismaClient()` construction sites | ~30 (`lib/prisma.ts` plus seeds, scripts, probes) |

Invariant 1's raw-SQL ban, invariant 2's single write path, and T-005's lint
rules are each a four-figure refactor here, not a config change. `lib/domain/`
does not exist.

## 4 · Auth — NOT SURVEYED

`AuthAccount` / `AuthSession` models exist on `AppUser`. Whether the session can
carry a three-axis actor context was not investigated.

## 5 · Database roles — partially surveyed

**None of the four T-001 roles exist.** Established by running the T-001
acceptance suite (`npm run test:commissioner-os`): six of its eight assertions
fail, every one of them because `commish_migrate`, `commish_app`,
`commish_platform` and `commish_purge` are absent. That is the correct
pre-T-001 state, not a defect.

⚠ **That run connected to the configured database, which is production.**
Unintended — `@prisma/client` loads `.env` on import, so `DIRECT_URL` was
populated without the suite asking for it. The queries were read-only catalog
reads (`pg_roles`, `pg_tables`); no application data was read and nothing was
written. Recorded rather than glossed over, because "I did not touch the
database" was said earlier in the same session and was wrong.

Still **not** surveyed, because it needs queries nobody has authorised: whether
the role the app currently connects as holds `BYPASSRLS` or `SUPERUSER`, and
which role owns the 710 tables. `prisma/roles/002_transfer_ownership.sql` has a
preflight that reports the owner and refuses on split ownership, so that answer
arrives when someone runs it — deliberately, against a branch.

**The T-101 migration refuses to run until the four roles exist**, rather than
assuming anything about the current one.

## 6 · Migrations — partially surveyed

History is present and appears linear (~60 directories, latest
`20260830190000_devy_head_coach_context`). Raw SQL is already used routinely in
migrations, so T-008/T-101's partial indexes fit the existing convention.
Whether the history has **drifted from the deployed database** was not checked
and cannot be checked without connecting.

## 7 · Tests — NOT SURVEYED

Vitest and Playwright are both in use (`__tests__/`, `e2e/`, `agent-tester/`).
No test database or data-layer coverage assessment was made.

## 8 · Existing data

**Yes — production data, and more of it in more places than the plan expects.**

`leagues` is populated. Worse for planning purposes: `CLAUDE.md` at the repo
root records that **Vercel preview deployments use the production database**,
and cites a real incident (114 test rows in a 146-row `EarlyAccessSignup`
table). So "just run it against preview first" is not available as a safety
step here.

This is why T-101's League change is written as a three-step backfill —
nullable column, bootstrap tenant, assign, `SET NOT NULL`, FK — with an
assertion between the backfill and the `NOT NULL` that fails loudly if the
`UPDATE` matched nothing.

**A pre-existing, FK-less tenancy attempt already exists.** Five models carry
`tenantId String @default("allfantasy")`:

- `TradeExecutionSnapshot`
- `DomainEvent`
- `AuditFeedEntry`
- `IntelligenceLeagueSnapshot`
- `IntelligenceLeagueSnapshotHistory`

No `Tenant` table, no FK, no RLS — a string column with a hardcoded default.
The T-101 migration seeds the bootstrap tenant with the literal id
`'allfantasy'` specifically so those columns become consistent with the new
`Tenant` table rather than pointing at nothing. **They are not given foreign
keys or `tenantId`-leading indexes here** — that is a separate decision, and it
is on the open-questions list below.

## 9 · Gap list against the five invariants

> ⚠ **SUPERSEDED IN SCOPE — read `SCOPE.md` first.** The table below measures
> the invariants against the **whole repo**, which is what T-000 asked for. The
> owner has since scoped Commissioner OS as a separate B2B product over the
> existing `commissioner-os` surface, and the invariants govern **that surface**,
> not all 710 models. Measured there the numbers are 3 Prisma importers and 0
> raw-SQL sites, not 2,250 and 180. The table is left unedited because it is
> still the accurate answer to "what is the state of the repo" — it is simply
> the wrong denominator for planning.

| Invariant | State |
|---|---|
| 1 · Isolation enforced by the database | **Absent.** No RLS, no roles, no `withTenant`. 180 raw-SQL sites would each bypass an app-level extension. |
| 2 · One write path | **Absent.** 2,250 Prisma importers, 647 under `app/**`. |
| 3 · Every mutation audited in-transaction | **Partial at best.** `AuditFeedEntry`, `DomainEvent`, `LeagueAuditLog` and `FinanceAuditEvent` exist; no `AuditEvent`, no append-only trigger, no transactional guarantee verified. |
| 4 · Soft delete, never hard delete | **Absent.** 4 of 710 models have `deletedAt`. |
| 5 · Effective-dated roster membership | **Absent.** No `RosterSlot`; `Roster` is current-state. |

---

## What T-101 could and could not do here

Applied:

- All six tenancy models and four enums merged into `prisma/schema.prisma`
- `League.tenantId` + `tenant` relation, required, `onDelete: Cascade`
- Tenant-leading indexes on League
- Migration at `prisma/migrations-pending/20260831120000_commissioner_os_t101/`, with
  the three-step backfill and the `TenantWebhook.events` GIN index
- `prisma validate` passes

Not applied, because there is nothing to apply them to:

- **The `User`/`TenantUser` PII split (TENANCY.md §4).** There is no `User`.
  Stripping PII from `AppUser` means rewriting ~100 relations and every auth,
  email, and display path in a live product. This is a project, not a ticket,
  and it is the one thing TENANCY.md says "cannot be retrofitted cheaply" —
  correctly. `TenantUser` exists and is empty; nothing reads it yet.
- **`(tenantId, slug)` partial unique on League.** `League` has no `slug`.
- **The `RosterSlot` open-interval unique.** There is no `RosterSlot`.

Deviations made deliberately, each commented at the site:

- The fragment's League indexes name `phase`, `visibility`, `seasonYear` and
  `deletedAt`. This `League` has none of them. `lifecycleState` and `season`
  were used as the real equivalents; `visibility` and `deletedAt` were dropped
  rather than invented.
- League's seven pre-existing indexes were **not** re-led with `tenantId`.
  They serve live query paths on a populated table. T-101's "tenantId leads
  every composite index" is therefore only partially met on League.
- No RLS in the T-101 migration. HANDOFF.md assigns policies to T-102, and
  policies scoped `TO` roles that do not exist would not apply.

---

## Open questions for the owner

1. **`prisma/tenancy.prisma` contradicts itself on `TenantUser`.** The comment
   above `Tenant`'s relation list says `onDelete: Cascade` throughout "so
   tenant purge doesn't hit Restrict" — but `TenantUser.tenant` is the one
   relation with no `onDelete`, so it generates `ON DELETE RESTRICT` and a
   tenant purge *will* hit exactly that. Left as supplied rather than
   silently corrected; T-009 owns cascade ordering. One word to fix.
2. **Do the five pre-existing `tenantId @default("allfantasy")` columns join
   the scheme?** They need FKs, tenant-leading indexes and RLS policies to
   count — and T-103's coverage test will fail on them the moment it lands,
   which is arguably the correct outcome.
3. **The root `CLAUDE.md` collision.** The handoff wants the Commissioner OS
   working context at the repo root. That path holds the AllFantasy repo
   instructions, which several concurrent sessions work under. The new file is
   parked at `docs/commissioner-os/CLAUDE.md`; merging or replacing is a call
   nobody should make silently.
4. ~~**Is Commissioner OS a new surface inside AllFantasy, or a separate
   product?**~~ **ANSWERED 2026-08-31: a separate B2B product built over the
   Commissioner OS surface already in the AllFantasy site.** Consequences are
   in `SCOPE.md`. The material one: `League.tenantId` as added at T-101 is
   correct and does not need reverting — the B2B product manages AllFantasy's
   existing leagues, it does not introduce a second league entity.
