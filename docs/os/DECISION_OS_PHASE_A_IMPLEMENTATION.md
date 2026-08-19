# Decision OS Phase A — Implementation (in progress)

**Status: implementation BEGUN (freeze lifted by the user; OS is the sole focus).** Increments 1
(normalization seam), 2 (idempotent persistence writer), 3 (dedicated imported-activity model +
Prisma adapter + additive behavioral read), 4 (Sleeper emitter + end-to-end ingestion), and 5
(scheduled snapshot capture + trend history) are landed. Every claim below is code-verified; nothing
is fabricated, and no NFL-Redraft / Start-Draft / PR-#166 / Mission Control / UI work is touched.

**Branch:** `g15-event-foundation` (where this was built) · **Date:** 2026-07-08.

**PR: [#183](https://github.com/TheCiege23/allfantasy-v2-main/pull/183) — DRAFT, do not merge.** The
5 increments (`ce11b14ae`→`f8db831dd`→`bf255e5a1`→`621f649e8`→`1fde03a7a` on g15) were cherry-picked
onto a clean, isolated branch (`decision-os-phase-a`) off fresh `origin/main` — the Decision OS
behavioral pipeline this work depends on (`assemble.ts`, `real-data-provider.ts`, event
types/taxonomy, `ExternalIdentityMapper`, the Sleeper adapter types) is already on `main`, so a
genuinely clean 21-file PR was possible (no foundation-publication problem this time). One
merge-conflict during isolation (`prisma/schema.prisma`) was resolved by keeping `main`'s content and
appending only this workstream's own model — deliberately **excluding** `ReplayImport`/
`ReplayBacktestResult`, which are foreign, parked Replay Framework schema that happened to sit
adjacent in g15's file. Verified on the isolated branch: 78/78 tests, zero typecheck errors in any
touched file (main's own 3165 baseline errors are pre-existing/unrelated).

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
client), the Sleeper emitter (landed in Increment 4 below), and AF-league/manager mapping enrichment
(still open — see §3).

## 2d. Increment 4 — Sleeper emitter + end-to-end ingestion (landed)

Wires **real Sleeper API shapes** (the same `SleeperTransactionRaw` / `SleeperDraftPickRaw` /
`SleeperRosterRaw` types the production Sleeper adapter already uses) into the Increment 1–3
pipeline, provider-specific parsing kept strictly separate from the provider-neutral seam.

- **`lib/decision-os/ingestion/sleeperActivityEmitter.ts`:**
  - `buildRosterOwnerMap` — `roster_id → Sleeper owner user_id`, mirroring the exact convention the
    production `SleeperRosterMapper` uses (trimmed `owner_id`, `null` for an orphan roster — never
    fabricated).
  - `emitSleeperTransactionActivity` — maps `type: 'trade'|'waiver'|'free_agent'` → `trade`/`waiver`/
    `roster_move`; **skips (with a reason) any other transaction type, and any non-`'complete'`
    status** (pending/vetoed transactions are never treated as having happened).
  - `emitSleeperDraftPickActivity` — keys a pick by `${draft_id ?? season}:${pick_no}` (pick_no alone
    repeats across drafts/seasons); **skips picks with neither `draft_id` nor `season`** as
    ambiguous. **`occurredAt` is supplied by the caller or left `null` — never invented** (Sleeper's
    per-pick payload carries no per-pick timestamp); a `null` flows to the normalizer, which skips it
    honestly (`MISSING_OCCURRED_AT`).
  - `ingestSleeperImportedActivity` — the single entry point: emitter → `normalizeImportedActivityBatch`
    → `writeImportedActivity` → `ImportedActivityStore`. This is what a Sleeper backfill/sync job calls.
- **Three independent honest-degradation layers**, each reporting its own reason (no single layer is
  trusted to catch everything): emitter (shape-level: unsupported type / not-complete / ambiguous
  draft context) → normalizer (seam-level: missing id / timestamp / manager) → writer/store
  (persistence-level: constraint violations).
- **Tests — `__tests__/decision-os/sleeper-imported-activity-emitter.test.ts` — 11/11:** a real trade
  transaction end-to-end (emit → normalize → write → persisted row → `BehavioralEvent[]` → league
  facts, proposer/counterparty attribution correct, league trade count = 1); a real waiver end-to-end;
  idempotent repeated ingestion (3 passes, stable row count); external-only manager persistence; an
  orphan roster never fabricates an attribution; unsupported transaction type / non-complete status /
  ambiguous draft pick all skip with clear reasons; a draft pick with real context but no supplied
  timestamp is honestly dropped (never fabricated); a draft pick with a real supplied timestamp
  persists correctly. **Full decision-os ingestion + regression suite: 68/68.**
- **Bug found by this increment's full-repo typecheck (fixed):** `importedActivityToEvents.ts`
  (Increment 3) imported `BehavioralEventType` from `./events/types`, but that type is defined in
  `./events/taxonomy` and only re-exported nowhere — a real type error vitest's transpile-only runner
  never caught (it doesn't validate type-only imports). Fixed the import path; **0 Decision OS /
  ingestion errors** in the full-repo typecheck afterward (repo-wide baseline errors are pre-existing
  and unrelated — world-cup/tournament files, none touched by this workstream).
- **Real-DB proof (non-prod, reused the Increment 3 throwaway Neon project per the user's
  instruction):** ran `ingestSleeperImportedActivity` (the actual production code, not a shortcut)
  against realistically-shaped Sleeper fixtures (a trade + a waiver, one AF-linked manager + one
  external-only manager) via `InMemoryImportedActivityStore` to compute the exact persisted values,
  then applied the adapter's identical `INSERT … ON CONFLICT DO UPDATE` semantics to Neon project
  `cool-lab-87438174`: first ingest → 2 new rows; **re-ingest of the same natural keys → same row
  ids, `inserted: false`**; final state on that (shared-with-Increment-3) table = 4 rows total (2
  trade + 2 waiver, the other 2 from Increment 3's proof), **all 4 with `appUserId = null`** — no
  AppUser ever fabricated, across two increments' worth of proof. **No production or shared DB
  touched.** *(Honesty note: there is no network/API access in this environment to pull a live
  Sleeper league — "real Sleeper activity" here means realistically-shaped Sleeper API payloads,
  matching the production adapter's exact types, run through the real unmodified pipeline code; it
  is not a live API pull.)*

**Not done in Increment 4 (closed or re-scoped below):** wiring `ingestSleeperImportedActivity` into
the actual `SleeperHistoricalBackfillService` call site; AF-league/appUserId mapping enrichment;
a live end-to-end pass against a real Sleeper league's live API (still open — see §3).

## 2e. Increment 5 — scheduled snapshot capture + trend history (landed)

**Scope, as directed: snapshot capture + trend history only.** No Mission Control, no dashboard
visuals, no customer-facing UI.

- **Cadence assumption (explicit, documented, minimal):** snapshots bucket by **UTC calendar day**
  (`cadence: 'daily'`, the only supported cadence right now). `derivePeriodKey` is a small `switch`
  so a coarser/finer cadence can be added later without redesigning capture or storage.
- **`lib/decision-os/snapshot/behavioralSnapshotCapture.ts`** — pure, deterministic point-in-time
  capture of the Increment 1–4 behavioral pipeline's own outputs
  (`assembleLeagueBehavioralFacts`/`assembleManagerBehavioralFacts`, unchanged). Same
  `(events, capturedAt, lookbackDays)` → structurally identical snapshot, always (the pure-layer
  idempotency proof). An empty event stream yields an **honestly-zeroed** league snapshot
  (`eventCount: 0`, `completeness: 0`, `warnings: ['no_events']`) and **zero** manager snapshots —
  never skipped, never fabricated.
- **`lib/decision-os/snapshot/behavioralSnapshotStore.ts`** — provider-neutral port (mirrors the
  Increment 2 pattern), idempotent by `(leagueId, managerId, periodKey)`; `InMemoryBehavioralSnapshotStore`
  reference impl doubles as the DB-adapter contract + test double. Re-running the same period
  converges to one row (re-run safety); a new period appends a new row (that append-over-time
  **is** the trend history).
- **`lib/decision-os/snapshot/behavioralSnapshotWriter.ts`** — `captureAndWriteBehavioralSnapshots`
  orchestrator: capture → upsert the league snapshot + every active manager's snapshot.
- **`lib/decision-os/snapshot/behavioralTrend.ts`** — minimal, honestly-scoped trend derivation:
  a chronological time series of each snapshot's own top-level metrics + a first-vs-last delta.
  Deliberately **not** a dashboard/forecast/visualization (out of scope).
- **Schema (justified, additive-only):** no existing model fit — `IntelligenceLeagueSnapshot` is a
  single-row-per-league "latest state" (no history) built on the unrelated G15 DomainEvent
  projection; `EngineSnapshot`/`GlobalMetaSnapshot`/`RankingsSnapshot`/etc. are all cache-expiry or
  fantasy-domain-specific with the wrong unique-key shape. Added **`DecisionOsBehavioralSnapshot`**
  (`prisma/migrations/20260708010000_decision_os_behavioral_snapshot/`), unique on
  `(leagueId, managerId, periodKey)`, **no FK coupling to AF-native tables** (same principle as
  Increment 3 — `managerId` is a string, so external-only manager keys work with no AppUser).
  ⚠ **Postgres gotcha caught before it shipped:** a UNIQUE index on a *nullable* column doesn't
  enforce uniqueness against NULL (NULL ≠ NULL in a btree unique index) — that would have silently
  broken idempotency for league-scope rows. Fixed by using a stable non-null sentinel
  (`managerId String @default("__league__")`) at the DB column, mapped to/from `null` **only** in
  `prismaBehavioralSnapshotStore.ts` — the pure/domain layers never see the sentinel.
- **`lib/decision-os/snapshot/prismaBehavioralSnapshotStore.ts`** — Prisma adapter over a narrow
  delegate (Increment 3 pattern). Uses an **explicit `findUnique`-before-`upsert`** check for
  created-vs-updated — deliberately **not** inferring it from `createdAt === updatedAt` (an initial
  version did this and a test caught it failing: two upserts issued back-to-back — the literal
  "cron fires twice" re-run-safety scenario — can land in the same millisecond and misreport
  `'created'` twice; timestamp comparison is not a safe idempotency signal).
- **Tests — `__tests__/decision-os/behavioral-snapshot-capture.test.ts` — 10/10:** cadence bucketing;
  deterministic pure capture; empty-data honesty; store idempotency + 3-pass re-run safety; a new
  period appending (not overwriting) at both league and manager scope; trend derivation (chronological
  order, dedupe-by-period last-write-wins, empty input, delta); Prisma-adapter idempotency +
  sentinel-mapping; and **Sleeper preserved as the first validation source** — a real Sleeper trade
  flows Sleeper → `ingestSleeperImportedActivity` (Increment 4) → `mapImportedActivityRowsToEvents`
  (Increment 3) → `captureAndWriteBehavioralSnapshots` (this increment), landing a correct league
  trade count (1, not double-counted) and a per-manager trend row for the **external-only** manager
  (no AF account). **Full decision-os suite: 78/78.**
- **Real-DB proof (non-prod, reused the same throwaway Neon project again):** applied the migration
  to `cool-lab-87438174`; inserted a day-1 league snapshot → new row; **re-ingested the identical
  snapshot → same row id, no duplicate** (idempotency); inserted a day-2 snapshot (2 events,
  `totalTradeCount: 2`) → a **second, distinct row** (trend history growing, not overwritten);
  inserted an empty league's snapshot → persisted **honestly** (`eventCount: 0`, `completeness: 0`,
  `warnings: ["no_events"]`), never skipped. Trend query confirms the chronological
  `2026-07-08 → 2026-07-09` ordering with `eventCount` correctly increasing `1 → 2`. **No production
  or shared DB touched.**
- **Full-repo typecheck:** 158 errors baseline (unchanged from Increment 4), **zero in any Increment
  5 file** — including a real bug this increment's typecheck caught in its own new adapter code
  (a union-narrowing cast in `rowToRecord`), fixed before commit.

**Not done this increment (by design — out of scope per the user's directive):** Mission Control,
League Analytics, any dashboard/trend visualization, any customer-facing UI, and wiring the snapshot
job into an actual cron/scheduler (the writer is scheduler-ready — any caller that invokes it once
per day satisfies the cadence — but no scheduler was added, since none was requested).

## 3. What remains (the bulk — grounded next steps)

| # | Work | Notes / blocker |
| --- | --- | --- |
| Do #1 | Wire `ingestSleeperImportedActivity` into the real `SleeperHistoricalBackfillService` call site (today it's invoked from tests/a harness, not the production import flow) | Needs the production import flow's call site + a decision on error handling for a real import run. |
| Do #1 | AF-league/appUserId mapping enrichment (so `afLeagueId`/`appUserId` populate once identity mappings exist, flipping managers from `inferred` to `confirmed`) | Uses the existing `ExternalIdentityMapper`; no new infra needed. |
| Do #1 | Add `"the_replacements"` to `ImportProvider` + build its adapter | Explicitly deferred until that workstream starts (per instruction). |
| Do #4 | ~~Repeatable snapshot-capture job~~ **Increment 5 landed capture + trend history.** Remaining: wire a real scheduler/cron to call `captureAndWriteBehavioralSnapshots` once per day per league (the writer itself is scheduler-ready) | No scheduler was added this increment (not requested; avoids scope creep into ops/infra decisions). |
| Do #5 | **Surface alignment:** re-point **League Health** off its separate `monitorLeagueHealth` onto the behavioral pipeline; consolidate **Recommendations**; **build Mission Control + League Analytics** on top of the snapshot/trend data; enable `DECISION_OS_INTELLIGENCE_API_PROVIDER=real` per-league behind a parity gate | The next phase, per the user's own Increment-5 kickoff: "Recommended Increment 5 after this: scheduled snapshot capture and trend history, **then Commissioner OS surface alignment**." |

## 4. How this supports Commissioner OS licensing

Commissioner OS is meant to run on **external** platforms' leagues (The Replacements, Yahoo, ESPN, …).
That only works if imported activity becomes **real, idempotent, fully-attributed** Decision OS input,
and if that input compounds into **trend history** a commissioner can actually see change over time —
which is exactly what Increments 1–5 guarantee together: a licensee can re-sync a league safely
(idempotent keys), every manager shows activity regardless of AF account (external identity), and the
resulting behavioral facts accumulate into a real, queryable trend per league and per manager. That is
the difference between a demo and a licensable per-league intelligence product.

## 5. What The Replacements demo can show — honestly

- **Today (through Increment 5):** real provider activity (proven with Sleeper-shaped data) converts
  into idempotent, fully-attributed behavioral events, and those events compound into a **real,
  idempotent, growing trend history** per league and per manager — including managers with no
  AllFantasy account. No visualization exists yet; the data underneath one is now real and provable.
- **After Increment 6 (surface alignment):** League Health, Recommendations, Mission Control, and
  League Analytics would read this same trend data instead of divergent/absent sources, and the
  currently-empty surfaces would fill in with **real** values. Until then, those surfaces continue to
  **honestly degrade** (empty, not faked).

## 6. Boundaries honored
- No fake/demo intelligence; honest degradation throughout (proven for empty leagues in Increment 5).
- No NFL-Redraft beta, Start-Draft, PR-#166, AF-hosted-league, DFS-OS, Mission Control, or UI work.
- Reused existing identity infrastructure and architectural patterns instead of duplicating them.
