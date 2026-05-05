# Live draft engine map (AllFantasy)

This document maps **production** live-draft pieces in this repo: **Neon/Postgres + Prisma**, server-authoritative sessions, and transactional pick submission. It uses **actual model and file names** from the codebase — not hypothetical alternate schemas.

---

## MVP-ready production path (launch)

**MVP-ready** for browser QA means: the live **DraftSession** / **DraftPick** engine, **DraftRoom** client wiring, pool/sort/stat UI, and cron-backed AI ADP recompute — **not** web push or **`DraftQueueEntry`** parity (see §9).

| Area | Production modules / routes |
|------|-----------------------------|
| Pick authority | **`PickSubmissionService.submitPick`**, **`DraftSession.timerEndAt`** reset, **`processExpiredDraftPicks`** |
| Queue | **`DraftQueue.order`** JSON (active path); AF Pro + **`Roster.settings.aiManageDraftQueueEnabled`**, **`planDraftQueueAiReorder`** (`lib/live-draft-engine/draftQueueAiReorder.ts`), **`POST /api/leagues/[leagueId]/draft/queue/ai-reorder`** |
| NPC autopick | **`assignNpcDraftPersonality`** / **`decideDraftPickWithScores`** (`lib/live-draft-engine/npcDraftPersonality.ts`) — deterministic; no LLM required at pick time |
| AI ADP | Daily **`GET`/`POST /api/cron/recompute-allfantasy-adp`** with **`requireCronAuth`** (`CRON_SECRET` / headers per `app/api/cron/_auth.ts`) |
| DraftRoom UI | **`DraftRoomPageClient`**: **`GET .../draft/session`**, **`GET .../draft/live-sync`**, **`POST .../draft/pick`**, **`GET`/`PUT .../draft/queue`**, **`POST .../draft/queue/ai-reorder`**, **`GET .../draft/pool`**, **`GET`/`POST .../draft/chat`**; **`timerEndAt`** drives countdown; **`DRAFT_PICK_STALE_OVERALL`** / **`DRAFT_PICK_RACE_RETRY`** → **`mergeDraftSessionSnapshot`**. **UX (2026-05):** snake/linear drop the extra **`DraftTeamStrip`** (auction keeps it); premium queue folds Draft Intelligence + AI queue controls; **`ResponsiveNavSystem`** hides the global Chimmy FAB on `/draft/*`; **`WarRoomPopup`** trigger anchors bottom-left on redraft snake. |
| ADP vs AI ADP in UI | **`resolvePlayerPoolAdpColumns`** (`lib/draft-room/playerPoolAdpColumns.ts`) — labels/tooltips from **`adpReadinessCopy`**; AI ADP sort uses **`aiAdp` only** (no silent fallback to system ADP in **`sortValueForKey`**) |
| Rookie filter | **`isDraftRoomRookie`** / **`getDraftRoomRookieDataState`** (`lib/draft-room/draftPlayerRookie.ts`) consumed by **`isRookieEligibleForFilter`** (`rookieFilterPredicate.ts`) |
| Position pill counts | **`poolPlayerMatchesPositionPill`** / **`getDraftRoomPositionGroupCounts`** (`lib/draft-room/draftPoolPositionGroups.ts`) — alias positions **PK→K**, **DEF/D/ST→DST** |
| Sport pool grid | **`SleeperPoolTable`** + **`buildSleeperPoolTableLayout`** → **`draftSportStatColumns`** |

**Manual browser QA:** After launch gate tests pass, run **`docs/draft-room-manual-qa-runbook.md`** (two-browser scenarios, stale pick, timer, queue, stat table, cron smoke).

**Dashboard shell:** Selecting a league on **`/dashboard`** (`?leagueId=`) embeds the same **`LeagueShell`** hub in the center panel via **`/league/[id]?embed=1`** (see **`SelectedLeagueHomePanel`**, **`AppShell`** `embedCenterOnly`). Draft room entry still uses **`/draft/room/[draftId]`** explicitly.

