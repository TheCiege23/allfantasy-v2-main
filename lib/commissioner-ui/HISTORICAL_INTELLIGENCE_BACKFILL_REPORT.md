# Phase 4.3 — Historical Intelligence Backfill Report

Populates the Decision OS behavioral intelligence pipeline with real Sleeper
history for the user's real leagues, transitioning it from "structurally
complete but historically empty" (Phase 4.2's finding) to "historically
populated." No Commissioner OS or Decision OS algorithm/redesign — this
phase only feeds real, previously-missing input data into the existing,
unmodified pipeline, plus wires one already-built-but-never-called function.

## 1. Pipeline Audit

The full pipeline, read directly from source (`lib/decision-os/behavioral/`):

```
Sleeper API (public, unauthenticated)
  → Raw provider rows: WaiverClaim, AfLeagueTrade(+Item), AfRosterMoveHistory,
    DraftSession/DraftPick  (native AF tables — NOT Decision-OS-specific)
  → port.ts loaders (read-only, max 500 rows/source)
  → mappers.ts (raw rows → BehavioralEvent[], pure functions)
  → assemble.ts (events → ManagerBehavioralFacts / LeagueBehavioralFacts)
  → manager-intelligence.ts / league-intelligence.ts (facts → scored intelligence)
  → history/snapshots.ts: captureLeagueSnapshotHistory() [PERSISTS a point]
  → history/trend.ts: computeLeagueTrend() [compares ≥2 persisted points]
  → Commissioner OS (via realDataProvider + the Intelligence API routes)
```

Every step from "port.ts loaders" onward already existed, fully built, with
no code defects — confirmed by both a direct read-through and an independent
audit subagent. Historical processing stopped at two distinct points:

### Stop point 1 — raw source tables were empty
`WaiverClaim`, `AfLeagueTrade`, `AfRosterMoveHistory` had **zero rows** for
every one of the user's leagues, and `DraftPick` had only 12 rows across 6
leagues (all in native/manual leagues, not Sleeper leagues — see §2). Decision
OS's port only reads these four native tables; it has no Sleeper-specific
ingestion of its own, by design (Phase 5.1's own doc comment: "No provider
fields — all sources are native AF tables").

### Stop point 2 — snapshot capture is dead code
`captureLeagueSnapshotHistory()` (`history/snapshots.ts`) has existed since
Phase 3.3. Confirmed by full-repo search: **no route, script, or job anywhere
in the codebase calls it.** Without a captured snapshot, `getRecentLeagueSnapshots()`
always returns `[]`, and `computeLeagueTrend()` always short-circuits to
`{ available: false, reason: 'insufficient_historical_data' }` — this is why
Phase 4.2 saw trend cards permanently empty even in principle.

## 2. Import Pipeline Trace — a correction to Phase 4.2

Tracing the actual import commit flow (`ImportedLeagueCommitService.ts` →
`runHistoricalBackfill()` → `SleeperHistoricalBackfillService.ts`) surfaced a
**correction to Phase 4.2's own claim**: of the 8 leagues Phase 4.2 called
"real Sleeper leagues," only **2** actually have `League.platform === 'sleeper'`
with a real Sleeper `platformLeagueId`:

| League | `platform` | Real Sleeper league? |
|---|---|---|
| "Not 4 the Weak!" (`e4bb3f31...`) | `sleeper` | **Yes** — `platformLeagueId=1313584523757260800` |
| "Bla bla bla" (`a6f74157...`) | `sleeper` | **Yes** — `platformLeagueId=1359284500814647296` |
| 6× "TheCiege26's N-Team NFL Redraft League" | `manual` | No — natively created, `platformLeagueId` is a synthetic `manual-{uuid}` string |

Phase 4.2 did not check the `platform` column and reported all 8 as real
Sleeper imports. They are all real, currently-active AllFantasy leagues (the
dashboard data shown in Phase 4.2 was genuinely real), but only these 2 have
Sleeper history to backfill in the first place. This phase's backfill scope
is correctly limited to these 2.

Also discovered while tracing: the existing `runHistoricalBackfill()` →
`runDynastyBackfill()` path (which *did* run for one league, per
`League.settings.historicalBackfillStatus = 'complete'`) writes trades into
`LeagueTrade`/`LeagueTradeHistory` — legacy dynasty-era models keyed by
Sleeper username, entirely separate from `AfLeagueTrade`, the model Decision
OS's port actually reads. This explains why that league still showed zero
Decision OS activity despite a "completed" backfill: the backfill and
Decision OS's port read from two different, non-overlapping trade tables.

## 3. Missing Execution Steps (identified, per the ticket's requirement)

1. No code path translates Sleeper's real transaction history (waivers,
   trades) into `WaiverClaim` / `AfLeagueTrade` / `AfLeagueTradeItem` — the
   tables Decision OS's port actually reads. The existing Sleeper backfill
   writes to a parallel legacy system instead.
