# G12 — Draft Lifecycle Audit

**Date:** 2026-06-30  
**Branch:** `g15-event-foundation`  
**Auditor:** G12 pass  

---

## Goal

Audit and verify the entire draft lifecycle — from session creation through completion, roster assignment, schedule generation, finalization, and live scoring integration — to ensure no Redraft-hardcoded behavior remains in the core engine and every path remains reusable for future league concepts (Dynasty, Keeper, Best Ball, Guillotine, Survivor, Tournament, Big Brother, Zombie, Devy, C2C, IDP).

---

## Lifecycle Chain (as audited)

```
pick submitted (PickSubmissionService)
  └── if overall >= totalPicks → completeDraftSession(leagueId)

completeDraftSession(leagueId)                              [DraftSessionService.ts:1106]
  ├── DB transaction
  │   ├── guard: board full? (isDraftBoardFull)            — format-agnostic ✓
  │   ├── mark DraftSession.status = 'completed'
  │   └── applyPostDraftLifecycleInTransaction              — format-agnostic ✓
  ├── logAction (lifecycle transition audit)
  ├── runPostDraftFinalizationArtifacts(leagueId)          [postDraftFinalizeArtifacts.ts]
  │   ├── finalizeRosterAssignments(leagueId)              — generic, all leagues ✓
  │   └── syncCompletedDraftToRedraftSeason(leagueId)      — self-gates: skips non-Redraft
  │       ├── ensureRedraftSeason
  │       ├── ensureRedraftRoster (per pick)
  │       ├── RedraftRosterPlayer.create (per pick)
  │       ├── RedraftSeason.update → status: 'active'
  │       ├── ensureScheduleForNewSeason (round-robin matchups)
  │       └── emit EVENT.SEASON_ACTIVATED                  — Redraft-only
  ├── emit EVENT.DRAFT_COMPLETED                           — ALL leagues (G12 fix) ✓
  ├── runSurvivorPostDraftBootstrap (fire-and-forget)      — self-gating, see G12-3
  ├── awardAchievement('draft_completed')
  └── recordProductEvent(ENGAGEMENT.DRAFT_COMPLETED)
```

---

## Findings

### ✅ G12-6 — Core completion path is format-agnostic

`completeDraftSession` and `isDraftBoardFull` contain no sport or league-type branches.
The board-full check, lifecycle transition, and artifact call are reusable for any format.

### ✅ G12-7 — `finalizeRosterAssignments` is generic

`RosterAssignmentService.finalizeRosterAssignments` writes to `Roster.playerData` using
the league's roster template (via `getLeagueDraftTemplatePayload`). It works for any league
type. No Redraft or sport-specific logic.

### ✅ G12-4 (Redraft bridge self-gates)

`syncCompletedDraftToRedraftSeason` begins with:
```ts
const isRedraft = leagueType === 'redraft' || isDynasty === false
if (!isRedraft) return { skipped: true, reason: 'not_redraft_league' }
```
Non-Redraft leagues skip the season/roster/schedule bridge without error.

---

### 🔧 G12-1 — `hasExistingLineup` was duplicated (FIXED)

**Was:** Identical `hasExistingLineup` function defined in both:
- `lib/live-draft-engine/RosterAssignmentService.ts`
- `lib/league/roster/draft-to-roster-sync.ts`

**Fix:** Exported from `RosterAssignmentService.ts` and imported in `draft-to-roster-sync.ts`.
The duplication is eliminated.

---

### 🔧 G12-2 — `DRAFT_COMPLETED` event only fired for Redraft leagues (FIXED)

**Was:** `EVENT.DRAFT_COMPLETED` was emitted only from `syncCompletedDraftToRedraftSeason`
(Redraft-gated). Survivor, Dynasty, Keeper, etc. completed drafts with no domain event.

**Fix:**
- `completeDraftSession` now emits `EVENT.DRAFT_COMPLETED` for ALL league types, after
  `runPostDraftFinalizationArtifacts` completes. Idempotency key: `draft.completed:{sessionId}`.
- `syncCompletedDraftToRedraftSeason` no longer emits `DRAFT_COMPLETED` (removed to avoid
  double-emission). It still emits `EVENT.SEASON_ACTIVATED` (Redraft-specific).

---

### 📋 G12-3 — Survivor bootstrap hardcoded in core engine (DOCUMENTED, TODO)

**Location:** `DraftSessionService.ts:~1175`

```ts
import('@/lib/survivor/SurvivorDraftBootstrapService')
  .then((m) => m.runSurvivorPostDraftBootstrap(leagueId))
  .catch(() => {})
```

