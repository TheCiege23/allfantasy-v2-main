# G12 — Draft Completion Audit

**Date:** 2026-06-27
**Goal:** Verify a commissioner can complete a draft and have the league transition
into a playable season — the production blocker every league concept depends on.
**Scope:** Draft **completion → playable season** path (not the full draft-room UX,
which is covered by the draft-runtime governance docs).

**Verdict:** The completion path is **production-sound and draft-type-agnostic**. The
G11 `createdAt` schedule bug (the one real defect) was already fixed in G11 Phase 4G.
This audit found and fixed **2 stale registry tests** and added a **draft-type-agnostic
finalization contract** test. No engine/logic changes were required. **NFL held at 93.**

---

## Draft architecture map

### Models (Prisma)
| Model | Role |
|---|---|
| `DraftSession` (`draft_sessions`) | One per league (`leagueId @unique`). Holds `status`, `draftType`, `rounds`, `teamCount`, `slotOrder` (JSON draft order), auction (`auctionBudgetPerTeam`/`auctionBudgets`/`auctionState`), keeper/devy/c2c/dispersal config, `tradedPicks` JSON, timer state, `completedAt`. |
| `DraftPick` (`draft_picks`) | One per pick. `overall`, `round`, `slot`, `rosterId`, `playerId`, `playerName`, `position`, `assetType`, `amount` (auction), `tradedPickMeta`, `pickMetadata`. `@@unique([sessionId, overall])`. |
| `DraftPickAuditLog` | Commissioner pick-editor audit trail. |
| `DraftPickTradeProposal` | In-draft pick-trade proposals; accept writes `session.tradedPicks`. |
| Draft order | `DraftSession.slotOrder` JSON: `{ slot, rosterId, displayName }[]`. |
| Traded picks | `DraftSession.tradedPicks` JSON; resolved at pick time via `PickOwnershipResolver`. |
| Auction values | `DraftPick.amount` + `DraftSession.auctionState`/`auctionBudgets`. |
| Offline picks | Same `DraftPick` rows; session flagged offline (execution mode). |

### Draft type system (the plugin layer)
- `lib/draft-types/draftTypeRegistry.ts` — **single source of truth** for create/validate/UI.
  Collapses every variant to one of **3 engine cores**: `snake | linear | auction`
  (`mapCanonicalDraftTypeToEngineCore`). Execution modes (`offline`, `auto`, `team`) and
  timing/practice variants (`slow_draft`, `mock_draft`) and specialty variants
  (`devy_*`, `c2c_*`) all map down to a core.
- `lib/draft-engine/DraftEngineRegistry.ts` — per-sport defaults (rounds, timer, supported types).
- Pick-order math: `lib/live-draft-engine/DraftOrderService.ts` + `lib/draft/draftOrder.ts`
  (snake reverses even rounds; linear fixed; 3RR reverses rounds 2–3 then snakes).

### Completion path (draft-type agnostic by construction)
```
PickSubmissionService.submitPick (overall >= totalPicks)
  └─> completeDraftSession(leagueId)                        [DraftSessionService.ts]
        ├─ $transaction:
        │    ├─ guard: isDraftBoardFull (idempotent: already 'completed' → no-op)
        │    ├─ DraftSession.status = 'completed', clear timers, completedAt, version++
        │    └─ applyPostDraftLifecycleInTransaction         [leagueLifecycleService.ts]
        │         └─ league.lifecycleState: pre_draft/setup/drafting → post_draft
        │            (already post_draft/in_season/… → null, idempotent)
        └─ runPostDraftFinalizationArtifacts(leagueId)       [postDraftFinalizeArtifacts.ts]
             ├─ finalizeRosterAssignments                    [RosterAssignmentService.ts]
             │    → merge picks into Roster.playerData + materialize starter/bench
             │      lineup via sport template (does NOT clobber existing lineups)
             ├─ syncCompletedDraftToRedraftSeason            [finalizeDraftToRedraftSeason.ts]
             │    → RedraftSeason (status 'active') + RedraftRoster + RedraftRosterPlayer
             │    → ensureScheduleForNewSeason (only if no matchups exist yet)
             └─ computeAndPersistDraftRankings
```
Self-heal: `syncPostDraftArtifactsIfCompletedThrottled` (60s) re-materializes on roster
read; `repairDraftCompletionIfBoardFull` completes a stuck full board.

**Key property:** none of `completeDraftSession`, `finalizeRosterAssignments`, or
`syncCompletedDraftToRedraftSeason` branch on `draftType`. They consume `DraftPick`
rows + `status`. Snake/linear/auction/auto/offline differ only in *how picks are
produced* (slot order, bids, autopick) — completion is shared Core. This is the
plugin-architecture guarantee: a new draft type is a pick-producer, not a fork.

---