2. `captureLeagueSnapshotHistory()` is fully built and never invoked —
   confirmed dead code.
3. The async `runHistoricalBackfill()` fired at import time has no
   completion guarantee: one league sat at `historicalBackfillStatus:
   'pending'` for 4+ days (started 2026-06-30, never completed) with no
   retry, and 6 of 8 leagues never even attempted it (predate this code
   path or went through the manual-creation flow instead).
4. `DraftSession`/`DraftPick` were never populated for either real Sleeper
   league (`syncSleeperHistoricalDraftFactsAfterImport` produced 0 sessions
   for both) — draft-based intelligence dimensions remain unpopulated;
   flagged as a remaining gap, not fixed in this phase (see §6).

## 4. Execution — what was actually generated

Two new scripts were written (not modifications to Decision OS or
Commissioner OS code):

- **`scripts/backfill-decision-os-sleeper-history.ts`** — fetches real
  Sleeper transactions (`getLeagueTransactions`, already-existing client, no
  new API integration) for both real Sleeper leagues across all weeks with
  data, and inserts real `WaiverClaim` / `AfLeagueTrade` / `AfLeagueTradeItem`
  rows. Idempotent (checks each row's `metadata.sleeperTransactionId` before
  inserting).
- **`scripts/capture-decision-os-snapshots.ts`** — calls
  `realDataProvider.getLeagueIntelligence()` (the same function the live API
  route calls) and persists the result via `captureLeagueSnapshotHistory()`.
  Meant to be run repeatedly over time (documented as a recommended
  scheduled job in §6/Phase 4.4, not wired into the request path itself —
  see rationale below).