**Pre-draft checklist:** **`DraftValidationOrchestrator`** aligns roster/scoring checks with **`getEffectiveLeagueRosterTemplate`** and **`League.scoring` / `scoringPresetId` / settings**. Commissioners can apply defaults via **`POST /api/leagues/[leagueId]/draft/fix-setup`**; post-create bootstrap calls **`ensureLeagueDraftSetupDefaults`**.

---

## 1. Database models (Prisma)

| Model | Table | Purpose |
|-------|-------|---------|
| `DraftSession` | `draft_sessions` | One session per league (`leagueId` unique). Holds `status`, `draftType`, `rounds`, `teamCount`, **`timerSeconds`**, **`timerEndAt`** (UTC expiry for current pick), pause/overnight fields, **`slotOrder`** JSON (draft order), **`nextOverallPick`**, **`currentRoundNum`**, **`tradedPicks`** JSON (pick-trade ownership overlays), keeper/devy/C2C JSON, auction fields, `startedAt` / `completedAt`, `sportType`, **`commissionerAiManagers`** JSON, trade/timer behavior flags. |
| `DraftPick` | `draft_picks` | One row per selection. **`@@unique([sessionId, overall])`** prevents double-fill of the same pick slot. `rosterId` = picking team for this selection; **`originalRosterId`** = slot’s original owner before trades; **`tradedPickMeta`** JSON for UI; `source` (`user`, `auto`, etc.); `playerId`, names, position, team. |
| `DraftPickTradeProposal` | `draft_pick_trade_proposals` | In-draft pick trade offers (`pending` → accepted/rejected). Acceptance feeds **`DraftSession.tradedPicks`**. |
| `DraftQueue` | `draft_queues` | Legacy per-user queue: **`order`** JSON array of queued players. |
| `DraftQueueEntry` | `draft_queue_entries` | Row-based queue entries (newer UI path). |
| `DraftChatMessage` | `draft_chat_messages` | Draft room chat lines (`messageType`, `metadata`). |
| `DraftPickAuditLog` | `draft_pick_audit_log` | Commissioner pick edits / audits. |
| `AiManagerAuditLog` | `ai_manager_audit_log` | Orphan/NPC AI manager actions. |

**Not separate “live” tables:** There is **no** parallel `draft_sessions_v2` — evolve **`DraftSession` / `DraftPick`** in place.

---

## 2. Timer UX vs schema (`current_pick_started_at`)

The schema stores:

- **`timerEndAt`**: UTC instant when the current pick expires (when `status === in_progress'` and not in overnight freeze).
- **`timerSeconds`**: Per-pick duration used when resetting after a pick (`PickSubmissionService` uses `computeTimerEndAt(timerSeconds)`).

**Reliable “pick started” instant for UX:**

- **Derived (no extra column):** When both `timerEndAt` and `timerSeconds` are set and the draft is running,  
  `approxPickStartedAt = timerEndAt - timerSeconds * 1000` (milliseconds).  
  This matches the reset path after **`submitPick`** (see `PickSubmissionService`: `nextTimerEndAt = computeTimerEndAt(timerSeconds)`).

- **When derivation is imperfect:** Pause/resume, overnight freeze, soft timer, or auction clocks may clear or repurpose `timerEndAt`. For those modes, use **`DraftTimerService.computeTimerState`** / session snapshot fields (`pausedRemainingSeconds`, `overnightFrozenPickSeconds`) — see `DraftSessionService` / `DraftTimerService`.

**Recommendation:** Prefer **server timestamps** (`timerEndAt`, `updatedAt`, snapshot from **`buildSessionSnapshot`**) on the client; avoid advancing the draft from browser timers.

If product requires a persisted **`currentPickStartedAt`** for analytics or ambiguous clock modes, add **`currentPickStartedAt DateTime?`** on **`DraftSession`** in a follow-up migration and set it alongside `timerEndAt` in **`PickSubmissionService`** and timer reset helpers — **do not rename `timerEndAt`.**

