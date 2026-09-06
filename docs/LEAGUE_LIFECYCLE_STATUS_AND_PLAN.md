# League Lifecycle: Build Status & Project Plan

**Scope:** AF-native "create a league" → draft → full regular season → playoffs → offseason → next season's draft, for every supported format (redraft, dynasty, keeper, best-ball, guillotine, survivor, big-brother, zombie, salary-cap, tournament).

**Method:** five parallel code-tracing passes (2026-09-06), each requiring file:line evidence and a 4-form import census (`from '@/lib/x'`, `'./x'`/`'../x'`, `require(`, `await import(`) before calling anything "unused" — this repo's own CLAUDE.md documents that a naive single-form grep gives false negatives. Findings below are evidence-based, not inferred.

**Headline finding:** the hard engineering is mostly *done*. What's missing is not features — it's **phase transitions**. Several places where Phase A is supposed to hand off to Phase B have a real, working function on both sides that nothing ever calls to connect them. A league can reach a dead end with no error, no failed test, nothing red — it just silently never happens. That is the single biggest risk in this area and the reason Phase 0 below exists.

---

## 1. League Creation

**Canonical live path** (traced end-to-end, dashboard button → DB write):

```
RightControlPanel "Create League" → /create-league
  → CreateLeaguePageClient ("Primary Create League route... owns the simplified G30 flow")
    → CreateLeagueV2Client (wizard) → lib/create-league-v2/submit.ts
      → tournament? POST /api/tournament/create : POST /api/leagues
        → lib/league-creation/canonical/createLeagueHandler.ts
          → executeCanonicalLeagueCreation → createCanonicalLeagueInTransaction
             (one Prisma tx: League + settings + commissioner + draft + slots)
          → runPostCreateInitialization (LeagueDefaultsOrchestrator)
            → LeagueCreationInitializationService.runLeagueInitialization
              → LeagueBootstrapOrchestrator.runLeagueBootstrap
                 (per-sport scoring defaults, roster bootstrap, ensureLeagueDraftSetupDefaults)
```

**Format support — 10 of 12 registry formats are live end-to-end:** redraft, dynasty, keeper, best_ball, guillotine, survivor, tournament, salary_cap, zombie, big_brother all creatable today (`lib/draft-types/draftTypeRegistry.ts`, cross-checked against `format-engine.ts`, `create-league-v2/rules-engine.ts`, and `validateCreatePayload`, all confirmed live).

**Devy and C2C are *intentionally* not standalone formats** — `validateCreateLeague.ts` has an unconditional gate (`COLLEGE_FORMATS_NOT_OPEN`) with a comment: *"college formats are draft-only — dynasty carries the devy rounds... can never reach `ok: true`."* This is a shipped product decision, not a gap. Devy exists as `devyConfig` **inside** a dynasty league.

**What this correction fixes vs. the initial hypothesis:** the file names that looked like "competing implementations" mostly aren't:
- `server/routes/leagues/createLeague.ts`, `server/utils/validateCreateLeague.ts` — deliberate one-line re-export shims (self-documented) pointing at the one canonical handler.
- `lib/routes/createLeagueCanonical.ts` — not a route at all; a frontend redirect-target constant.
- `app/api/league/create/route.ts` — self-labeled **DEPRECATED** in its own source, but still live: it's the only path for Sleeper full-import creation and legacy wizard bootstraps, and it delegates ordinary manual creates through the same canonical pipeline. Still carries dead `isDevyRequested`/`isC2CRequested` branches (~lines 348-385, 1086-1148) that can never fire now that validation hard-blocks them.

**Two genuinely dead things found:**
- `lib/redraft-creation/create-redraft-league.ts` + `post-redraft-create.ts` + its two routes (`/api/leagues/redraft/create`, `/api/league/create/redraft`) — a fully built, separate "create a redraft league up front" pipeline with **zero frontend callers**. This makes sense once you see the Season Lifecycle section below: `RedraftSeason`/`RedraftRoster` actually get materialized **after draft completion**, not at league-creation time, via `syncCompletedDraftToRedraftSeason`. This pipeline appears to predate that design and was never wired to the new one.
- `lib/scoring-engine/ScoringEngineRegistry.ts` and `lib/roster-defaults/RosterTemplateResolver.ts` — dead abstraction layers, superseded by direct per-sport calls inside `LeagueBootstrapOrchestrator` / `lib/multi-sport/RosterTemplateService.ts`, never deleted.
- `platform-backend/` is **not deployed** — no build/start scripts, absent from the 2-service Railway production project, referenced only by two CI schema-readiness workflows and their own tests.

