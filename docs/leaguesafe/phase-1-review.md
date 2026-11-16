# LeagueSafe Phase 1 — data models and tests

Status: prepared for owner review. **No production migration or deployment has been run.**
The owner authorized Phase 1 models and tests only. Apps Script capture remains manual,
the automatic trigger stays disabled, and Phase 2 has not started. The approved Phase 0
record remains in the private Phase 0 review branch; original financial emails stay private.

## Models

- **LeagueSafeConnection**: one connection per AF `League` row (which already identifies
  a season), the exact bot address including any Gmail plus tag, LS league name,
  pending/active/stale/disconnected status, last-email time, creator, timestamps,
  currency, base dues assessment, and optional due date. Defaults to `pending_invite`;
  creating a row does not prove that an invitation arrived. Shared inbox addresses and
  duplicate LS league names are allowed; names alone are not unique routing identities.
- **LeagueSafeMember**: LS display name, optional email, optional AF `LeagueTeam` mapping,
  nullable match method, commissioner-confirmation flag, and optional dues assessment
  override. Unmatched members are valid and can have ledger entries before team assignment.
  A zero override means zero dues. Names/emails are not forced unique: the same payer may
  be represented in different connections, and matching is a later phase.
- **DuesLedgerEntry**: connection/member, event type, integer cents, occurrence time,
  source type, optional raw-email reference, globally unique required dedupe key,
  optional creator for automated email entries, notes, and creation time. There is no
  stored per-team paid/unpaid flag. The new ledger does not write existing `LeagueDues`,
  `LeagueFinance`, payout-request, Stripe, or treasury records.
- **AppUser.leaguesafeEmail**: optional secondary matching hint. Existing accounts remain
  null. No profile editor, verification email, ownership claim, or matching is implemented.
- **LeagueSafeRawEmail.leagueConnectionId**: the existing nullable field now has a real
  connection relation. Existing null assignments remain null; Phase 0 ingestion neither
  routes emails nor creates connections, members, or ledger entries.

Composite foreign keys enforce that a mapped team belongs to the connection's AF league,
and that ledger members and source emails belong to that same connection. A source email
must first be explicitly assigned to that connection. Referenced connections, teams,
users, and source emails cannot be deleted/rekeyed in ways that would break these references.
Future deletion/purge workflows need an explicit financial-history retention decision.

## Ledger arithmetic

`lib/leaguesafe/dues-ledger.ts` is a pure calculation over an explicitly supplied single
member's entries. It performs no database access, matching, routing, parsing, or writes.

| Type | Meaning of amountCents | Effect on dues |
| --- | --- | --- |
| payment | Positive receipt | Increases paid credit |
| refund | Positive refund magnitude | Reduces paid credit |
| late_fee | Positive charge | Increases assessed dues |
| payout | Positive completed payout magnitude | Tracked separately; does not undo dues paid |
| adjustment | Nonzero signed correction | Positive credits paid balance; negative debits it |

All inputs use integer cents, never floating-point currency. Input amounts fit PostgreSQL
`INTEGER`; aggregate totals must stay within JavaScript's safe-integer range. Negative
net paid balances remain visible after excess refunds; overpayment credit is returned
separately. Status is derived as paid/partial/unpaid/overdue using the assessment, entries,
and an explicit `asOf` time; the deadline becomes overdue strictly after its instant.

A payout-structure update, allocation proposal, vote, or approval is not a completed
payout ledger event. No parser or writer interpreting any of these notifications is added.
Caller authorization, email eligibility, identity confirmation, same-event business dedupe
construction, reconciliation, and audited reassignment are responsibilities of later phases.

## Migration

`prisma/migrations/20261116030000_leaguesafe_phase1_models/migration.sql` is additive:

- Four new enums, three new tables, the nullable user field, indexes, and foreign keys.
- SQL checks reject negative assessments, zero or incorrectly signed entries, missing
  email provenance, manual/screenshot entries without an actor, empty dedupe keys,
  invalid bot addresses, and confirmed mappings without a team and match method.