---

## 3. Core services

| Service / module | Responsibility |
|------------------|----------------|
| **`PickSubmissionService.submitPick`** | Validates (`PickValidation`, roster fit, specialty pools), runs **`prisma.$transaction`**: rejects if overall slot already filled, creates **`DraftPick`**, bumps **`DraftSession.timerEndAt`** + version, completes draft when board full. Supports **`expectedOverall`** stale guard (`DRAFT_PICK_STALE_OVERALL`). |
| **`DraftTimerService`** | Computes timer display state from `timerEndAt`, pause, overnight windows; **`computeTimerEndAt`** for next deadline. |
| **`DraftSessionService`** | Start/pause/resume/complete; **`buildSessionSnapshot`** for API/UI; reconciles overnight timer. |
| **`CurrentOnTheClockResolver`** | Determines current overall pick and slot from picks + order + snake/linear/auction. |
| **`PickOwnershipResolver`** | Applies **`tradedPicks`** to determine who owns the current pick row. |
| **`processExpiredDraftPicks`** | Worker-safe: finds sessions whose **`timerEndAt`** passed and triggers autopick / advance per league settings. |
| **`SlowDraftRuntimeService`** | Slow-draft / commit-queue style automation paths. |
| **`autopickBestAvailableSubmit`** | Queue-first and best-available fallback when timer expires. |
| **`DraftPickTradeService`** | Pick trades during live draft (coordinates with **`tradedPicks`**). |
| **`draftAutomationTicks`** | Periodic automation hooks. |
| **`DraftNotificationService` / `draft-notifications`** | In-app / intel notifications on clock and picks. |
| **`draft-intelligence`** | Intel publication / DMs / tier signals. |
| **`RosterAssignmentService`** | **`appendPickToRosterDraftSnapshot`** during draft; **`finalizeRosterAssignments`** on completion → **`buildLineupSectionsFromPicks`** (starters + bench; **IR/taxi/devy left empty** at finalize — see `lib/post-draft/buildStartersFromPicks.ts`). |
| **`getResolvedDraftPoolForLeague`** | Sport-scoped player pool + ADP + enrichment for draft UI. |

---

## 4. API routes (representative)

Routes are **not** all under `/api/drafts/[draftSessionId]/…`. Primary patterns:

- **`app/api/leagues/[leagueId]/draft/pick`** — POST → **`submitPick`**, roster append, notifications.
- **`app/api/leagues/[leagueId]/draft/session`** — GET session snapshot / state.
- **`app/api/leagues/[leagueId]/draft/live-sync`** — Live sync payload.
- **`app/api/leagues/[leagueId]/draft/queue`** — Queue CRUD.
- **`app/api/leagues/[leagueId]/draft/queue/ai-reorder`** — Deterministic queue reorder; persist requires AF Pro **`pro_draft_ai`** + **`Roster.settings.aiManageDraftQueueEnabled`**; optional OpenAI explanation gated by league UI **`aiQueueReorderEnabled`**.
- **`app/api/leagues/[leagueId]/draft/autopick-expired`** — Expired-timer autopick path.
- **`app/api/leagues/[leagueId]/draft/trade-proposals/**`** — Pick trade proposals.
- **`app/api/draft/[draftId]/stream`** — Stream / SSE-style draft updates (see also **`draft-stream-store`**).
- **`app/api/draft/worker`** — Worker invocation.

**Map routes → engine:** Each handler should delegate to **`PickSubmissionService`**, **`DraftSessionService`**, **`DraftPickTradeService`**, etc., not reimplement pick logic.

### DraftRoom UI data flow (`DraftRoomPageClient`)