---

## 2. Draft

**Draft room:** real, live component tree (`app/drafts/[draftId]/page.tsx` → `DraftRoomPageClient`, ~30 subcomponents). An older `app/draft/components/` tree exists but appears superseded/unreferenced by the canonical redirect chain. Real-time updates are **adaptive HTTP polling** (2s during an active pick, 8s idle, 30s backgrounded) via `useLiveDraftSync` — not websockets. A spectator-only "big screen" view uses genuine SSE.

**Pick-advancement logic is real for every live format**, not stubbed: snake and linear share one resolver (`DraftOrderService.getSlotInRoundForOverall`, reverses on even rounds for snake only); auction has a full nomination/bid/budget/timer engine; keeper has real validation + pick-locking; slow draft has real pause-window/reminder automation. All confirmed wired into production code paths, not just tests.

**Data model — three parallel persistence systems exist:**
1. `DraftSession` + `DraftPick` — the live primary engine, one row per pick, fully resumable from DB state alone (`timerEndAt` + optimistic `version` lock, no in-memory state required).
2. `RedraftDraft` / `RedraftDraftPick` — a second, separate draft engine in the schema. **No caller found wiring it to any live route in this pass — flagged UNVERIFIED, needs a follow-up before anything is built on it.**
3. `MockDraft` / `MockDraftRoom` / `DraftRoomPickRecord` — a third, UI/mock-draft-specific cluster, explicitly self-documented as separate from the primary engine.

**Autopick cron exists but ships inert by default.** `app/api/cron/draft-tick/route.ts` is scheduled every minute via GitHub Actions and does real autopick + Sleeper-mirroring — but the autopick half is gated behind `DRAFT_TICK_CRON_ENABLED`, which is only ever set `true` in a test file, never in any tracked env config. Sleeper-mirroring runs unconditionally. Client-side polling is the de facto autopick mechanism today.

**Rookie draft order is computed correctly but not wired to the actual draft.** `computeRookieDraftOrder` (worst-to-first / reverse-max-PF, real standings query) is exposed via a commissioner UI and saved to `league.settings.rookie_draft_order` — but the function that actually builds the live draft's slot order (`buildSlotOrderForLeague`) never reads that setting; it only consults `draftOrderSlots` or the lottery. **A commissioner can pick an order and it silently does nothing.**

**Weighted draft lottery is fully built and correctly wired**, including a dynasty-year eligibility guard and a previously-measured-and-fixed RNG bias.

**Devy is a phase mode on the shared draft engine** (`DraftSession.devyConfig` tracks startup_vet → rookie → annual phases), not a separate system — but **annual phase advancement is admin-manual only**, nothing schedules it, and the devy settings panel is explicitly display-only per its own placeholder text.

**Keeper has two systems at different completeness:** the live-draft-room keeper panel actually locks picks on the board (built and working). The separate offseason `KeeperRecord` selection engine is more elaborate (eligibility, conflict resolution, a cron sweep) but its pick-forfeiture accounting (`KeeperPickAdjustment`) is **never written anywhere** — so a dynasty league always reports zero forfeited picks regardless of keeper cost rules.

**Draft → roster handoff is solid.** `completeDraftSession` → `finalizeRosterAssignments` writes `Roster.playerData` (read by `myTeam.ts`, `playerFinder.ts`) and, for redraft/non-dynasty leagues, `syncCompletedDraftToRedraftSeason` also materializes `RedraftRoster`/`RedraftRosterPlayer` for the season/schedule pipeline. This is the real explanation for why the upfront redraft-creation pipeline (§1) is orphaned — the season entities are built from the draft, not from league creation.

