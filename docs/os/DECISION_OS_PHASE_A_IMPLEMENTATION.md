# Decision OS Phase A — Implementation (in progress)

**Status: implementation BEGUN (freeze lifted by the user; OS is the sole focus).** Increments 1
(normalization seam) and 2 (idempotent persistence writer) are landed. Every claim below is
code-verified; nothing is fabricated, and no NFL-Redraft / Start-Draft / PR-#166 work is touched.

**Branch:** `g15-event-foundation` (where Decision OS lives) · **Date:** 2026-07-08.

---

## 1. The real pipeline (code-verified)

```
provider import (Sleeper, …)                     lib/league-import/**
  → raw provider activity
  → [normalizer: natural key + manager identity + honest degradation]   ← LANDED (this increment)
  → behavioral-input tables Decision OS reads:                          ← Do #3 (next)
       afLeagueTrade / redraftTradeProposal   (trades)
       waiverClaim                            (waivers)
       afRosterMoveHistory / redraftRosterMoveHistory / redraftRosterPlayer (roster moves)
       draftPick                              (draft)
  → behavioral pipeline (assemble facts → derive intelligence)   lib/decision-os/behavioral/**
       via realDataProvider (flag: DECISION_OS_INTELLIGENCE_API_PROVIDER=real, default → 503)
  → Manager / League / Platform intelligence
  → Commissioner OS surfaces (Mission Control, League Analytics, League Health, Manager Intelligence, Recommendations)
```

**The gap this phase closes (why "some surfaces show empty states"):** the behavioral pipeline reads
**seven** activity tables, but the Sleeper/dynasty import today writes **only `draftPick`**.
`afLeagueTrade`, `waiverClaim`, `afRosterMoveHistory`, and the redraft trade/roster-move tables are
**never populated for imported leagues** — so trade/waiver/roster intelligence is empty while draft
intelligence has data. Those tables are also AF-native (keyed on AF user ids), which is where the
**external-manager-identity blocker** bites: imported managers may have no AllFantasy account.

## 2. What was built this increment

**`lib/decision-os/ingestion/importedActivityNormalizer.ts`** — the pure, provider-agnostic seam
between import adapters and the behavioral-input tables. It is the foundation every table-population
step needs, and it is fully unit-testable without a live DB:

- **Idempotency (Do #2):** `deriveActivityNaturalKey(provider, leagueId, activityType, providerEventId)`
  is deterministic and collision-safe (delimiter-escaped). The write layer upserts by this key, so a
  re-run backfill **converges instead of duplicating**.
- **External-manager identity (Do #6):** `resolveManagerKey` **reuses the existing
  `ExternalIdentityMapping`** (`lib/league-import/mappers/ExternalIdentityMapper.ts`) — AF managers key
  by `af_id`, and managers **without an AF account** key by provider `stable_key`, so Commissioner OS
  can attribute activity for **all** managers in an imported league, flagged via `hasExternalOnlyManager`.
  No new identity system was introduced (avoids duplication).
- **Honest degradation (Do #8):** activity that can't be keyed (missing provider event id / timestamp)
  or attributed (no resolvable manager) is returned as a `skipped` record **with a reason** — never
  fabricated, never given a random id. Batch normalization partitions `normalized` vs `skipped` so
  ingestion can telemeter truthfully.
- **Provider-open (Do #7):** input is a provider-agnostic `RawImportedActivity`; any provider
  (Yahoo/ESPN/Fantrax/MFL/…) plugs in by emitting it.

**Test — `__tests__/decision-os/imported-activity-normalizer.test.ts` — 11/11 passing:** proves
deterministic idempotent keys (same event ⇒ same key across runs; duplicate replay ⇒ same key set),
AF-vs-external-only identity keying, honest degradation for all three skip reasons, and provider-openness.
(This is the unit-level half of Deliverable #2; the DB-level idempotency test lands with the write layer.)

## 2b. Increment 2 — idempotent activity persistence writer (landed)

Consumes the Increment-1 seam and persists it idempotently, keeping **pure transformation separate
from DB writes** via a port (the preferred shape):

- **`lib/decision-os/ingestion/importedActivityStore.ts`** — the provider-neutral persistence port
  (`ImportedActivityStore.upsertByNaturalKey`, idempotent by `naturalKey`), a `PersistedActivityRecord`
  shape, and an `InMemoryImportedActivityStore` reference implementation (idempotent by construction —
  doubles as the DB-adapter contract and the test double).
- **`lib/decision-os/ingestion/importedActivityWriter.ts`** — `writeImportedActivity(normalized[], store)`
  orchestrator: re-runnable, order-independent, returns an honest summary (created/updated/**skipped +
  reasons**, external-only-manager count, per-activity-type counts). No Prisma, no provider parsing.
- **`__tests__/decision-os/imported-activity-writer.test.ts` — 6/6 passing:** first write creates /
  re-write updates (count stable, no duplication); repeated ingestion incl. in-batch duplicates
  **converges to identical persisted state**; **external-only managers persist** (attributed via
  `stable_key`, no AF account); and a constrained store **surfaces skips honestly** (simulating the
  `afLeagueTrade` AppUser-FK constraint below) without fabricating rows.

### ⚠ Critical schema finding (reshapes Increment 3)

The seven pipeline-input tables are **AF-hosted-league tables coupled to AllFantasy accounts/entities**,
which the concrete Prisma adapter must contend with:

| Table | Idempotency key today | External-manager blocker |
| --- | --- | --- |
| `DraftPick` | ✅ `@@unique([sessionId, overall])` + already populated by import | needs `DraftSession` FK |
| `WaiverClaim` | ❌ none (uuid id only) | requires `rosterId` (Roster FK); `userId` is nullable ✅ |
| `AfRosterMoveHistory` | ❌ none (cuid id only) | requires `rosterId`; `actorUserId` nullable ✅ |
| `AfLeagueTrade` (+`AfLeagueTradeItem`) | ❌ none | **`proposedByUserId` is a REQUIRED `AppUser` FK** → an external-only manager **cannot** be written here without an AF account |

So even *with* a non-prod DB, external-league trades cannot land in `afLeagueTrade` as-is, and no table
except `DraftPick` can be upserted idempotently by `naturalKey` without a schema change. **Increment 3
must therefore add, via migration: a unique `externalSourceKey` (= `naturalKey`) column per target
table, and an external-manager-friendly path for trades** (either nullable `proposedByUserId` +
external-manager columns, or a dedicated imported-activity model the behavioral reader also consumes).
That migration + its verification require an approved non-prod DB.

## 2c. Increment 3 — dedicated imported-activity model + Prisma adapter + behavioral read (landed)

Implements the user's architecture decision: a **dedicated provider-neutral model** the behavioral
reader also consumes — `afLeagueTrade` untouched, **no AppUser accounts fabricated**.

- **Model + migration:** `DecisionOsImportedActivity` (`prisma/schema.prisma`, mapped to
  `decision_os_imported_activity`; migration `prisma/migrations/20260708000000_decision_os_imported_activity/`).
  Unique **`externalSourceKey`** = the normalizer's natural key (the idempotency constraint);
  provider / providerLeagueId / nullable `afLeagueId`; activityType; occurredAt; **manager identity
  as data, not FKs** (externalManagerId, stableExternalManagerKey, nullable appUserId/rosterId);
  `payload` (provider source) + `normalized` (Decision OS attribution: `managerKeys`,
  `hasExternalOnlyManager`). Deliberately no FK coupling to AF-native tables.
- **Prisma adapter:** `lib/decision-os/ingestion/prismaImportedActivityStore.ts` implements the
  Increment-2 `ImportedActivityStore` port against a **narrow injected delegate** (the shape of
  `prisma.decisionOsImportedActivity`) — type-checks + unit-tests without regenerating the client;
  never fabricates AF ids (`afLeagueId`/`appUserId`/`rosterId` stay null until real mapping exists).
- **Behavioral read (additive):** `lib/decision-os/behavioral/importedActivityToEvents.ts` converts
  rows → `BehavioralEvent[]` (`source: 'import'`, provenance-only provider identity, reduced
  completeness + `actorConfidence: 'inferred'` for external-only managers — honest). **Trade
  attribution keeps league counts correct:** proposer → `trade_created`, counterparties →
  `trade_accepted` (a 2-manager trade = 1 league trade, both managers attributed).
  `real-data-provider.ts` gains a `loadImportedActivityRows` dep merged additively in
  `loadAllLeagueEvents`; the default loader **degrades to `[]`** (try/catch + delegate-existence
  check) so AF-native behavior is untouched until the model is generated/migrated.
- **Tests:** `__tests__/decision-os/imported-activity-persistence.test.ts` — **7/7**: no duplicate
  rows on re-ingest (Prisma adapter over a fake delegate); external-only managers persist with
  `appUserId: null`; imported activity **appears in behavioral facts** (league trade count = 1 for a
  2-manager trade; external manager in `activeManagerIds`); **AF-native counts unchanged/additive**;
  honest skips (unknown type / no managers / bad timestamp). Full decision-os ingestion suite
  **24/24**; a wiring regression I introduced in `intelligence-api-provider-selection.test.ts` was
  found and fixed (default loader made fully defensive) — now **33/33**.
- **Real-DB idempotency proof (non-prod, per the DB decision):** ran the migration DDL on a
  **throwaway Neon project** (`decision-os-phaseA-verify`, isolated): first ingest → `inserted:
  true`; **re-ingest of the same natural key → same row id, `inserted: false` (UPDATE)**; final state
  exactly 1 trade row + 1 waiver row, both `appUserId = null`. Idempotency + external-only
  persistence proven on real Postgres. **No production or shared DB touched.**

**Skipped-by-design this increment:** `prisma generate` against a shared env (other sessions hold the
client), the Sleeper emitter (Increment 4), and AF-league/manager mapping enrichment (Increment 4).

## 3. What remains (the bulk — grounded next steps)

| # | Work | Notes / blocker |
| --- | --- | --- |
| Do #1/#3 | ~~DB-write layer~~ **Increment 2 landed the port + writer + fake-store tests.** Remaining = **concrete Prisma adapter** for `ImportedActivityStore` + the **schema migration** (unique `externalSourceKey`/`naturalKey` column per table; external-manager trade path — see §2b) | Needs an **approved non-prod DB** to apply the migration + run the DB-level idempotency test (Deliverable #2 full). I will not write speculative rows or fabricate AppUser accounts into a shared schema. |
| Do #1 | **Adapter emitters:** Sleeper `transaction`/draft → `RawImportedActivity` (trade/waiver/roster/draft) | Extend `lib/league-import/adapters/sleeper/**`; `ImportProvider` enum currently `sleeper/espn/yahoo/fantrax/mfl/fleaflicker` — **"The Replacements" must be added to it** (one-line, then an adapter). |
| Do #4 | **Repeatable snapshot-capture job** for league intelligence trends | Today snapshot capture is manual; needs a scheduled/idempotent path (Deliverable #3: trend-ready history test). |
| Do #5 | **Surface alignment:** re-point **League Health** off its separate `monitorLeagueHealth` onto the behavioral pipeline; consolidate **Recommendations**; **Mission Control + League Analytics do not exist** and must be built on the same outputs; enable `DECISION_OS_INTELLIGENCE_API_PROVIDER=real` per-league behind a parity gate | Deliverable #4: surface-consistency test. |

## 4. How this supports Commissioner OS licensing

Commissioner OS is meant to run on **external** platforms' leagues (The Replacements, Yahoo, ESPN, …).
That only works if imported activity becomes **real, idempotent, fully-attributed** Decision OS input —
which is exactly what this seam guarantees: a licensee can re-sync a league safely (idempotent keys),
and **every** manager shows activity, not just those with AllFantasy accounts (external identity). That
is the difference between a demo and a licensable per-league intelligence product.

## 5. What The Replacements demo can show — honestly

- **Today (this increment):** the ingestion seam is proven to turn real provider activity into stable,
  attributable, **non-fabricated** records — idempotent on re-sync, with all managers (AF or not) keyed.
- **After the next increment (DB wiring + Sleeper emitters):** imported Replacements/Sleeper trades,
  waivers, and roster moves populate the tables Decision OS reads → real trade/waiver/roster
  intelligence appears alongside draft intelligence, and the currently-empty surfaces fill in with
  **real** values. Until then, those surfaces continue to **honestly degrade** (empty, not faked).

## 6. Boundaries honored
- No fake/demo intelligence; honest degradation throughout.
- No NFL-Redraft beta, Start-Draft, PR-#166, AF-hosted-league, or DFS-OS work.
- Reused existing identity infrastructure instead of duplicating it.