| Concern | Production path |
|---------|------------------|
| Initial snapshot | `GET /api/leagues/[leagueId]/draft/session` |
| Live sync | `GET /api/leagues/[leagueId]/draft/live-sync` — polled (~8s foreground / ~30s background); merges with **`mergeDraftSessionSnapshot`**; tab visibility triggers full session refetch |
| SSE | **`EventSource`** → `/api/draft/intel/stream?leagueId=` (`snapshot`, `queue_update`, `on_clock`, `recap`) for draft-intel UI; separate worker SSE: **`/api/draft/[draftId]/stream`** + **`draftStreamStore`** |
| Submit pick | `POST /api/leagues/[leagueId]/draft/pick` |
| Queue | `GET`/`PUT /draft/queue`; AI reorder `POST /draft/queue/ai-reorder` |
| Player pool | `GET /draft/pool` |
| Draft chat | `GET`/`POST /draft/chat` |
| Timer display | Server **`timerEndAt`** / **`session.timer`** → **`DraftTopBar`** + **`useDraftCountdownSeconds`** (display-only ticks; **`computeDraftCountdownSeconds`**) |
| ADP vs AI ADP | Pool row **`adp`** (system) vs **`aiAdp`** / sample — **`PlayerPanel`** `useAiAdp` toggle |

Production **`DraftRoomPageClient`** does not import **`af-legacy/.../mock-draft/DraftRoom`**, **`/api/draft/mock-*`**, or **`lib/mock-draft/draft-engine`** (see **`__tests__/draft-room/draft-room-ui-state.test.ts`**).

**Sport stat columns (pool / filters / Sleeper table):** **`lib/draft-room/draftSportStatColumns.ts`** — **`getDraftStatColumnsForSport`**, **`getStatValueForDraftPlayer`**, **`flattenDraftPlayerStatBag`**, **`filterDraftPlayersByStat`**. Visible draft pool grid: **`components/app/draft-room/SleeperPoolTable.tsx`** + **`lib/draft-room/sleeperPoolTableLayout.ts`** (**`buildSleeperPoolTableLayout`**, **`sleeperPoolStatOptionsFromPositionFilter`**). NFL uses **`nflDraftProjectionSplits`** + loose **`display.stats`** keys; other sports read **`display.stats`** numeric fields (same enrichment path as **`getResolvedDraftPoolForLeague`**). Extension presets (**`NASCAR`**, **`PGA`**, **`WWE`**, **`CRICKET`**) resolve when those keys exist on rows (not Prisma `LeagueSport` values today).

---

## 5. Worker

- **`lib/workers/draft-worker.ts`** — Orchestrates draft lifecycle, pool loading, **`submitPick`** branches, ADP blend, auction/lottery, etc. Keep pick rules in **`PickSubmissionService`**, not duplicated here beyond orchestration.

---

## 6. Realtime

- **`lib/draft/draft-stream-store`** — In-process / scalable hook for draft events (deployment-dependent).
- **Polling** exists as fallback in some clients — acceptable as fallback, not as sole authority for pick advancement.

---

## 7. Mock / demo paths (do not use for production live leagues)

| Path | Notes |
|------|------|
| **`app/af-legacy/components/mock-draft/DraftRoom.tsx`** | Legacy / mock UI. |
| **`app/api/draft/mock-*`**, **`create-mock`** | Mock-only APIs. |
| **`lib/mock-draft/draft-engine.ts`** | **`validateUniquePlayer`** reused by live **`PickValidation`** — shared helper, but mock engine entrypoints are not the live server path. |
| **`MockDraft` / `mock_draft_*` tables** | Separate mock drafts. |

---

## 8. Idempotency (HTTP)

**Today:** **`submitPick`** uses transactional checks + **`expectedOverall`** to prevent stale double-submit. There is **no** standard **`Idempotency-Key`** header store yet.

**Planned (optional):** Small **`DraftActionIdempotencyKey`** (or reuse audit/metadata) to return the same JSON body on safe retries — see product ticket; must not conflict with **`expectedOverall`** semantics.

---

## 9. Known gaps (evolve in place)

