# Waiver Shadow-Compare — Real-Data Validation (Phase 13)

**Status: real validation performed against one genuine, non-production, imported Sleeper league. One real bug found and fixed (with a regression test). Readiness classification: B — continue shadow validation.**

**Phase 14 update:** the "disclosed, not fixed" Sleeper player-identity gap noted throughout this document (Step 7, Known Gaps) has since been closed by a new canonical resolver — see [`FANTASY_OS_PLAYER_IDENTITY.md`](FANTASY_OS_PLAYER_IDENTITY.md). Re-running this exact document's 21 real requests post-fix achieved 100% player-name resolution and also surfaced a separate, real, pre-existing seam characteristic (the shadow never receives `currentWeek`/`goal`) that this document's uniformly-`equivalent` 22/22 result had been masking. The performance/telemetry numbers below remain the accurate historical record of the Phase 13 run; they are not restated here.

**Phase 16 update:** the single-league/single-roster limitation disclosed throughout this document has been partially addressed — see [`FANTASY_OS_WAIVER_MULTI_LEAGUE_VALIDATION.md`](FANTASY_OS_WAIVER_MULTI_LEAGUE_VALIDATION.md). 2 additional, structurally distinct real Sleeper rosters (within the same real league — no independent second league or provider exists in this environment, disclosed there) were validated: 18 new real requests, 100% `equivalent`, combined with this document's original 21 for 39/39 (100%) real telemetry events across 3 distinct real rosters. Readiness classification remains **B**.

This document is the real-data validation record for the Phase 12 instrumentation described in [`FANTASY_OS_WAIVER_SHADOW_COMPARE.md`](FANTASY_OS_WAIVER_SHADOW_COMPARE.md), itself the migration candidate selected in [`FANTASY_OS_FIRST_CONSUMER_MIGRATION_READINESS.md`](FANTASY_OS_FIRST_CONSUMER_MIGRATION_READINESS.md).

Every number in this document comes from one of two sources, both explicitly labeled throughout:
- **Real imported Sleeper evidence** — data read from a real non-production database, a real live call to the public Sleeper API, or real telemetry emitted by the live route during this validation.
- **Inferred conclusion** — a judgment made by reasoning about the real evidence above (e.g. root-cause classification).

Nothing in this document is fixture-derived. No fixture result is presented as a real Sleeper result.

## Step 1 — Environment verification

Direct verification (not reliance on prior-phase summaries) found five distinct real Neon Postgres endpoints across this repo's `.env*` files. `.env`'s default database was **not** used — per established project precedent it is a real, shared, active database with real customer leagues. Instead:

- **Database used:** the endpoint configured in `.env.test` (`ep-muddy-leaf-adigvvph...neon.tech`) — a genuinely separate Neon project/branch from `.env`'s default, confirmed reachable via a read-only `SELECT 1`.
- **Evidence it is a real test environment, not a clone of production:** `leagues.platform` distribution in this database includes `allfantasy_test_adp_seed` (18 rows) — an explicitly test-seeded platform value that does not exist in real customer data — alongside `manual` (27), `allfantasy`/native (16), `sleeper` (3), `native` (1). Activity spans 2026-04-24 through 2026-07-07, consistent with ongoing test/dev use, not a static snapshot.
- **Real Sleeper data confirmed present:** 3 leagues with `platform = 'sleeper'`, each with real Sleeper-format `platformLeagueId` values and 12 real, populated rosters.
- **No real customer was impersonated.** One of the 3 real Sleeper leagues is owned by a designated QA/dev-seed `app_users` account (`username: dashboardqa_phaseb_2026`), not a real customer — and, critically, that same account already holds one of the 12 real roster slots *inside* that real Sleeper-imported league (`Roster.platformUserId` literally equals the dev account's id). This meant real validation traffic could be generated as that account's own real roster, with zero need to authenticate as, or act on behalf of, any real customer's account.
- **Auth path used:** this repo's existing `DEV_AUTH_BYPASS_ENABLED` mechanism (`lib/auth.ts`), a pre-existing, already-hard-gated (`NODE_ENV !== 'production' && DEV_AUTH_BYPASS_ENABLED === 'true'`) NextAuth credentials provider used for local/dev/e2e testing — not something built for this phase. Its default identity is exactly the QA account described above.
- **Local dev server:** started against the `.env.test` database only (`DATABASE_URL`/`DIRECT_URL` explicitly set as process env, overriding whatever `.env.local`/`.env` would otherwise supply), on a dedicated port/dist-dir, with `SHARED_SERVICES_WAIVER_SHADOW_COMPARE=true` and `DECISION_OS_TEST_LEAGUE_IDS=<the one real league, hashed below>` scoping the flag to exactly one real league from the start.
- **No provider write credentials were used or needed.** All real Sleeper data was read via Sleeper's public, unauthenticated read API (`api.sleeper.app/v1/league/...`) and via the already-imported rows in the test database. No claim was submitted, no roster was written, no Sleeper write endpoint was ever called.
- **One real, deliberate test-data change was made:** the QA account's `user_token_balances.balance` was updated from 0 to 1000 in the `.env.test` database only, so it could pass the real `ai_waivers` token-entitlement gate the same way a real paying user would — this does **not** weaken or bypass the entitlement check itself; it satisfies the real check with real (test-environment) data.

**Conclusion: a safe, real, non-production validation environment exists and was used.** The environment-readiness blocker path was not needed.

## Step 2 — Sanitized league profile

Identifiers below are SHA-256-truncated (first 12 hex chars) to avoid publishing real IDs in documentation, per the Phase 13 brief. No credentials, tokens, session IDs, or personal emails appear anywhere in this document.

| Field | Value |
|---|---|
| Internal `leagueId` (hashed) | `5127fa69078b` |
| Real Sleeper `platformLeagueId` (hashed) | `3e562cd3e2fe` |
| Test roster used (hashed) | `d81fc1d60f87` |
| Sport / season | NFL / 2026 |
| Format | Dynasty, 12 teams, Superflex/taxi enabled (`taxi_slots: 4`) |
| Waiver type | Rolling waiver priority (Sleeper `waiver_type: 0`), **not** FAAB — `waiver_budget: 100` is set but unused in this format |
| League status (Sleeper, at fetch time) | `pre_draft` — dynasty rookie draft (4 rounds) not yet run for the 2026 season |
| Import state | Registered (`importedAt` populated, late June 2026); background sync had not completed (`syncStatus: 'pending'`, `lastSyncedAt: null`) — this is what caused the Step 3 finding below |
| Real manager/roster count | 12 (matches Sleeper exactly) |
| Test identity used | A designated QA/dev-seed AllFantasy account, **not** a real customer, that already owned one of the 12 real rosters |

A second, unscoped real league (hashed `67cdc8a6bf42`, `platform='manual'`, also owned by the same QA account) was used only for the Step 4 negative scoping test below — never scored via the shadow-compare seam.

## Step 3 — Import fidelity (checked before any waiver testing)

Compared the real Sleeper league (live public API) against the real imported rows in the test database:

| Dimension | Classification | Evidence |
|---|---|---|
| Team/roster count | Exact | Sleeper: 12 rosters. DB: 12 `Roster` rows. |
| League format (dynasty, 12-team, waiver type, waiver budget) | Exact | Sleeper `settings.num_teams=12/waiver_type=0/waiver_budget=100` vs DB `leagueSize=12/waiverType='rolling'/waiverBudget=100` |
| Season / sport | Exact | Sleeper `season=2026, sport=nfl` vs DB `season=2026, sport=NFL` |
| Roster composition (one sampled real roster) | Exact | Sleeper roster: 30 players / 10 starters / 3 taxi / 1 reserve. Same roster in DB: 30 / 10 / 3 / 1 — exact match on every count. |
| Waiver priority | Exact | Sleeper `waiver_position: 6` vs DB `Roster.waiverPriority: 6` for the same real manager. |
| FAAB budget used | Unsupported (not applicable) | League is rolling-waiver, not FAAB — `faabRemaining` is legitimately unpopulated in the DB; this is a real, honest "not applicable," not a mismatch. |
| Raw player-ID references (`players`/`starters`/`taxi`/`reserve`) | Exact | DB stores Sleeper's own native ID-array shape verbatim (e.g. `starters: ["96","10216",...]`). |
| **Normalized `lineup_sections` shape (app-canonical, name/position-enriched roster view)** | **Incomplete** — real, root-caused | **Not present at all** for any of the 3 real Sleeper leagues in this environment. Confirmed this is not specific to these 3 leagues: a database-wide query found `lineup_sections` populated only for `platform IN ('manual','allfantasy')` rows, never for `platform='sleeper'` rows, in this environment. Root cause: the background sync step that would populate `lineup_sections` had not completed (`syncStatus:'pending'`) for these leagues — a real, pre-existing, already-documented condition in this codebase (`lib/waiver-wire/roster-utils.ts`'s own comment calls this a "pre-draft/legacy state"). **This is an import/sync-completeness gap, not a raw-import-fidelity mismatch** — the raw data imported exactly; a separate, later normalization step simply hadn't run yet for these leagues. |
| Player name/position/team enrichment for raw Sleeper IDs | Mismatched | AllFantasy's internal player pool is keyed by internal UUIDs, not Sleeper's own numeric player IDs. Sleeper roster references (e.g. `"10216"`) do not resolve against it. See Step 7. |

**Import-caused vs. engine-quality separation:** the roster-composition counts (exact) prove the *import itself* was faithful. The `lineup_sections` gap and the player-ID resolution gap are downstream of the import (a sync step that hadn't run, and a player-identity mapping that doesn't exist yet) — not evidence that the import corrupted or lost data.

## Step 4 — Flag scoping proof

`SHARED_SERVICES_WAIVER_SHADOW_COMPARE=true` was set with `DECISION_OS_TEST_LEAGUE_IDS=<hash 5127fa69078b's real ID>` — scoping to exactly the one real league above, via the pre-existing `getDecisionShadowScopeFilters()` mechanism (no new scoping code written this phase).

- A real, authenticated, successful (`200`) request against the **scoped** league produced a real `shared_services.waiver` `decision.shadow_parity` telemetry line.
- A real, authenticated, successful (`200`) request against a **different, unscoped** real league (hash `67cdc8a6bf42`) — same test identity, same server, same flag state — produced **zero** new telemetry lines. The response itself was identical in shape/content to a normal (non-instrumented) response.

**Scoping works as designed: the shadow-compare seam only runs for leagues explicitly listed, and its absence is invisible to the caller.**

## Step 5 — Real request generation

21 real, distinct HTTP requests were made to the live `/api/waiver-ai/engine` route (plus 1 earlier ad-hoc debug request during bug investigation — 22 total shadow-compare telemetry events). Each request:
- Was authenticated via a real NextAuth session (the QA test identity), not a mocked/injected session.
- Used a request body assembled by calling the **same, real, already-tested Phase 7 context assembler** (`buildWaiverDecisionContext`) that a real client would produce equivalent data for — i.e. real roster data, real free-agent pool (291 real NFL players), real league settings, real team-needs computation — read live from the test database.
- Varied `goal` (`balanced` / `win-now` / `rebuild`) × `currentWeek` (1, 4, 8, 12, 15, 17, 18) — 3 × 7 = 21 real, distinct scenarios, covering the season's decision-context range for one real dynasty roster.
- Went through the full real route: session check → Zod validation → `assertLeagueMember` → `requireFeatureEntitlement` (real token spend, 15 tokens/request) → `runWaiverAIService` (authoritative) → Decision OS Stage-0/1 block (unchanged) → Phase 12 shadow-compare seam.

**Honest sample size: 22 real telemetry events, from 21 real HTTP requests, against 1 real league and 1 real roster.** This is not a fabricated production-traffic volume — every request is individually reproducible from the server log. The Zod-payload-construction issues encountered while building the generation script (missing `teamNeeds` handling for a null case) were bugs in the *validation script's own request construction*, not in the live route, and were fixed before the real sample was collected; they are not counted as real requests.

## Step 6 — Real telemetry inspection (aggregate)

Computed directly from the 22 real `decision.shadow_parity` / `shared_services.waiver` events emitted to the dev server's own log (this repo's real telemetry sink — `emitDecisionTelemetry` writes `console.log('[decision-os]', ...)`, captured verbatim, not summarized by a script that could misrepresent it):

| Metric | Value |
|---|---|
| Total events | 22 |
| `ran: true` | 22 / 22 (100%) |
| Status distribution | `equivalent`: 22 (100%). `exact_match`/`acceptable_variance`/`material_divergence`/`unsupported_comparison`/`insufficient_context`/`shadow_execution_failure`: 0 each. |
| Top-candidate agreement | 22 / 22 (100%) |
| Candidate overlap | 22 / 22 (100%) |
| `scoreDelta` range | −4 to +7 (nonzero in 14/22 events — see Step 7) |
| `faabDelta` range | −3 to 0 (nonzero in 14/22 events; this league is rolling-waiver so FAAB deltas are a secondary, less meaningful signal here — see Step 7) |
| Providers seen | `sleeper` only (the only real provider available in this environment) |
| Real leagues seen in shadow telemetry | 1 (matches the scoping proof in Step 4 — the unscoped league never appears) |

## Step 7 — Divergence analysis (root-caused, not bucketed)

**14 of 22 events had a nonzero `scoreDelta`/`faabDelta` despite all 22 being classified `equivalent`** (top-candidate agreement + candidate overlap are the classification's actual criteria — small score/FAAB deltas do not change the classification, by design, since the seam only exposes a top-candidate comparison, not full ranked-order agreement; see the Known Gaps in the Phase 12 doc).

Root cause of the nonzero deltas (inferred conclusion, from reading the two engines' shared scoring code path): both the authoritative and shared paths call the **same** `scoreWaiverCandidates`, but with **independently assembled** roster/valuation context. The authoritative path's roster was built the same way as the shared path's for this test (both via `buildWaiverDecisionContext`), so the *only* source of divergence is `currentWeek`/`goal` interacting with `computeTeamNeeds`'s week-sensitive weighting — a real, expected, small scoring-precision variance, not a data-integrity bug. This is consistent with the deltas being small (single digits) and never flipping which player ranks first.

**One real, distinct, root-caused bug was found and fixed this phase** (not a "divergence" between the two engines — a bug in the shared service itself, found via the real Sleeper data): see "Bug found and fixed" below. It would have caused every one of the 22 events to be `insufficient_context` or `material_divergence` (empty shared roster vs. a real authoritative one) had it not been fixed before the real sample was collected — the 22 real events reported above are all **post-fix**.

**Not fixed this phase, disclosed instead:** real Sleeper player IDs (e.g. `"10216"`) do not resolve against AllFantasy's internal player pool (UUID-keyed), so the shared service's own roster view shows `Player 10216` / `UNKNOWN` position for most real roster players even after the Step 3/bug fix. This did not change any of the 22 events' classification (the *available-player* pool, which drives the top recommendation, resolves correctly — only the shared service's view of the *existing* roster is affected), but it is a real precision gap. Fixing it would require a genuine Sleeper-ID → internal-player-ID identity resolution layer, which does not appear to exist yet in this codebase for this purpose — out of scope for a "smallest additive fix" this phase; flagged for a future phase.

## Step 8 — Performance (real, measured)

| Metric | Median | p95 |
|---|---|---|
| Authoritative (`runWaiverAIService`) duration | 2ms | 8ms |
| Shared service (`evaluateWaiverShadow`) duration | 751ms | 1,342ms |
| Total shadow-compare seam duration | 967ms | 1,442ms |

0 of 22 real requests hit the 4,000ms local timeout (0%). The 4000ms bound was not changed. The shared service is substantially slower than the authoritative path (independent DB reads + FantasyCalc valuation fetch vs. scoring an already-assembled candidate list) — expected given the Phase 12 doc's own documented tradeoff, now confirmed with real numbers instead of a theoretical worst case.

## Step 9 — Rollback validation

The dev server was fully stopped and restarted with `SHARED_SERVICES_WAIVER_SHADOW_COMPARE` unset (all other config, including the league scoping var, left unchanged). A real request against the *same* previously-active real league:
- Returned an identical-shaped `200` response (same top suggestion, same scores) — the response is unaffected by the flag.
- Produced **zero** new `shared_services.waiver` telemetry lines.

**Rollback is proven: disabling one flag alone stops all shadow execution and all telemetry for it, with no data or schema repair needed.**

## Bug found and fixed (with regression test, per the required process)

1. **Proved with evidence:** a real, authenticated request against the real Sleeper league returned `rosterPlayerCount: 0` from `buildWaiverDecisionContext`, despite the same roster having 27 real, DB-confirmed players (Step 3). Root cause traced to `getNormalizedLineupSections()` (used by `WaiverContextAssembler.ts`) reading only `playerData.lineup_sections.*`, which — per Step 3 — is absent for every real Sleeper-imported league in this environment; the real data instead lives in flat `playerData.players`/`starters`/`taxi`/`reserve` ID-array fields.
2. **Classified ownership:** the bug is in `lib/shared-services/waiver/WaiverContextAssembler.ts` (this project's own Phase 7 shared-service code), not in `getNormalizedLineupSections` itself (used by many unrelated consumers — out of scope to change) and not in the import pipeline (the raw import was faithful, per Step 3).
3. **Added a failing regression test first:** `__tests__/shared-services/waiver/waiver-context-assembler.test.ts` — `'falls back to the flat players/starters/taxi/reserve ID arrays when lineup_sections is absent (real Sleeper-import shape)'`, using a synthetic-but-shape-accurate fixture matching the real data. Confirmed failing (`0` roster players instead of the expected `4`) before any fix.
4. **Smallest additive fix:** added a fallback path inside `WaiverContextAssembler.ts` only (`flatSectionsFromPlayerData` + an extended `toWaiverRosterPlayers`) that reconstructs starters/bench/ir/taxi from the flat ID arrays when `lineup_sections` is empty, resolving names/positions from the sport-wide player pool already fetched in the same function. No change to `getNormalizedLineupSections`, `lib/roster/`, or any other consumer.
5. **Reran the real case:** the same real request against the real league now returns `rosterPlayerCount: 27`, a real `teamNeeds` computation, and a full `200` response with real recommendations.
6. **Reran regressions:** the full pre-existing `waiver-context-assembler.test.ts` suite (9 tests, including the 2 new ones) passes; the broader `__tests__/shared-services/waiver`, `__tests__/decision-os/waiver-shared-service-shadow-compare.test.ts`, and `__tests__/waiver-ai-engine-route-contract.test.ts` suites (79 tests total) pass with zero regressions.
7. **Documented:** this section, plus the "Known gaps" update in the Phase 12 doc.

No engine scoring logic was tuned to mimic any particular output — the fix only changes how raw roster data is *read*, not how it is scored.

## Step 10 — Readiness classification

### B — Continue shadow validation.

**Why not A (ready for controlled authoritative-fidelity testing):** only one real Sleeper league and one real roster/manager perspective have been validated. A real bug was found and fixed *in this same phase* — one clean post-fix sample from the same league/roster is not enough evidence that the fix, or the shared service generally, behaves correctly across different real leagues, formats, or managers. The real, disclosed player-identity-resolution gap (Step 7) is also unresolved and could matter more in a league with heavier IR/taxi usage or different roster composition.

**Why not C (blocked pending remediation):** nothing found this phase is blocking. The one real bug found was fixed, with a regression test, in-phase. Scoping, rollback, and telemetry all work exactly as designed. 22/22 real events classified `equivalent` with 0% failure/timeout rate is strong, clean evidence — just from a narrow real sample.

**What would move this from B to A:** real telemetry from additional real leagues (ideally: a second, third, and fourth real Sleeper league; at least one real FAAB-waiver league to exercise `faabDelta` meaningfully; a real request from a roster other than the one QA-owned roster) reviewed with the same rigor as this document, plus either closing or explicitly accepting the player-identity-resolution gap.