## Confirmed completion behaviors (audit checklist)
| # | Item | Status | Evidence |
|---|---|---|---|
| 4 | Players assigned to correct roster | ✅ | `finalizeRosterAssignments` buckets picks by `rosterId`; `syncCompletedDraftToRedraftSeason` maps generic roster → RedraftRoster by owner identity. |
| 4 | Slots assigned correctly (FLEX/SF/DEF/K/IDP/bench) | ✅ | `assignPicksToSlots` + `buildOrderedRosterSlots` (redraft-core-contract test); FLEX/SF spillover + bench overflow. |
| 4 | Undrafted → free agents/waivers | ✅ (computed) | `redraftFreeAgentPool` = ADP pool **minus** rostered. No materialization write — deterministic, no duplication. |
| 4 | Commissioner schedule preserved | ✅ | `ensureScheduleForNewSeason` returns early when `redraftMatchup.count > 0`. |
| 4 | Auto-schedule only when none exists | ✅ | Same count guard; idempotent. |
| 4 | Season status changes | ✅ | RedraftSeason `status='active'`. |
| 4 | League status changes | ✅ | `lifecycleState → post_draft` (LeagueShell promotes Matchup over Draft). |
| 5 | Finalization deterministic + idempotent | ✅ | Re-run: existing lineups not clobbered; active RedraftRosterPlayer not duplicated; `status='completed'` re-entry is a no-op. |
| 6 | Schedule uses valid fields only, no dup | ✅ | **Fixed in G11 4G**: `orderBy { id: 'asc' }` (was non-existent `createdAt`). Count guard prevents dup. |
| 7 | DEF/ST, K, FLEX, SF, bench, IR, taxi | ✅ | slot order + `normalizeSlotType` (taxi/ir/devy); IR not drafted. |
| 8 | No raw `nfl:def:<TEAM>` name leak | ✅ | Finalize stores `pick.playerName` ("KC Defense") as the name; raw id only in `playerId`. New contract test asserts it. |
| 9 | Works with live scoring pipeline | ✅ | RedraftSeason 'active' + RedraftRosterPlayer starters feed the G11 canonical score adapter / matchup-center (G11 Phase 4F browser proof). |

---

## Gap table (draft type × readiness)
| Draft type | Engine core | Create UI | Completion engine | Test coverage | Production readiness |
|---|---|---|---|---|---|
| **Snake** | snake | ✅ | ✅ shared finalize | ✅ order + 3RR + finalize contract | **Production** |
| **Linear** | linear | ✅ | ✅ shared finalize | ✅ order + finalize contract | **Production** |
| **Auction** | auction | ✅ | ✅ shared finalize (amount ignored by roster sync) | ✅ finalize contract (amount not written) + AuctionEngine unit | **Production** (completion); auction *runtime* bidding owned by AuctionEngine, separate audit |
| **Auto** | snake | ✅ | ✅ shared finalize | ⚠️ produces standard DraftPick rows; autopick queue tested (af-pro) | **Production** for completion; autopick selection = G13 deepening |
| **Offline** | snake | ✅ | ✅ shared finalize | ⚠️ execution-mode flag only; no offline-specific completion test | **Production** for completion (same DraftPick path) |
| slow_draft / mock_draft | snake (→snake/linear) | ✅ redraft/keeper | ✅ shared finalize | ✅ registry matrix | Production (timing variant of snake) |
| devy_* / c2c_* | snake/linear/auction | ✅ (devy/c2c) | ✅ shared finalize | ✅ matrix + c2c/devy suites | Concept-gated; completion shared |

Do **not** claim auction *bidding runtime*, dispersal, or specialty *pools* are fully
production-proven from this audit — only the **completion → season** path is in scope and
is type-agnostic.

---

## Findings & changes (this audit)
1. **Stale test — `draft-type-support-matrix.test.ts`.** Asserted `slow_draft` is NOT a
   redraft draft type. The registry intentionally added `slow_draft`+`mock_draft` to
   `DRAFT_TYPES_REDRAFT` on 2026-06-12 ("fix: add nfl ncaaf redraft defaults"); the
   test (2026-04-20) lagged. The passing "format-engine mirrors registry" test confirms
   the registries are internally consistent. **Fixed** the assertion to accept
   slow_draft/mock_draft and reject an out-of-family id (`devy_snake`).
2. **Stale test — `draft-type-startup-allowlist.test.ts`.** Same root cause via the
   delegating `getAllowedDraftTypesForLeagueType`. **Fixed** to the current redraft family
   `['snake','linear','auction','slow_draft','mock_draft']`.
3. **New test — `__tests__/redraft/draft-finalize-contract.test.ts` (5).** Pins the
   draft-type-agnostic contract: identical picks → identical RedraftRosterPlayer writes
   for snake/linear/auction; auction `amount` not written to roster rows; DEF/ST stored
   with readable name (no `nfl:def` leak); only drafted players materialized; empty
   pick-editor rows skipped.
4. **Flake (not a bug) — `af-pro-queue-gating.test.ts`.** First `await import()` of
   `SlowDraftRuntimeService` in a large batch run exceeds the 30s testTimeout (cold
   transform cost on this Windows repo); passes 10/10 in isolation. No logic change.

**Test result:** G12-relevant set **37 files / 504 tests green** (incl. full `__tests__/redraft`).

---

## Readiness
**NFL held at 93 / Overall 90.** This audit removes uncertainty on a major blocker
(draft completion is type-agnostic, idempotent, schedule-safe) and fixes stale tests, but
per the readiness-credit rule a **browser proof of a full draft → playable season** flow
is required before crediting a 93→94 move. Remaining for a future pass (G13):
- Browser proof: complete a real seeded draft → roster tab shows players → matchup tab +
  schedule exist → no dup matchups → live scoring ticks → zero staging residue.
- Deepen auction *bidding runtime*, auto autopick *selection quality*, and offline entry.
- `finalizeRosterAssignments` materializes lineups only when a sport template resolves —
  audit template coverage across all concepts (devy/c2c/idp).