| Gap | Suggested follow-up |
|-----|---------------------|
| AF Pro “AI manage queue” | **Implemented (narrow slice):** `Roster.settings.aiManageDraftQueueEnabled` (default false; set via PUT **`/draft/queue`** with AF Pro gate). POST **`queue/ai-reorder`** persists deterministic reorder only when **`pro_draft_ai`** + flag on; otherwise suggestion-only. Autopick reads persisted **`DraftQueue.order`** only (no AI inference inside autopick). |
| NPC personalities + history | **Implemented (narrow slice):** typed **`npcDraftPersonality`** / **`npcFavoriteTeamAbbr`** on commissioner assignments; deterministic **`assignNpcDraftPersonality`** / **`inferHistoricalDraftPersonality`**; **`decideDraftPickWithScores`** applies personality weights; **`liveDraftAiAutopick`** persists first-time NPC stamp + **`logAction`** audit payload. |
| NPC autonomous draft trade negotiation | **`canNpcSendOrAcceptDraftTrade`** gates opt-in (`tradeRules.npcDraftTradingEnabled`). Full NPC-initiated trade flows remain **future-state** (routes + `maybeAutoRespondToTradeProposal` / fairness review). |
| Post-pick trade roster transfer | Verify **`DraftPickTradeService`** + finalize paths per league trade approval settings — add integration tests. |
| Daily AI ADP aggregation | **Service path:** `collectAllFantasyDraftPickSamples` / `computeAllFantasyAdpByPlayerIdSport` / `computeAllFantasyAdpFromPicks` → `lib/adp/allFantasyAdpDailyAggregation.ts`; **`recomputeAllFantasyAdp`** + **`persistAllFantasyAdpSnapshots`** → `AllFantasyAdpSnapshot` (`lib/adp/recomputeAllFantasyAdp.ts`). **Cron:** `GET`/`POST` **`/api/cron/recompute-allfantasy-adp`** (`app/api/cron/recompute-allfantasy-adp/route.ts`) — daily schedule in **`vercel.json`**; CLI: **`npm run recompute:allfantasy-adp`**. |
| Full integration test suite | Incremental Vitest around **`submitPick`**, trades, expired timers (mock Prisma). |
| Sport-wide draft UI stat columns | **`SleeperPoolTable`** + **`lib/draft-room/sleeperPoolTableLayout.ts`** wire headers/cells to **`draftSportStatColumns`** per sport (position pill hints IDP / MLB role / NHL goalie). Vitest: **`sport-stat-columns.test.ts`**, **`sleeper-pool-table-stat-columns.test.ts`**. |
| Browser/OS push for “on the clock” | **Future-state:** web push not implemented — MVP uses in-app **`DraftTopBar`** + intel SSE / poll. |
| **`DraftQueueEntry` row queue** | **Future-state** unless product switches the active queue model; **`DraftQueue.order`** JSON remains the path autopick and PUT **`/draft/queue`** use today. |
| Manual browser QA | Required before production ship — automated tests do not replace device/network QA. |
| **`npm run typecheck`** | Repo-wide **TS7006** / implicit-any and unrelated modules — cleanup is a **separate** hygiene pass; do not block draft MVP on full green `tsc`. |

---

## 10. Tests in repo (incremental)

**Stale vs race (pick authority):**

- **`DRAFT_PICK_STALE_OVERALL`** — The outer resolver already disagrees with the client’s **`expectedOverall`** (the board moved before submit). No transactional write is attempted.
- **`DRAFT_PICK_RACE_RETRY`** — The outer read still matched **`expectedOverall`**, but the transactional reload saw the draft state change before the write (concurrent pick landed). Safe retry.

**Focused Vitest files:**

