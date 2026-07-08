# Decision OS Phase A — Implementation (in progress)

**Status: implementation BEGUN (freeze lifted by the user; OS is the sole focus).** This records the
first landed increment and the grounded plan for the rest. Every claim below is code-verified; nothing
is fabricated, and no NFL-Redraft / Start-Draft / PR-#166 work is touched.

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

## 3. What remains (the bulk — grounded next steps)

| # | Work | Notes / blocker |
| --- | --- | --- |
| Do #1/#3 | **DB-write layer:** upsert `normalized` activity into the 4 behavioral-input tables by `naturalKey` | Needs an **approved non-prod DB** to land + test writes (I will not write speculative rows into a shared schema). This is the DB-level idempotency test (Deliverable #2 full). |
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
