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

Of the seven, `t101b` below is still parked. The three added 2026-09-02 are in
three DIFFERENT states, and an earlier version of this paragraph lumped two of
them together as "verified against production 2026-09-04 as never applied
anywhere" — which was wrong about one of them. Re-measured 2026-09-04:

| added 2026-09-02 | on production | `_prisma_migrations` row | `migration.sql` on `main` |
|---|---|---|---|
| `draft_fact_metadata` | ✅ **column IS live** | ❌ absent — see *A THIRD CASE* | ❌ **branch only** |
| `fact_table_uniqueness` | ❌ nothing applied | ❌ absent | ❌ branch only |
| `yahoo_connection_identity` | ✅ all six statements | ✅ recorded 2026-09-04 16:22:59Z | ✅ |

🛑 **Read the first row across.** A schema change is live in production whose SQL
exists only on `commish-os/phase-0-1b` (`d65c84c7a`, never merged). Auditing the
schema from `main` cannot explain where `dw_draft_facts.metadata` came from.

`yahoo_connection_identity` is recorded by hand with the real `sha256` of its
`migration.sql` (`4b82763b…`), so a later `migrate deploy` matches and skips.
Its directory deliberately stays here rather than moving to `prisma/migrations/`,
per the note on that migration below. Everything else in this directory has been
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

Verified on production by effect: 7 recorded, **no P3009 landmine**, 9 tables with
RLS, 27 policies, the audit trigger present, 5 `app.*` functions, and `leagues`
still readable at 116 rows.

⚠ **`finished_at IS NULL` ALONE IS NOT THE P3009 PREDICATE, and this paragraph
used to say it was.** Production carries **5** rows with `finished_at IS NULL`
(failures from May and 30 August) and has done throughout — but every one also has
`rolled_back_at` SET, which is how a failed migration is marked resolved. P3009
fires on `finished_at IS NULL **AND** rolled_back_at IS NULL`, and that count is
**0**. Anyone re-running this check with the shorter predicate gets 5 and reports a
landmine that is not there; that mistake was made on 2026-09-04 and caught only by
reading the rows instead of counting them.

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

## ⚠ A THIRD CASE: applied to production, but NOT through Prisma

### `20260901220000_domain_os_facts`

**Applied to production 2026-09-01 by the owner, as raw SQL in a console.** So it
is neither "pending approval" nor recorded in `_prisma_migrations` — it is a
**backfill of the migration history** for a table that already exists.

The distinction matters on the next `migrate deploy`:

| | seven Commissioner OS migrations | this one |
|---|---|---|
| applied via | `prisma migrate` | raw SQL |
| `_prisma_migrations` row | ✅ present, real sha256 | ❌ **absent** |
| next `migrate deploy` | matches and **skips** | **RUNS it** |

That is safe only because every statement in it is `IF NOT EXISTS`: the run is a
no-op that succeeds and finally writes the missing `_prisma_migrations` row.
**Self-healing by construction — and it is the guards, not luck, that make it so.**
Without them the first `migrate deploy` against production fails, writes a
`finished_at IS NULL` row, and every later migration aborts with P3009 until
someone resolves it by hand — the exact failure this directory exists to prevent.