---

## 3. Regular Season → Playoffs

**Two parallel scoring pipelines exist for AF-native leagues**, and this is architecturally load-bearing, not incidental:
- **Redraft pipeline** (primary, actively developed): `RedraftSeason`/`RedraftRoster`/`RedraftMatchup`/`PlayerWeeklyScore`, cron-driven.
- **Generic League pipeline**: `WeeklyScore`/`TeamWeekResult`/`FantasyStanding` via `weeklyProcessor.ts`, triggered manually per league by a commissioner endpoint — this is what guillotine/survivor/zombie ride on for elimination triggers.

**Schedule generation: built and working, fully automatic.** Fires as a side effect of draft completion (`ensureScheduleForNewSeason`, idempotent), with a manual commissioner regenerate endpoint as a repair path.

**Weekly scoring: built and working via cron** (2-min live-tick + 5-min reconciliation, both GitHub-Actions-driven). Standings recompute correctly from completed matchups only. Two real bugs found in passing:
- `lib/redraft/redraftSeasonScoringRunner.ts` is dead code — its header comment claims it's "the pure orchestrator extracted from the score-sync route," but it has zero callers; the route it claims to serve doesn't call it.
- `lib/redraft/playerWeeklyScoreService.ts`'s team-defense points-allowed lookup queries `SportsGame` with no ordering and no freshest-row dedup — the same class of bug already fixed elsewhere in `liveScoresPage.ts` (memory: "SportsGame: 4 rows per fixture"), but not here.

**Playoffs: the bracket engine is fully built** — real seeding/tiebreakers/byes/reseeding/champion-crowning, DB-persisted, wired to the league's configured team count and start week. **But it is entirely commissioner-manual.** `RedraftSeason.status` reaches `regular_season_complete` and nothing ever reads that value to trigger bracket generation — a commissioner must POST every step by hand. A superseded legacy playoff engine (`lib/redraft/playoffEngine.ts`) is already dead and safely ignorable.

**Guillotine elimination fires correctly** as a real side effect of weekly-scoring finalization — but that finalization trigger itself is manual per league; the batch cron driver that would run it for all active leagues has no callers anywhere, i.e. it isn't scheduled.

**No dedicated end-of-season archive workflow exists** — an in-repo audit (`docs/redraft/SEASON_ARCHIVE_ARBITRATION_REPORT.md`) already says so, and separately, `archiveLeague()` can archive a league from any state (it bypasses its own completeness validation via a `force: true` flag).

**Two lifecycle state machines, reconciled at some boundaries but not all:** `RedraftSeason.status` (setup/active/regular_season_complete/playoffs/complete) and `League.lifecycleState` (setup→pre_draft→drafting→post_draft→in_season→playoffs→completed→offseason→renewal_pending→archived). They're kept in sync at the in_season→playoffs and playoffs→completed boundaries — **but not at completed→offseason** (see §4, this is the single biggest gap in the whole lifecycle).

---

## 4. Offseason

**Waivers/FAAB: fully built and working.** Real priority/FAAB/FCFS engine, immediate processing for FCFS claims, a real 5-minute cron for batch types, commissioner-editable settings. No gaps found.

**Trades: fully built and working** (`AfLeagueTrade` — propose/accept/reject/counter/vote/commissioner-review, real roster settlement, live-UI wired). Architecture debt worth flagging: **three parallel trade tables exist** (`AfLeagueTrade`, `RedraftTradeProposal`, `LeagueTrade`), and AF-native trade volume in production today is near zero — 109 of 110 leagues are imported (shadow) leagues, not native ones. Not a build gap, but worth resolving before native volume grows.

**🛑 Keeper carryover is the single most consequential gap in this whole report.** The keeper *selection* UI and engine are built and working — a manager can pick their keepers, a `KeeperRecord` gets written. But `executeSeasonCarryover()`, the function that actually copies a locked keeper selection onto next season's roster, **has zero callers anywhere in the codebase.** Keeper selections are recorded and then go nowhere. Separately, `triggerKeeperOffseason()` (opens the keeper window at season end) also has zero callers, and the keeper-deadline sweep cron is defined but **absent from `cron-schedule.json`** — never actually scheduled. Net effect, confirmed independently by an in-repo audit (`docs/keeper-war-room-audit.md`): keeper/dynasty leagues in production today have zero rows in these tables, because the whole offseason half of the feature is inert.