- The bot-address check accepts only the confirmed Gmail inbox or a plus tag of 1–32
  lowercase letters/digits/hyphens starting with a letter/digit. Delivery to plus aliases
  is not tested or enabled by this migration.
- No data backfill, raw-message rewrite, initial ledger entries, paid-status synchronization,
  capture-policy change, environment-variable change, or scheduled task.

Before a future production deployment, confirm no existing nonnull
`LeagueSafeRawEmail.leagueConnectionId` values are dangling, review the additional indexes
on `league_teams` and raw email, and apply only through the repository's guarded migration
workflow. Migration files use LF bytes. Do not use `db push` as a substitute: the accounting
checks live in SQL because Prisma's schema DSL cannot represent them.

The migration was generated offline from the exact current-main base schema. Validation
uses a dedicated local PostgreSQL 18 database with synthetic records, not Neon production.
The default database suite skips unless explicitly opted in; it never reads DATABASE_URL,
DIRECT_URL, or .env for its connection. It refuses remote hosts, non-test database names,
unexpected roles, and URL query overrides. Each run uses an isolated schema and rolls back.

```powershell
$env:LS_PHASE1_TEST_DATABASE_URL = 'postgresql://af_phase1_test@127.0.0.1:55481/af_leaguesafe_phase1_test'
node node_modules/vitest/vitest.mjs run __tests__/leaguesafe-dues-ledger.test.ts __tests__/leaguesafe-phase1-db.test.ts --pool=threads --maxWorkers=1
```

The local test database/server must be provisioned separately; the tests do not start a
server, create a remote resource, or change the existing database safety setup.

## Validation and review checkpoint

- Prisma schema validation and isolated client generation passed using installed Prisma 5.22.
- All **153** LeagueSafe tests passed across the seven capture/security, viewer,
  arithmetic, and database suites. The database suite applied the exact Phase 0 capture
  migration and the Phase 1 upgrade to synthetic existing captures, then tested constraints
  against PostgreSQL itself, including denied cross-league links and duplicate ledger keys.
- Full-schema rehearsal passed: the complete **903,224-byte** DDL generated from base
  **df8d1d524** was created in a temporary local schema, a synthetic preexisting capture
  was inserted, and the exact Phase 1 migration was applied. The isolated generated
  Prisma client created and read back the real Tenant/AppUser/League/LeagueTeam parents
  and all new models with their member/team/connection/source-email relations.
- The full-schema rehearsal initially exhausted the disposable server's default lock
  budget during cleanup. Increasing only that local cluster's lock budget and repeating
  the complete rehearsal passed, including cleanup. No production setting was changed.
- ESLint passed for all three new TypeScript files. A scoped strict TypeScript check
  passed with all three files explicitly confirmed in the compiler input set. The
  already-declared `@types/pg` package was absent from shared node_modules, so that check
  used an isolated temporary installation of the declared version; no package/lockfile
  or shared dependency tree was changed. A whole-repository typecheck/build was not run.
- Prisma validation passed, and the new migration contains LF bytes only. Production
  deployment and migration validation against a Neon preview remain future rollout checks.

No new environment variables are required by the feature. `LS_PHASE1_TEST_DATABASE_URL`
is test-only and must never be set on Railway. No Apps Script action is needed. The owner
must review the models, ledger semantics, deletion restrictions, and migration before
production rollout. Stop at this checkpoint; Phase 2 requires a separate go-ahead.


## Files for review

- `prisma/schema.prisma`
- `prisma/migrations/20261116030000_leaguesafe_phase1_models/migration.sql`
- `lib/leaguesafe/dues-ledger.ts`
- `__tests__/leaguesafe-dues-ledger.test.ts`
- `__tests__/leaguesafe-phase1-db.test.ts`
- `docs/leaguesafe/phase-1-review.md`

The Phase 0 capture endpoint, Apps Script, Gmail labels, production records, and parser
files were not changed. No private EML sample or financial email content is in this patch.
The local branch is `codex/leaguesafe-phase1-models`; these changes await owner review.