🛑 **Why it was ever needed.** `model DomainOsFacts` went into `schema.prisma`
with `f539b4016` (#580) and no migration. Reads degraded correctly to live
derivation, so nothing looked broken — but **writes threw P2021, were swallowed
twice, and `/api/cron/domain-os-refresh` reported `written: N` every 30 minutes
for rows it never wrote.** The Prisma *delegate* exists whenever the model is in
the schema, so the `if (!delegate)` guard never fired. Fixed on the code side in
the same change that staged this file (`OsStore.write` now returns `boolean`;
`refresh` reports `'write_failed'`), and that fix is **required independently** —
creating the table fixes today, not the next drift.

### `20260902000000_draft_fact_metadata`

🛑 **THE COLUMN IS ON PRODUCTION. THE MIGRATION FILE IS NOT ON `main`.** Both
halves are measured, and together they are the reason this section exists.

`dw_draft_facts.metadata JSONB` is live on production with no `_prisma_migrations`
row — the same case as `domain_os_facts` above. But `d65c84c7a`, the only commit
that has ever contained this `migration.sql`, is on branch
`commish-os/phase-0-1b` and **has never landed on `main`** (`merge-base
--is-ancestor` rc=1; no patch-id match in main's last 80 commits). So
`prisma/migrations-pending/20260902000000_draft_fact_metadata/` does not exist in a
fresh clone, and the schema change that IS in production came from SQL that is not
in the mainline history.

⚠ **That ordering is the thing to notice.** A migration parked here is meant to be
reviewable-but-unreachable. This one became unreviewable-and-applied: the file sits
on one branch, the column sits in production, and `main` records neither. Anyone
auditing the schema from `main` cannot see where that column came from.

Evidence, since the line this replaces also claimed a verification:

- `pg_attribute` on production puts `metadata jsonb` at **ordinal 10**, immediately
  after `createdAt` at 9. The `20260407024117_init` `CREATE TABLE` ends at
  `createdAt`, so this column was appended by an `ALTER`, not created with the table.
- The only `ALTER` in the repo that adds it is this file.
- Absent on the test branch (`ep-muddy-leaf`), present on production
  (`ep-curly-block`) — the same query in the same run, so the lookup discriminates.
- 132,325 rows, **0 with `metadata` populated**, which matches the writer change
  not having shipped.

⚠ **Two consequences.** A future `migrate deploy` **RUNS** this file rather than
skipping it; that is safe because the statement is `ADD COLUMN IF NOT EXISTS`, so
the run is a no-op that finally writes the missing row — self-healing, exactly like
`domain_os_facts`. And `schema.prisma`'s `model DraftFact` still does not declare
`metadata`, so the README's own stated order — apply, then update `schema.prisma`,
then ship writers — is stopped at step one.

**Why the column is wanted at all:** `SleeperHistoricalDraftSyncService` already
fetches `/v1/draft/{id}/traded_picks` for every draft it walks, `console.info`s the
count and throws the answer away, with a comment saying why — "DraftFact schema has
no metadata column today". The request is already paid for and the data is already
in memory. Draft-day pick trades are the one dynasty asset AllFantasy cannot see:
`future_draft_picks` holds picks traded BETWEEN drafts, and nothing holds picks that
changed hands DURING one.

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

### `20260902010000_fact_table_uniqueness`

🛑 **NEVER APPLIED ANYWHERE — confirmed, not assumed. AND THIS FILE IS NOT ON
`main` EITHER.** Re-measured on production 2026-09-04: both discriminator columns
absent (`dw_draft_facts.sourceDraftId`, `dw_transaction_facts.sourceTransactionId`),
all three indexes absent (`dw_matchup_facts_natural_key`,
`dw_draft_facts_source_pick_key`, `dw_transaction_facts_source_key`), no
`_prisma_migrations` row. Same on test.

Like `draft_fact_metadata` above, its `migration.sql` exists only in `d65c84c7a` on
branch `commish-os/phase-0-1b` and is absent from `main` and from a fresh clone.
Unlike that one, nothing from it has been applied, so file and database agree —
this is the state the parking convention is supposed to produce.

> This section and the `draft_fact_metadata` one were **deleted from this file** by
> the rewrite that added `weekly_matchup_roster_id_text`, leaving one line that made
> a false claim about both. Restored 2026-09-04. They are documented here even
> though their directories are not on `main`, because the README is the ledger of
> what is applied WHERE — and for `draft_fact_metadata` the answer is "production,
> from a branch", which is exactly the case a reader must not have to discover
> themselves.

Gives the three warehouse fact tables the uniqueness they have never had.
`dw_draft_facts`, `dw_transaction_facts` and `dw_matchup_facts` are written as
`deleteMany` then `create` with no unique key, so two concurrent runs duplicate
every row and a crash between the two steps leaves a league with nothing.
`dw_season_standing_facts` already has a natural key and uses `upsert` — it is
the worked example the other three should match.

⚠ **It is not the one-line change the finding implied, and the reason is worth
reading before applying.** Two of the three tables have no natural key to put a
constraint on:

* `dw_draft_facts` — the writer dedupes in memory on `sourceDraftId` and then
  **strips that column before persisting**, because none exists. A key without
  it is not merely weaker but wrong: a league with a startup *and* a rookie
  draft in one season has two legitimate rows at the same
  `(leagueId, season, round, pickNumber)`.
* `dw_transaction_facts` — has no source transaction id at all, so a duplicate
  is indistinguishable from a manager adding the same player twice in different
  weeks.

So it adds the missing discriminator columns first, and their indexes are
**partial** (`WHERE … IS NOT NULL`). Legacy rows are never touched — the ids
cannot be backfilled because they were never stored — and only rows written
after the writers populate them are protected. The constraint is therefore inert
until that writer change ships, which is the safe order.

⚠ **One statement removes data**: the `dw_matchup_facts` dedupe, which is the
only table with a complete natural key. Run the counting query in the migration's
header first — zero means the dedupe is a no-op, and a large number is itself the
evidence for the defect.

⚠ **`schema.prisma` is deliberately NOT updated by this file.** Adding these
columns there makes the generated client include them in its DEFAULT SELECT for
every read of those models; against a database that lacks them that is P2022 on
`findMany`, not confined to code that wants the new fields. The order is: apply,
then update `schema.prisma`, then ship writers.

### `20260903222531_weekly_matchup_roster_id_text`

✅ **APPLIED TO PRODUCTION 2026-09-03.** `WeeklyMatchup.rosterId Int` → `String`.
One statement: `ALTER COLUMN "rosterId" TYPE TEXT USING "rosterId"::text` —
lossless, every existing Int becomes its exact text form. Verified before (44,538
rows, 0 nulls) and after (44,538 rows, 0 nulls, 0 non-numeric values, all four
indexes including the `leagueId/seasonYear/week/rosterId` unique constraint
intact) via direct query against production.

**Why.** MFL franchise ids are zero-padded strings ("0001"). Stored verbatim as
`LeagueTeam.externalId`, they lose their leading zeros the moment they pass through
this `Int` column — `Number('0001')` is `1`, `String(1)` is `"1"`, which never
matches "0001" again. This is why MFL has no `WeeklyMatchup` writer at all; see
`lib/fantasy-os/sync/collector/index.ts`'s own note. Four readers
(`lib/core-app/leagueScoreboard.ts`, `allPlay.ts`, `dash3aPanels.ts`, `leagueHome.ts`)
were already patched around the *symptom* via `lib/core-app/rosterIdMatch.ts`
(`buildRosterIdMap`/`rosterIdsMatch`, a numeric-normalized-alias map) — that fix
stands regardless of this migration and does not need reverting. This migration
removes the *cause*.

🛑 **`schema.prisma` is not updated by the SQL file itself** — it is a separate,
committed code change (writers + every reader across `lib/core-app`, `lib/ai/sim`,
`lib/rankings-engine`, `lib/season-forecast`, `lib/today-actions-engine`, plus
tests) landing through the normal review/batch process, not this file.

✅ **MEASURED, NOT ASSUMED — the sequencing question, resolved by testing rather
than by argument.** An earlier version of this entry required the SQL and the
code to land "together, in one change, on explicit instruction to apply,"
reasoning that applying the SQL alone would leave the (still-Int-typed) deployed
client "expecting Int against a TEXT column (read-side breakage)." That was never
tested, and it is wrong. Two real Prisma clients were pointed at two real Neon
branches to check both directions directly:

- **currently-deployed (Int-typed) client → a branch already migrated to Text**:
  `findMany` succeeds, silently coercing `"1"` back to JS number `1`. `create`
  succeeds, writing a JS number in and getting it stored as text. No error either
  direction.
- **the new (String-typed) client → a branch still on Int**: `findMany` fails
  (`P2032`: "expected non-nullable type String, found incompatible value of
  '1'"). `create` fails (Postgres wire-protocol error). Hard failure, both
  directions.

The reason it is one-directional: Postgres permits an implicit `int → text` cast
in assignment context (a write, or a plain column read) but refuses
`text = integer` in comparison context. Because of that asymmetry, this was
independently re-verified rather than taken on the two-test result alone: every
deployed `WeeklyMatchup` query was censused and confirmed to use `rosterId` only
via `select` or `create`/`createMany` — never in a `where` filter, and there is
no upsert or compound-key lookup on it anywhere — so the comparison-context
failure mode does not exist on code that is actually live.

**Conclusion:** applying this SQL alone, ahead of the schema.prisma + code
change, is safe against currently-deployed code and was the order actually used.
The reverse order — code first — is the dangerous one: total, immediate failure
of every `WeeklyMatchup` read and write until the SQL catches up. The two do not
need to land in the same deploy window.

⚠ **This safety is specific to today's actual data and today's actual queries,
not a general rule about Int→Text migrations.** No MFL writer exists yet, so
nothing is writing a zero-padded `rosterId` under the old (Int-typed) client. A
future change that adds a `where`/upsert on `rosterId`, or a writer producing a
non-plain-digit value, would need this re-checked, not assumed to still hold.
* `dw_draft_facts` — the writer dedupes in memory on `sourceDraftId` and then
  **strips that column before persisting**, because none exists. A key without
  it is not merely weaker but wrong: a league with a startup *and* a rookie
  draft in one season has two legitimate rows at the same
  `(leagueId, season, round, pickNumber)`.
* `dw_transaction_facts` — has no source transaction id at all, so a duplicate
  is indistinguishable from a manager adding the same player twice in different
  weeks.

So it adds the missing discriminator columns first, and their indexes are
**partial** (`WHERE … IS NOT NULL`). Legacy rows are never touched — the ids
cannot be backfilled because they were never stored — and only rows written
after the writers populate them are protected. The constraint is therefore inert
until that writer change ships, which is the safe order.

⚠ **One statement removes data**: the `dw_matchup_facts` dedupe, which is the
only table with a complete natural key. Run the counting query in the migration's
header first — zero means the dedupe is a no-op, and a large number is itself the
evidence for the defect.

⚠ **`schema.prisma` is deliberately NOT updated by either file.** Adding these
columns there makes the generated client include them in its DEFAULT SELECT for
every read of those models; against a database that lacks them that is P2022 on
`findMany`, not confined to code that wants the new fields. The order is: apply,
then update `schema.prisma`, then ship writers.

### `20260902020000_yahoo_connection_identity`

✅ **APPLIED TO PRODUCTION 2026-09-04 16:22:59Z, and recorded.** This section said
"PARKED. NEVER APPLIED ANYWHERE" while the paragraph at the top of this file said
the opposite — the header was updated and the body was not. Verified by effect on
production, not by the record: all three token columns read `is_nullable=YES`,
`userId` exists, `YahooConnection_userId_key` exists, and
`YahooConnection_userId_fkey` exists. It is the most recent row in
`_prisma_migrations` (169 rows).

🛑 **`schema.prisma` HAS NOT CAUGHT UP, AND THAT IS THE LIVE RISK.** The model still
declares `accessToken`/`refreshToken` as `String` and `tokenExpiresAt` as
`DateTime` — all required — and has no `userId` field at all. Production has all
four changes. `migrate deploy` does not drift-check so deploys are unaffected, but
**`prisma migrate dev` or `prisma db push` will read the database as drifted and
offer to restore `NOT NULL` and drop `userId`** — undoing a deliberate change. This
is harmless only while `YahooConnection` holds 0 rows, which it does today. The
order this file states elsewhere — apply, then `schema.prisma`, then writers — is
stopped at step one.

Demotes `YahooConnection` from a rival CREDENTIAL store to an identity record:
its three token columns become nullable, and it gains the `userId` link to
`app_users` it has never had. No `DELETE`, no `DROP` — six idempotent statements.

**Why there are two stores and only one of them can ever be written.** Yahoo has
exactly one registered redirect URI, `https://www.allfantasy.ai/api/league/yahoo/callback`,
and both entry points now resolve through `getYahooRedirectUri` — so every flow
lands on that one callback, which writes `league_auths`. `/api/auth/yahoo/callback`
therefore never executes, and it is the sole writer of `YahooConnection` and the
sole setter of the two cookies `/api/yahoo/leagues` requires. Production counts
agree: `YahooLeague` 0, `YahooConnection` 0, `league_auths` yahoo row 1.

⚠ **The obvious fix is the wrong one.** Having the live callback write BOTH stores
puts two copies of a *rotating* credential in play, each with its own refresh path
(`YahooLeagueFetchService` → `league_auths`, `/api/yahoo/leagues` → `YahooConnection`).
Yahoo rotates the refresh token on use, so whichever refreshed first would kill the
other copy, and `clearDeadYahooCredentials` would then correctly wipe it and force a
reconnect — breaking the one Yahoo path that works today to revive one that does not.

⚠ **No backfill is possible, which is why `userId` is nullable.** Nothing maps
`yahooUserId` to `app_users.id`; the only link that ever existed was a browser
cookie. Postgres allows many NULLs under a unique index, so one-connection-per-user
is still enforced for every row that has one.

⚠ **The columns are relaxed, not dropped.** Production holds 0 rows but a developer
database may hold real ones, and `DROP COLUMN` is irreversible. Relaxing achieves
the goal at no cost.

**The follow-up is a separate change and the ORDER matters**: the reachable callback
must be able to write the row before any reader depends on it. Pointing
`/api/yahoo/leagues` at a table nothing populates is the `ingestCFBDStats` failure —
worse than the live call it replaces, because it fails silently and looks correct.