**Dynasty full-roster carryover "works," but only by omission** — season renewal just doesn't reset non-redraft rosters, which happens to produce the right outcome without being a deliberate carry step.

**Rookie draft order for next season:** computed correctly (§2) but, as noted there, never actually reaches the live draft's slot order — this is the same root cause blocking both in-season rookie drafts and offseason dynasty rollover from being end-to-end correct.

**Season renewal is fully built and working** — genuinely in-place continuation of the same `League` row (not a new object): archives the completed season to `LeagueSeason`, resets team stats and (for redraft only) roster data, advances the season number, handles orphaned managers, flags dispersal-draft eligibility. This is one of the most complete pieces in the whole lifecycle.

**Salary cap: backend fully built, missing its UI.** A real offseason calendar (lock→expiration→rollover→extension→tag→draft→fa_open→in_season) with real cap-space math exists. Franchise tag has a working API/service layer but **zero frontend caller** — a commissioner can't use it without a hand-crafted API request.

**Fully dead:** `lib/dynasty-core/offseasonEngine.ts` (a more elaborate phase-lock system than what's actually live — zero importers, worth a deliberate decision rather than silent abandonment) and roster-cut enforcement (audit-only, and the audit function itself is never invoked because the scheduled worker calls a different entrypoint that skips it).

---

## 5. "Commissioner OS" — a 4-way name collision, and why it doesn't solve this problem

Before planning around any "OS" initiative: **none of them are actually building the create→draft→season→offseason loop.** That loop lives in ordinary app/lib code traced above. "Commissioner OS" currently names four unrelated things in this repo:

1. `lib/decision-os/commissioner-health/` — a real, live decision engine (league-health signals).
2. `app/commissioner-os/` + `lib/commissioner-ui/` — the consumer-facing UI. Per the Decision-OS roadmap doc, this is **flatlined at 35%**, defaults to `demo` data mode in production, and — independently confirmed by reading the route shell directly — is **completely ungated**: no auth check, no commissioner check, no entitlement check anywhere in `layout.tsx`/`page.tsx`.
3. `docs/commissioner-os/` — a B2B multi-tenant SaaS plan to license commissioner tooling to *other* fantasy platforms. Explicitly out of scope for this problem (their own handoff doc: *"we do not build a draft board — we integrate with Sleeper/ESPN/Yahoo"*). Substantially landed on `main` already (tenancy schema, `lib/domain/`, 67 tests) via a rebased branch.
4. An older, orphaned July B2C "Commissioner + User OS" plan with no links to the other three.

The `commish-os/phase-0-1b` branch referenced in the pending-handoff doc is **not** the tenancy work — it's 536 commits stale and is being used as an ambient staging branch for unrelated fixes. Any doc still citing it as current context is stale.

**Practical takeaway:** treat "Commissioner OS" as a documentation/naming problem to clean up (Phase 5 below), not as infrastructure to build on for this project.

---

## Project Plan

### Phase 0 — Close the silent seams (do this first, before any new feature work)

**Goal:** a league can go create → draft → full season → playoffs → season-end → offseason → next season's draft with **no silent dead ends**, for redraft, dynasty, and keeper leagues at minimum.

This is the highest-leverage phase because every item is "wire an already-working function to its caller," not new engineering — and every item currently fails silently (no error, no red test), which is exactly the failure mode this repo's own CLAUDE.md spends the most words warning about.

| # | Step | Why it matters |
|---|---|---|
| 0.1 | Call `enterRedraftOffseason()` from the season-finalize route so `completed → offseason` actually happens, and `LeagueSeason`/`FranchiseSeason` archive rows get written from the live product | Without this, a "completed" league just sits there forever; the offseason state formally exists but nothing enters it |
| 0.2 | Call `executeSeasonCarryover()` so locked keeper selections land on next season's roster | **Highest priority single fix** — keeper/dynasty leagues cannot function correctly in production without this |
| 0.3 | Read `league.settings.rookie_draft_order` inside `buildSlotOrderForLeague` so the commissioner's chosen order actually determines the live draft | Currently a commissioner setting that silently does nothing |
| 0.4 | ✅ **Decision: auto-generate.** `advanceNflRedraftScheduleWeek` now calls `generateNflRedraftPlayoffRuntimeBracket` the moment a season transitions into `regular_season_complete` | Week advancement was already commissioner-gated and already refused while any matchup was incomplete — a human already made the "season's over" call; auto-generating just removes a redundant second click. Bracket isn't locked by default, so `regenerate_bracket` remains available if standings need correcting |
| 0.5 | ✅ Scheduled `processKeeperDeadlines` (`GET /api/keeper/session`, hourly, `cron-schedule.json`). ⚠ `processAllActiveLeaguesForWeek` **deliberately left unscheduled** — see below | Scheduling the batch driver blind would be actively unsafe, not just incomplete |
| 0.6 | ✅ Fixed the DST/points-allowed `SportsGame` lookup in `playerWeeklyScoreService.ts` to reuse `pickFreshestSourceRows` from `lib/sports-live-scores-service.ts` (the same dedup `liveScoresPage.ts` already proved) | A live scoring-correctness bug, not a lifecycle gap, but cheap and adjacent |
| 0.7 | ✅ Deleted 12 confirmed-dead files (see note below); trimmed `create-redraft-league.ts` down to its one live export rather than deleting the whole file | Dead code that looks live invites future sessions to build on ghosts |

**Acceptance criteria:** one integration test that drives a league through every transition above and asserts the DB state changed at each step (not just that an endpoint returned 200) — create → draft → schedule → weekly scoring → playoffs → finalize → offseason → keeper carryover → next rookie draft in the correct order.

**What 0.7 actually deleted, and the one catch worth recording.** The original research called `lib/redraft-creation/create-redraft-league.ts` orphaned wholesale — re-verification before deletion found that was only half true: the file's big orchestration function (`createRedraftLeagueInTransaction`, backing the two dead routes) genuinely was dead, but the same file also exports `soccerPipelineToPrismaVariant`, which `lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts` — the LIVE canonical pipeline — imports directly. Deleting the whole file would have broken league creation. Fixed by trimming the file down to just that one export rather than deleting it. The lesson generalizes: "this pipeline is dead" is a claim about specific exports, not a file — always re-check every export's importers individually before deleting a file wholesale, especially one a research pass already flagged as "mostly dead."

Deleted, confirmed dead on all 4 import forms plus a check for barrel/index re-export facades (the exact trap that would hide a real importer from a plain path grep):
- `lib/redraft-creation/post-redraft-create.ts` + its two routes (`app/api/leagues/redraft/create/route.ts`, `app/api/league/create/redraft/route.ts`)
- `lib/redraft/redraftSeasonScoringRunner.ts`
- `lib/scoring-engine/ScoringEngineRegistry.ts` + `lib/scoring-engine/UnifiedScoringConfigService.ts` (its header claimed a re-export barrel at `lib/scoring-engine/index.ts` — that file does not exist, so the claim was stale documentation, not a live path)
- `lib/roster-defaults/RosterTemplateResolver.ts` + its dedicated test file (`__tests__/roster-template-resolver-variants.test.ts`, which existed solely to test it)
- `lib/dynasty-core/offseasonEngine.ts`
- `lib/redraft/playoffEngine.ts` + two test files that existed solely to test it (`__tests__/redraft/playoff-advance.test.ts`, `__tests__/redraft/playoff-finalize.test.ts`) — the latter's route-level assertions looked like they covered the live finalize route, but passed only because the string `advancePlayoffWinners` happens to appear in a comment in the current route; real behavioral coverage of that route now lives in `__tests__/redraft/season-finalize-offseason-wiring.test.ts` (added in Phase 0.1)

**Why `processAllActiveLeaguesForWeek` was not scheduled (0.5).** It takes an explicit `(season, week)` pair and applies it to *every* native league in one pass (`take: 200`) — it does not resolve each league's own current week from its own sport/schedule. Confirmed by reading its only other caller, `POST /api/leagues/[leagueId]/scoring/process-week`: `week` there is commissioner-supplied with no computed default beyond a bare `|| 1`. There is no "what week is this specific league actually on" resolver anywhere in this pipeline for it to call instead. Wiring a cron around it today would mean guessing one global week and applying it to every native guillotine/survivor/zombie league regardless of sport or start date — silently writing wrong `WeeklyScore`/`TeamWeekResult` rows into leagues whose real current week differs, which is worse than the present state (nothing runs it, so those formats simply require a manual commissioner trigger). Building a correct per-league week resolver is real, separate work — a candidate for Phase 3, not a one-line cron addition.

### Phase 1 — League creation hardening

- ❌ **Original item retracted after tracing the actual control flow — do NOT strip these branches.** The plan (and the original research) assumed `COLLEGE_FORMATS_NOT_OPEN` blocks devy/c2c everywhere, making `app/api/league/create/route.ts`'s `isDevyRequested`/`isC2CRequested` handling (lines ~348-385, 797, 819-839) dead. It doesn't. That gate lives in `validateCreatePayload`, which this route only calls inside the `platform === 'manual' && !createFromSleeperImport` branch (line 557). For every OTHER path — i.e., a Sleeper full-import continuation — the route skips that gate entirely and the devy/c2c branches actively build real `devyConfig.devyRounds`/`c2cConfig.collegeRounds`. **Correct statement of the actual rule:** devy/c2c leagues cannot be *originated* bare via the manual creation API, but importing an *existing* Sleeper devy/c2c league remains fully live. Stripping the branches would have broken that import path. Left in place, corrected here rather than silently reversed.
- ✅ **Decision: delete, per user direction 2026-09-06.** Deleted the whole ecosystem, not just the directory — investigation found `platform-backend/` was the small part of a larger dead unit: a self-contained "AF foundation" shadow schema (`af_leagues`/`af_domain_events`/`af_job_runs`, none of which exist in the real `prisma/schema.prisma` or are read by any live code) that had its setup steps embedded inside the *shared* `playwright.yml` and `performance-budget.yml` CI workflows. Removed: `platform-backend/` (28 files), `docs/backend/ALLFANTASY_BACKEND_FOUNDATION.sql`, 4 scripts (`apply-af-foundation-if-needed.ts`, `smoke-platform-backend-postgres.ts`, `verify-platform-backend-indexes.ts`, `scripts/sql/platform-backend-indexes.sql`), 3 test files, 2 dedicated CI workflow files, 9 package.json scripts, and the platform-backend-specific steps from inside the two shared workflows (leaving the rest of those workflows untouched). First commit to `platform-backend/` was 2026-04-13 with the message "update"; it then sat untouched for 5 months until an unrelated barrel-cleanup sweep incidentally touched it the day before this cleanup.

### Phase 2 — Draft experience completion

- Decide on `DRAFT_TICK_CRON_ENABLED`: turn it on (client polling is a proven fallback) or formally retire the server-autopick cron path.
- ✅ **Investigated — this is a partial feature, not dead code; leaving it as-is.** `RedraftDraft`/`RedraftDraftPick`/`RedraftDraftQueue` DO have live callers (`app/league/[leagueId]/draft-hq/page.tsx` reads a manager's "prepared queue" shortlist; `app/api/leagues/[leagueId]/roster/draft-picks/route.ts` reads pick history) — the original "UNVERIFIED SCOPE" flag undersold it. But nothing anywhere writes to any of the three models, so both read sites are guaranteed to always return empty (`findFirst` on a table with zero rows is always `null`) — a built read-side with no write-side ever shipped, not legacy code left behind. Deleting the models would need a schema migration, out of scope for a cleanup pass; deleting just the two read sites would only remove a harmless, silently-empty UI section. Recommend treating this as a real backlog item — either finish the write side (a genuine "prepared draft queue" feature) or remove the dead read sites — rather than acting on it inside this pass.
- ⚠ **Investigated, not attempted — this is net-new feature design, not a wiring fix, unlike everything else in this doc.** No "advance to the next devy phase" function exists anywhere to schedule — `DevyLifecycleAutomation.ts` only handles player-rights promotion, a different concern. Building one means designing how resetting the league's single `DraftSession` row (unique per league) for the next phase/year interacts with the previous phase's `DraftPick` history, plus real calendar-based triggering logic. Similarly, `DevyDraftsPanel`'s gap (self-documented in its own placeholder text) is that the underlying `DevyLeagueConfigShape` has no fields for draft clocks or depleted-pick behavior at all — UI can't expose config the engine doesn't store yet. Both need product/design input before implementation, not just a caller wired to an existing function. Left as a backlog item.
- ✅ Wired `KeeperPickAdjustment` writes into `executeSeasonCarryover` — a round-cost keeper now writes an adjustment row and appears in `CarryoverResult.byTeam[].forfeited` (a field that existed in the type but was never populated); an auction-cost keeper (no `costRound`) correctly forfeits nothing, since it pays auction dollars instead of a pick. `getKeeperDraftOrder` already read this table with zero writers before this.

### Phase 3 — Season lifecycle completion

- ✅ **Fixed `archiveLeague()`'s real defects — narrower than the audit feared, because the risk it worried about didn't apply.** The audit hesitated to touch this because `leagueLifecycleService.ts` is shared broadly — but `archiveLeague`'s `forceStateTransition` call has exactly one caller (itself), so the fix was fully contained. Also found `force: true` wasn't bypassing a completeness gate at all — `archived` is already a valid `TRANSITIONS` target from every other state, so `force`'s only real effect was skipping the `current === next` idempotency check. Switched to `transitionLeagueStateInTransaction` (atomic, `applied: false` no-op when already archived) instead of the old non-transactional force-write. Mid-season archiving remains fully allowed on purpose (an abandoned/broken league needs to be archivable without "finishing" it first) — this fix is about correctness of the write, not gating who may archive when. A sharper UI warning specifically for mid-season archives is a separate, real UX decision left undone (documented, not implemented).
- ✅ **Two-machine reconciliation — decision: keep both, by design, not a defect to unify.** `RedraftSeason.status` tracks one season's bounded internal lifecycle (an immutable row once the season ends); `League.lifecycleState` tracks the league's ongoing multi-season lifecycle (spans the gap between seasons, through renewal). They're only meant to overlap at specific boundaries (in_season/playoffs/completed), and Phase 0.1 + 0.4 this session already confirmed those boundaries stay reconciled. Unifying them would mean collapsing two genuinely different scopes into one, which is the wrong direction, not a missing feature.
- ❌ **Original item retracted — investigation found a real, higher-value bug instead of what was scoped.** Dispatched a research pass on guillotine/survivor/zombie's actual week-tracking before building a resolver, and the premise didn't hold uniformly: **survivor already has a complete, independently-scheduled weekly-scoring pipeline** (needs nothing). **Zombie's equivalent pipeline is fully built and already on a 5-minute cron — but has never fired on real data**, because `checkAllMatchupsComplete` checked `status === 'complete'` literally while every real writer sets `'final'`. ✅ Fixed (same status normalization `redraftMatchupSource.ts` already uses), verified with a positive control. **Guillotine remains genuinely gapped** — it has no maintained per-league week signal at all (`RedraftSeason.currentWeek` is NFL-redraft-only and commissioner-click-driven; `GuillotineSeason.currentScoringPeriod` records history but drives nothing) — but closing that needs a real sport-aware schedule resolver or a driven `currentScoringPeriod`, materially bigger than "a resolver plus a caller." Left as a documented backlog item rather than built blind.

### Phase 4 — Offseason completion

- ✅ **Already done.** `dynasty-core/offseasonEngine.ts` was one of the 12 files deleted in Phase 0.7.
- ⚠ **Franchise Tag UI — investigated, not built; needs a priority call.** There are genuinely **two separate franchise-tag systems**: `lib/salary-cap/FranchiseTagService.ts` (`PlayerContract`, general salary-cap leagues — the one this plan item meant) and `lib/idp/capEngine.ts::processFranchiseTag` (`IDPSalaryRecord`, IDP leagues specifically — a different model, different config). The IDP one turned out to be a **fully working reference implementation**: `app/idp/components/IDPPlayerModal.tsx` already has a real "Apply Tag" dialog wired end-to-end via `PATCH /api/idp/cap`. That would be the template for building the general-league version. **But** `IDPPlayerModal.tsx`'s own code comment states all six IDP cap tables (`IDPSalaryRecord`, `IDPCapConfig`, `IDPDeadMoney`, `IDPCapTransaction`, `IDPCapProjection`, `IdpLeagueConfig`) **hold zero rows in production** — the reference implementation itself has never been exercised by a real league. Whether the general (non-IDP) salary-cap system has any real production usage is unverified (no DB access from this pass). Building a full modal+dialog+button UI is a reasonably-scoped, precedented task — but doing it blind for a system that might be as dormant as its own reference implementation risks real effort for zero users. Recommend confirming there's actual salary-cap league usage worth the build before investing in it.
- ⚠ **Roster-cut enforcement — investigated, not built; this is product design, not wiring.** `auditDynastyCutdowns()` (`lib/league/keeper-engine.ts`) is a real, correct function — but it only *counts* over-limit rosters and returns the count; it was never wired to notify anyone, let alone force a cut, even before considering that its caller (`runWeeklyLeagueAutomation`) is itself never invoked by the scheduled worker. There is no "enforcement" function anywhere to wire — building one means deciding which player gets cut and by what criteria, when it's safe to run, and how the affected manager is told, none of which is implied by the existing code. Also: swapping the scheduled worker from `runScoringWorker` to `runWeeklyLeagueAutomation` to pick up the audit would silently also turn on dormant artifact-generation side effects (`generateWeeklyLeagueArtifacts`, `generateDraftRecapArtifact`) for every league on every scoring run — a bigger, separate behavior change. Left as a backlog item requiring product input.
- ⚠ **Trade table consolidation — not attempted; this is a schema-level decision, out of scope for this pass.** Consolidating `AfLeagueTrade`/`RedraftTradeProposal`/`LeagueTrade` is a real data-migration project, not a code wiring fix. Flagging for your explicit call rather than touching schema unprompted.

### Phase 5 — Commissioner tooling untangling (lower priority, cross-cutting)

- ✅ **Namespaced all four "Commissioner OS" efforts.** Added an explicit disambiguation block to `docs/decision-os/OS_INVENTORY_AND_ROADMAP.md` (the closest thing to a canonical index) naming all four and what each does; added a matching pointer to `docs/commissioner-os/CLAUDE.md` (the B2B product); marked the two July docs (`docs/os/B2C_COMMISSIONER_USER_OS_PROJECT_PLAN.md`, `docs/os/COMMISSIONER_OS_SURFACE_ALIGNMENT.md`) as historical/superseded with pointers to current state.
- ✅ **Gated `/commissioner-os`.** Added a session check to `app/commissioner-os/layout.tsx` — unauthenticated visitors now redirect to `/login` before the adapter is ever called. Deliberately did **not** add a "commissioner of at least one league" narrowing on top: this app already computes `isCommissioner` at least 4 different, disagreeing ways across the codebase, and picking one for this gate is its own decision rather than a fifth inconsistent definition to add blind. Verified with tests plus a positive control.
- ⚠ **Demo-mode transport decision — not attempted, needs your call.** The Decision-OS roadmap's own R5 recommendation is unresolved between two real options: (A) replace `lib/commissioner-ui`'s HTTP-to-`lib/decision-os` transport with direct imports, or (B) stand up the service properly. Both are meaningful architectural changes on their own, not a quick wire-up — flagging rather than picking one for you.

---

## Recommended starting point

Start with **Phase 0**. It's the cheapest phase, it's entirely "connect two already-working things," and it's the difference between "this feature area is basically done" and "this feature area silently breaks the moment a real dynasty/keeper league tries to run a full year." Everything in Phases 1-5 is safe to sequence after that without risking new work sitting on top of a broken handoff.