**Status:** Safe as-is — `runSurvivorPostDraftBootstrap` self-gates via `isSurvivorLeague(leagueId)`
(one DB read, returns `{ isSurvivor: false }` for non-survivor leagues). Fire-and-forget, errors swallowed.

**Architecture concern:** This is a direct plugin hook in the Core Engine. Every new league type
with post-draft bootstrapping (Zombie, Big Brother, etc.) would need another hardcoded line.

**Correct pattern (future ticket):** Subscribe `SurvivorDraftBootstrapService` to
`EVENT.DRAFT_COMPLETED` on the `InProcessEventBus`. The generic emission added in G12-2 means
this event now fires for all leagues — survivor can filter on its own `leagueConcept`.

**Prerequisite:** Event subscriber wiring (register handlers at app bootstrap). Tagged for a
follow-up ticket; NOT changed in G12 to avoid breaking survivor without the subscriber infrastructure.

---

### 📋 G12-4 — `syncDraftPicksToRoster` commissioner path is NFL-Redraft-only (DOCUMENTED)

**Location:** `lib/league/roster/draft-to-roster-sync.ts`

The commissioner-triggered manual sync (`syncDraftPicksToRoster`) is gated:
```ts
if (!isNflRedraftCoreDashboardLeague(...)) {
  return { ok: false, code: 'NOT_NFL_REDRAFT_CORE', ... }
}
```

**Assessment:** This is the MANUAL commissioner UI path, not the automated lifecycle. The
automated path (`finalizeRosterAssignments`) runs for all leagues. The manual path is acceptable
as NFL-Redraft-only until Dynasty/Keeper need a UI-triggered re-sync.

---

### 📋 G12-5 — Schedule generation is Redraft-only (DOCUMENTED)

**Location:** `lib/redraft/finalizeDraftToRedraftSeason.ts:ensureScheduleForNewSeason`

After a Redraft draft completes, matchups (`RedraftMatchup`) are generated via `generateSchedule`
(round-robin). Dynasty, Keeper, Tournament, etc. completing a draft have **no equivalent schedule
generation** in the post-draft artifact chain.

**Impact:** Dynasty/Keeper leagues that complete a draft via the AF engine have rosters populated
(`Roster.playerData`) but no matchup schedule. Each non-Redraft format will need its own
post-draft bridge that creates the appropriate scheduling records.

**Action:** Document as a prerequisite for each non-Redraft format's "go-live" milestone.

---

### 📋 G12-8 — Non-Redraft leagues emit no `SEASON_ACTIVATED` event (DOCUMENTED)

`EVENT.SEASON_ACTIVATED` is emitted from `syncCompletedDraftToRedraftSeason` (Redraft-only).
Live scoring integration that subscribes to `SEASON_ACTIVATED` to begin polling will not trigger
for Dynasty, Survivor, Keeper, etc.

Each format needs its own activation signal — either a format-specific event or a generalized
`lifecycle.season.activated` with `leagueConcept` filter.

---

## Draft Type Classification — Verified ✓

`mapCanonicalDraftTypeToEngineCore` correctly collapses:

| Wire type | Engine core |
|-----------|-------------|
| `snake` | `snake` |
| `linear` | `linear` |
| `auction` | `auction` |
| `slow_draft` | `snake` |
| `mock_draft` | `snake` |
| `mock_draft_linear` | `linear` |
| `offline` | `snake` |
| `auto` | `snake` |
| `devy_snake` | `snake` |
| `c2c_auction` | `auction` |
| `supplemental_draft_linear` | `linear` |
| `dispersal_draft_snake` | `snake` |

The engine never branches on specialty type. Only the pool, order, and pick-validation layers
inspect format.

---

## Test Coverage Added

`__tests__/draft/draft-completion-chain.test.ts` — 14 tests covering:
- `hasExistingLineup` exported guard (5 cases)
- `finalizeRosterAssignments` generic path (4 cases)
- `repairDraftCompletionIfBoardFull` self-heal (2 cases)
- `DRAFT_COMPLETED` generic emission contract (4 source-contract checks)
- Redraft no-double-emit contract (2 source-contract checks)
- `hasExistingLineup` deduplication fix (2 source-contract checks)

---

## Open Items (future tickets)

| ID | Item |
|----|------|
| G12-3-follow | Convert survivor bootstrap to `DRAFT_COMPLETED` event subscriber |
| G12-5-dynasty | Add Dynasty/Keeper post-draft bridge (season + schedule) |
| G12-5-tournament | Add Tournament post-draft bridge |
| G12-8 | Emit `SEASON_ACTIVATED` for non-Redraft leagues on draft completion |