- **`__tests__/live-draft-engine/draft-core-behavior.test.ts`** — Pick validation (on-clock, duplicate player) + **`buildLineupSectionsFromPicks`** (starters/bench; IR/taxi/devy empty).
- **`__tests__/live-draft-engine/submitPick.transaction.test.ts`** — **`PickSubmissionService.submitPick`**: successful **`DraftPick`** write, **`timerEndAt`** reset, consecutive picks, stale **`expectedOverall`**, duplicate player, stale vs race slot semantics, final-pick completion, traded-pick ownership.
- **`__tests__/live-draft-engine/expired-autopick.transaction.test.ts`** — Expired timer / autopick: queue-first **`tryQueueAutoPick`**, **`submitBestAvailableAutopickForExpiredTimer`** + **`submitPick`**, **`computeTimerEndAt`** / server timer reset, **`processExpiredDraftPickForLeague`** (paused / soft timer / stale session / traded on-clock roster).
- **`__tests__/live-draft-engine/draft-pick-trades.transaction.test.ts`** — **`PickOwnershipResolver`**, **`appendDraftPickTrades` / `getSessionTradedPicks`**, accept-path swap semantics, proposal-route guard mirror (no proposal for already-used overalls); documents gaps (commissioner/veto queue not on **`DraftPickTradeService`**, post-pick roster transfer elsewhere).
- **`__tests__/live-draft-engine/af-pro-queue-gating.test.ts`** — AF Pro / **`aiManageDraftQueueEnabled`** planner (`planDraftQueueAiReorder`), locked-row reorder (`reorderQueueByNeedRespectingLocks`), **`tryQueueAutoPick`** queue-order consumption (manual vs persisted order, skip drafted head, empty fallback).
- **`__tests__/live-draft-engine/npc-draft-personalities.test.ts`** — NPC **`assignNpcDraftPersonality`** / historical inference, **`decideDraftPickWithScores`** personality weighting, sport guard, **`canNpcSendOrAcceptDraftTrade`**, audit payload shape.
- **`__tests__/live-draft-engine/ai-adp-daily-aggregation.test.ts`** — AllFantasy AI ADP sample collection, playerId+sport rollup, **`persistAllFantasyAdpSnapshots`**, separation of system vs AI ADP in **`getResolvedDraftPoolForLeague`**, dry-run **`recomputeAllFantasyAdp`** summary.
- **`__tests__/draft-room/draft-room-ui-state.test.ts`** — **`computeDraftCountdownSeconds`** / **`getDraftCountdownDisplay`**, **`resolvePlayerPoolAdpColumns`**, **`DraftPlayerSearchResolver`** + numeric filters, **`planDraftQueueAiReorder`**, merge snapshot pick append, mock-import guard on **`DraftRoomPageClient`**.
- **`__tests__/draft-room/sport-stat-columns.test.ts`** — **`getDraftStatColumnsForSport`** (all **`LeagueSport`** + extension strings), **`getStatValueForDraftPlayer`** / aliases, IDP vs offense, **`filterDraftPlayersByStat`**, ADP column resolver vs AI ADP, cross-sport key disjointness.
- **`__tests__/draft-room/sleeper-pool-table-stat-columns.test.ts`** — **`buildSleeperPoolTableLayout`** / **`sleeperPoolStatOptionsFromPositionFilter`**: NFL offense vs IDP, NBA/MLB/NHL/Soccer/extension keys, BYE omitted off‑NFL, ADP vs AI ADP column order, NBA pts sort, cross‑sport key disjointness vs NFL.

- Existing: **`__tests__/draft/timer-queue-autopick-mechanics.test.ts`**, **`__tests__/nfl-redraft-queue-autopick.test.ts`**, **`__tests__/processExpiredDraftPicks.test.ts`**, **`__tests__/getResolvedDraftPoolForLeague.unit.test.ts`**, **`__tests__/player-identity/**`.
- Launch gate (static + cron smoke): **`__tests__/draft/draft-launch-gate.test.ts`** — production **`DraftRoomPageClient`** route strings, no mock-draft imports, **`requireCronAuth`** / **`CRON_SECRET`**, key helper modules, doc MVP/gap strings.

---

*Last updated: MVP launch gate + regression pass (draft room browser QA handoff).*