**A real bug was found and fixed mid-execution**: the first backfill run
silently dropped every transaction belonging to the *importing user's own*
roster. Root cause: `LeagueTeam.platformUserId` stores the raw Sleeper user
id for every team including the owner's, but `Roster.platformUserId` gets
upgraded to the owner's real `AppUser.id` at import time — the two tables'
join key diverges for exactly one row per league (the owner's). Fixed by
resolving the owner's Sleeper user id via `UserProfile.sleeperUserId` and
special-casing that one join. Re-running (idempotent) then correctly
inserted the owner's real activity.

### Real results (verified by direct DB query after execution)

| Table | Before | After |
|---|---|---|
| `waiver_claims` (2 real leagues) | 0 | **11** |
| `af_league_trades` | 0 | **1** |
| `af_league_trade_items` | 0 | **4** |
| `intelligence_league_snapshot_history` | 0 | **4** (2 leagues × 2 captures each) |

Every inserted row carries a real Sleeper `transaction_id`, real player ids,
real roster ids, and the real Sleeper `created` timestamp — nothing
invented. Rows are additionally tagged `backfilledFrom:
'sleeper-historical-backfill-script'` in `metadata` so they remain
identifiable and reversible.

**Not backfilled (documented gap, not a fabrication workaround)**: 4 of the
owner's real Sleeper transactions in "Bla bla bla" are pure roster drops
(`adds: null`). `WaiverClaim.addPlayerId` is a required column, so a
drop-only transaction cannot be represented without inventing a fake add —
correctly skipped rather than fabricated.

## 5. Recompute — Before vs After (real, measured)

Captured via `realDataProvider.getLeagueIntelligence()` directly, and
confirmed independently in the live Commissioner OS UI (Live mode) for
"Not 4 the Weak!" (`e4bb3f31...`):

| Signal | Before (Phase 4.2) | After (this phase) |
|---|---|---|
| League engagement score | 0 | **8** |
| League engagement tier | dormant | **passive** |
| Waiver activity rate | 0 | **11** |
| Trend (`computeLeagueTrend`) | `available: false` (0 snapshots) | **`available: true`, direction "up", delta +8** |
| Mission Control — League Health card | "0 — Unavailable" | **"8 — No managers have recorded any activity"** |
| Mission Control — Open Recommendations | 0 | **2** |
| Mission Control — Active Risks | 0 | **2** |
| Manager Intelligence card (Mission Control) | "0 highlights" | **"1 highlight — TheCiege26 — Manager has been inactive for 51 days"** (real, computed from his real last-event timestamp) |
| League Analytics page | "0 — 0 of 0 managers active" | **"8 — 0 of 1 managers active", "+8 vs previous capture", Waiver Activity: High** |

"Bla bla bla" (the other real Sleeper league) remains at engagement score 0
— honest, because the owner's only real activity there was the 4
non-backfillable pure-drop transactions above; there is genuinely no
representable historical evidence for that league yet.

## 6. Remaining Gaps (real, not glossed over)

1. **Manager-level intelligence is architecturally scoped to real `AppUser`
   accounts.** Sleeper leagues have exactly one such account (the importing
   user) — every other manager is a placeholder identity with no login.
   Backfilling their real transactions correctly populates
   league-*aggregate* counts (`totalWaiverClaimCount`, etc.) but can never
   populate their individual manager intelligence, because that requires a
   real `managerId` that structurally does not exist for them. This is a
   capability boundary, not something this phase's backfill can close.
2. **Inconsistent read paths across module pages, discovered during
   verification**: Mission Control's summary cards and the League Analytics
   page both reflect the new real data correctly. The *dedicated* Manager
   Intelligence page and Recommendations page still show empty states for
   the same league at the same moment — meaning they call a different
   method/threshold than the Mission Control summary widgets do. Flagged
   for Phase 4.4 investigation; not diagnosed further here to stay in scope.
3. **League Health module's own detailed score page** still shows `0` even
   though Mission Control's League Health *card* shows `8` for the same
   league — same class of inconsistency as #2.
4. **Draft history was never backfilled** (§3, item 4) — draft engagement
   dimension stays at 0 for both real leagues.
5. **`captureLeagueSnapshotHistory()` is still not wired into any live
   request path** — it was invoked here via a standalone script, twice, to
   produce the two real points needed for this phase's trend proof. Without
   a recurring caller (e.g., a daily scheduled job), snapshot history will
   not continue accumulating going forward. Recommending this as a Phase
   4.4 / pre-production action rather than adding a job scheduler in this
   phase (out of scope, and doing it hastily risks the exact kind of
   redesign this ticket explicitly disallows).

## 7. Performance Observations

- Sleeper transaction fetch: ~18 sequential `GET /league/{id}/transactions/{week}`
  calls per league (one per possible week) — the two real leagues together
  completed in well under a minute, dominated by Sleeper's own response
  latency, not local compute.
- `realDataProvider.getLeagueIntelligence()` (full pipeline: load → map →
  assemble → derive) completed in low hundreds of milliseconds per call
  once Decision OS's own env gate/API key were configured (see Phase 4.2)
  and the dev server routes were warm.
- No errors, no timeouts, no retries needed during backfill execution.

## 8. Verification Summary

- Direct DB queries before and after confirm the row counts in §4.
- `realDataProvider.getLeagueIntelligence()` output before/after confirms
  §5's score/tier/rate changes came from the real derivation pipeline, not
  a UI-only change.
- `computeLeagueTrend()` output confirms trend now returns `available: true`
  from two genuinely captured, differently-valued points.
- Live browser verification (Data Mode = Live, real `TheCiege26` session)
  confirms the same real numbers render in Commissioner OS's Mission Control
  and League Analytics pages.
- No fabricated values anywhere: every changed number traces to a real
  Sleeper transaction id, a real timestamp, or a real derivation of both.
