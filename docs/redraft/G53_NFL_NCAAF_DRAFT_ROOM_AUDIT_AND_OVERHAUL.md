# G53 — NFL & NCAAF Draft Room Audit, Functional Hardening, and Experience Overhaul

Date: 2026-07-12

Evidence labels used below:

- **Source verified**: traced through current repository code.
- **Test verified**: exercised by a passing deterministic test.
- **Fixture verified**: rendered or exercised only in an explicit harness.
- **Authenticated runtime verified**: requires a trusted authenticated browser and real non-production database; not achieved in G53.

## 1. Executive summary

The live league draft room is not a client-only prototype. It has a real server-authoritative foundation: authenticated league access, commissioner action gates, a per-league pick lock, transactional `DraftPick` creation plus session advancement, a unique `(sessionId, overall)` database constraint, server timers, persisted queues/chat, polling/SSE reconciliation, commissioner pick editing, draft-pick trades, completion services, and sport-aware player adapters. The current visual shell already contains a responsive board, player workspace, queue, roster, Draft Assist, chat, sticky mobile clock, connection degradation state, and commissioner surfaces.

It is not fully launch-certified. G48's trusted-browser block means no commissioner/manager/observer multiplayer run, physical database contention run, reconnect proof, or 390×844 authenticated validation occurred. Several capabilities exist but remain only source/test verified. The mock-draft system is a separate persistence/runtime implementation, not the live draft engine; it is functional in source for snake/linear solo and invited rooms, but it has weaker atomicity and duplicated orchestration.

G53 implemented one launch-critical integrity slice:

1. Identical live-pick retries now return the already-committed authoritative pick instead of a false stale error. The API suppresses duplicate audit, chat, notification, roster-snapshot, and fanout side effects for the replay.
2. NCAAF mock CPU/player-pool loading can no longer use the NFL-only live ADP fast path.
3. Auction was removed from the two live mock-room setup controls and guarded at session creation because that runtime treated it as linear selection rather than nomination/bidding.

No production data, provider, deployment, Trade OS, G48, or G52 certification work was performed.

## 2–5. Draft status by product

| Product | Status | Verified strengths | Material limits |
| --- | --- | --- | --- |
| NFL live league draft | **Partial — strong source foundation** | Transactional pick/advance, lock/race handling, authorization, server timer, snake/linear and separate auction services, queues, chat, Draft Assist, commissioner controls, completion pipeline. | No authenticated multiplayer/DB certification; roster draft snapshot and many notifications are post-commit projections; broad advanced modes are not all physically exercised. |
| NFL mock draft | **Partial** | Persistent `MockDraft`, solo/mixed/invite rooms, CPU advancement, timer autopick, snake/linear, restart/results/share surfaces, sport-aware fallback. | Separate engine; JSON result-array optimistic updates; realistic CPU behavior not fully proven; live-room auction now unavailable; no authenticated multiplayer proof. |
| NCAAF live league draft | **Partial** | Shared live authority plus `sportType`, sport pool resolver, NCAAF display/stat adapters, roster/scoring defaults, specialty eligibility paths. | No authenticated NCAAF league draft; player-data completeness and CPU/autopick quality are not live certified. |
| NCAAF mock draft | **Partial, integrity hardened** | Sport-aware pool is now mandatory; NFL ADP leakage path removed and test verified. | No real NCAAF provider freshness or authenticated room validation; CPU realism and long-draft performance remain uncertified. |

## 6. Competitive research matrix

Research is based on current official help/product documentation where accessible. It informs product treatment only; it is not evidence for AllFantasy behavior.

| Feature/pattern | Verified platforms | Strength / lesson | AllFantasy status | Recommended AllFantasy treatment |
| --- | --- | --- | --- | --- |
| Queue-first autopick with ranked fallback | Yahoo, ESPN, Underdog, DraftKings, Fantrax, MFL | Mature baseline; users must know exactly what will happen on expiry. [Yahoo](https://help.yahoo.com/kb/fantasy-football/tips-pre-ranking-players-sln6160.html), [ESPN](https://support.espn.com/hc/en-us/articles/360000140911-Online-Draft-Player-Queue), [Underdog](https://help.underdogsports.com/en/articles/10982124-auto-pick-priority-order) | Source verified; persisted queue and fallback services exist. | Show queue/fallback order beside the clock; keep deterministic roster legality authoritative. |
| Snake/linear/custom order | Yahoo, MFL | Familiar and configurable. [Yahoo commissioner guide](https://help.yahoo.com/kb/fantasy-football/leagues-draft-sln6086.html), [MFL features](https://home.myfantasyleague.com/features) | Source verified. | Keep board ownership and original/current owner visible; certify custom order physically. |
| Pause, undo, clock changes | Yahoo | Strong commissioner recovery with clear destructive boundaries. [Yahoo commissioner guide](https://help.yahoo.com/kb/fantasy-football/leagues-draft-sln6086.html) | Source verified with server gate/audit in AllFantasy. | Require paused state, reason, confirmation, audit, and downstream reconciliation. |
| Live and slow drafts | DraftKings, MFL | Long timers require notifications, durable reconnect, and explicit pause behavior. [DraftKings](https://help.draftkings.com/hc/en-us/articles/24812004193811-Game-Style-Best-Ball-Overview-US), [MFL](https://home.myfantasyleague.com/features) | Source verified timer/overnight support; runtime unverified. | Preserve one server clock; expose `Connected/Reconnecting/Offline/Refreshed`. |
| Draft-pick trading with board ownership | Sleeper, MFL | Ownership must update immediately without losing original-owner context. [Sleeper](https://support.sleeper.com/en/articles/3974639-can-i-trade-draft-picks), [MFL](https://home.myfantasyleague.com/features) | Source verified proposal/ownership routes and board metadata. | Keep current and original ownership; certify on-clock race behavior with two clients. |
| Salary-cap/auction drafts | Yahoo, MFL | This is a distinct nomination/bidding state machine, not a linear draft variant. [Yahoo overview](https://help.yahoo.com/kb/fantasy-football/draft-preparation-fantasy-football-sln6478.html), [MFL](https://home.myfantasyleague.com/features) | Live services exist; mock live room was misleading. | Certify live auction separately; keep mock auction unavailable until it uses the auction engine. |
| Mock simulator with league-aware recommendations | FantasyPros | Strong preparation loop uses scoring, eligibility, need, scarcity and opponent needs, followed by analysis. [Draft Wizard](https://support.fantasypros.com/hc/en-us/articles/115001300547-What-is-Draft-Wizard) | Partial. Deterministic recommendation engine exists; duplicated mock/live wrappers remain. | Unify normalized input/evidence, show concise reasons, add rematch and honest grade confidence. |
| Custom rankings / autopilot | Underdog, Yahoo, ESPN | Personal control reduces surprise and supports multiple drafts. [Underdog](https://help.underdogsports.com/en/articles/9180011-draft-rankings-and-autopilot), [Yahoo](https://help.yahoo.com/kb/fantasy-football/tips-pre-ranking-players-sln6160.html), [ESPN](https://support.espn.com/hc/en-us/articles/360000063811-Autopick-Draft) | Queue/custom ranking paths exist. | Make personal order portable and clearly distinguish queue from watchlist. |
| Persistent chat and draft activity | Sleeper, MFL | Draft conversation and system events belong together but must remain distinguishable. [Sleeper](https://support.sleeper.com/en/articles/1960098-introduction-to-dynasty-leagues), [MFL](https://home.myfantasyleague.com/features) | Source verified persisted chat, pick cards, mentions, reactions/polls. | Retain separate activity styling, accessible mentions, and mobile non-obstruction. |
| Post-draft analysis | FantasyPros | Immediate recap creates a strong completion loop. [Draft Wizard](https://support.fantasypros.com/hc/en-us/articles/115001300547-What-is-Draft-Wizard) | Recap/grade/result routes exist. | Grade only from real draft/scoring inputs; disclose missing/stale data. |
| Presenter/party view | Yahoo | A read-only board is useful without exposing a manager's controls. [Yahoo commissioner guide](https://help.yahoo.com/kb/fantasy-football/leagues-draft-sln6086.html) | No certified canonical presenter mode found. | P2: reuse authoritative snapshot in a read-only, token-scoped surface. |

Distinct AllFantasy direction: a **War Room** organized around Board, Players, Queue, My Team, Draft Assist and Chat; a persistent on-clock/status rail; provider-neutral research; explicit connection truth; and concise recommendation evidence such as team need, tier pressure, next-pick survival and alternatives. Avoid competitor visual imitation and raw provider/model language.

## 7. Existing architecture and call-flow map

### Live league draft

```text
League route / app/drafts/[draftId]
→ components/draft/DraftBoard
→ DraftRoomPageClient + DraftRoomShell
→ /api/leagues/{leagueId}/draft/pick
→ auth + league membership + commissioner/action gate
→ PickSubmissionService.submitPick
→ per-league Redis/AutomationLock + stale/idempotent preflight
→ Prisma transaction: DraftPick create + DraftSession timer/version advance
→ unique(sessionId, overall) race safety
→ authoritative DraftSession snapshot response
→ post-commit chat/event/notification/intelligence projections
→ polling / live-sync / SSE merge
→ board, pool, queue, roster projection and recommendation refresh
```

### Mock draft

```text
MockDraftSetup / MockDraftSleeperRoomClient
→ /api/mock-draft/create
→ MockDraftSessionService (persistent MockDraft row)
→ /api/mock-draft/{draftId}/start or pick
→ MockDraftRuntimeService
→ optimistic updateMany guarded by updatedAt
→ results JSON + status/metadata update
→ CPU loop / timer fallback
→ refreshed MockDraft snapshot
```

The foundations are not the same engine. They share player/recommendation utilities in places, but live uses relational `DraftPick` rows while mock stores a JSON results array. A future convergence should reuse pure order, eligibility, recommendation, and presentation contracts without replacing the live authority.

## 8–11. Feature inventory and truth classification

| Subsystem | Classification | Evidence/findings |
| --- | --- | --- |
| Live pick authority | Implemented; source/test verified | Status, turn, roster, duplicate name/position, specialty pool, roster fit, expected overall, race and unique-slot checks. |
| Pick persistence | Implemented; physical DB validation blocked | Pick and session version/timer update are one Prisma transaction. Retry replay added in G53. |
| Roster projection | Partial | Live `DraftPick` is authoritative; per-pick `Roster.playerData.draftPicks` append occurs after commit and errors are swallowed. Completion performs an idempotent roster materialization. |
| Start/pause/resume | Implemented; source/test verified | Commissioner action gate, state checks, lock-aware session functions, server timestamps. |
| Completion | Implemented; source/test verified | Board-full detection, completion retry/repair, finalization services, league lifecycle integration. Physical full-season proof remains blocked. |
| Snake/linear | Implemented | Pure order services and tests exist. |
| Live auction | Separate implementation present; not certified | Nominate/bid/resolve services and routes exist. Requires its own authenticated concurrency certification. |
| Mock auction | Unsupported | UI exposure removed and live mock-room creation guarded in G53. Legacy simulation endpoints still need consolidation. |
| Offline/live modes | Partial | UI/config paths exist; offline commissioner entry is not authenticated-runtime verified. |
| Queue/watchlist | Queue implemented; watchlist distinction partial | Persisted queue, reorder and expiry fallback exist. Queue polling/SSE exists. |
| Player search/filter | Implemented in UI; runtime partial | Position/search/availability and sport display adapters exist; large-pool performance not profiled. |
| Player cards/research | Partial | Identity, imagery fallback, stats columns, projection/injury/news contexts exist with provider-neutral adapters, but completeness/freshness is awaiting G52. |
| Recommendations | Partial | Deterministic canonical engine uses availability, ADP, scoring flags and roster need; multiple wrappers/routes and unused shadow service remain. |
| Chat | Implemented; source verified | Persisted league/draft channel, membership gate, pick system rows, reactions, polls, media and parsed mentions. Mention recipient notification correctness is not multiplayer certified. |
| Realtime | Hybrid and partial | Server polling/live-sync is authoritative; an EventSource is used for intelligence/queue events. It is not a general WebSocket draft event bus. |
| Reconnect | Source verified; runtime blocked | Visibility refresh, version/snapshot merge, missed-state recovery, degraded connection state. |
| Draft trades | Implemented; source verified | Proposal/respond/review routes and `tradedPicks` ownership resolution. Physical on-clock race and multi-client board update unverified. |
| Commissioner editor | Implemented; source/test verified | Paused-only edits, self-benefit confirmation, transaction, audit log and cache invalidation. |
| Mock multiplayer | Partial | Invite token and participant slots exist; real two-user synchronization not certified. |
| Mock CPU | Partial | Deterministic helper input and availability exclusion exist, but realism across roster builds, byes and NCAAF long drafts is not comprehensively measured. |
| Fixture routes | Fixture only | `app/e2e/draft-room` and `app/e2e/mock-draft-room` are explicit harnesses and cannot prove authenticated live behavior. |
| Dead/duplicate paths | Confirmed | Prior source audit found unused `lib/shared-services/draft/**` shadow exports and dead `lib/draft/mockDraftAI.ts::getAIPick`; mock and live have overlapping route/service families. |

## 12. Security and authorization findings

- Live reads require authentication and `canAccessLeagueDraft` membership.
- User picks require access, roster ownership/on-clock validation and league action gates.
- `source=commissioner` is explicitly rejected for non-commissioners.
- Commissioner controls and pick edits use `draft_commissioner_control` at the server boundary.
- Pick edits require paused state; self-benefiting changes require a reason and confirmation and persist an audit row.
- Mock reads/picks require owner or assigned participant identity; invite tokens only join pre-draft rooms.
- No cross-league or cross-draft authenticated runtime test was performed in G53.
- Remaining risk: the mock JSON runtime is guarded by `updatedAt` optimistic updates but does not have the live engine's relational pick constraint or distributed lock.

## 13. Pick-persistence findings

**What is authoritative:** `DraftPick` plus `DraftSession`, not optimistic client state. A normal live pick creates the pick and advances timer/version inside one Prisma transaction. `(sessionId, overall)` is unique. A distributed lock, transaction sentinel, and stale expected-overall guard reduce concurrency races.

**G53 improvement:** when a network retry repeats the same player, position/player ID, roster and `expectedOverall`, the service returns the committed pick with `idempotentReplay=true`. Conflicting payloads still receive `DRAFT_PICK_STALE_OVERALL`. The route returns refreshed authoritative state and does not rerun post-pick effects.

**Remaining limits:**

- Physical Neon/Postgres rollback and multi-process contention were not run.
- Per-pick roster JSON projection is post-commit, non-atomic and best-effort. The relational pick remains safe, and completion re-materializes rosters, but the in-draft “my roster” projection can temporarily lag.
- Player identity uniqueness is enforced by validation/serialization rather than a database unique player constraint.
- Completion and downstream roster materialization need a real full-draft certification.

## 14. Realtime and reconnection findings

- Draft state uses authoritative polling through `/draft/live-sync`, accelerating to roughly two seconds while an active clock runs and backing off in background tabs.
- Queue/chat are merged by stable identifiers; session snapshots are version/updated-time reconciled.
- Visibility restoration forces an authoritative session refresh.
- Repeated failures produce a degraded/reconnecting UI; actions do not rely solely on optimistic success.
- SSE exists for background intelligence/queue events, not as the sole draft authority.
- There is no authenticated proof of three simultaneous clients, missed-event recovery under network loss, timer skew, or commissioner-edit propagation. Status: **blocked**.

## 15. Commissioner-control findings

Source-verified controls include start, pause, resume, timer reset/change, undo last pick, force autopick, skip (when policy allows), auction resolution/ticks, slow/keeper ticks, completion, draft reset, manager swap, and a dedicated paused pick editor. The editor supports clear/replace/reassign-style mutations with transaction/audit/version behavior.

Gaps:

- Not every destructive action has been visually reviewed for equivalent confirmation language.
- “Stop/end,” reopen completed draft, round-count mutation, arbitrary pick movement and ownership repair are not all proven safe as customer controls.
- Controls that are source present but not certified should remain gated or hidden until their action-specific tests pass.

## 16. Draft-trade findings

`DraftPickTradeProposal` is persistent. Proposal/respond/review APIs, inventory, analysis and `PickOwnershipResolver` feed current ownership to board/pick submission. Original ownership is stored on picks and traded metadata can tint/label the board.

Not proven: two-client accepted-trade propagation, on-clock trade contention, expired/rejected no-mutation at the physical DB, and safe commissioner reversal. Trade OS reversal is outside G53 and remains paused.

## 17. Chat and tagging findings

Live draft chat enforces draft access, persists messages, limits length, distinguishes draft pick system rows, supports league/draft synchronization, reactions, polls, media and mention parsing. Polling/live-sync preserves last good messages on transient failure. Customer chat does not expose raw provider mechanics.

Unverified: duplicate display-name mention resolution, actual mention notifications to the intended user, blocking enforcement in this route's downstream service, stable ordering across concurrent writers, and mobile keyboard behavior.

## 18. Player-data findings

The live room uses canonical display adapters and sport-aware pool APIs. Player detail supports identity, headshots/fallbacks, team/position, ADP/rank fields, sport-specific stat columns and optional projections/injury/news contexts. G52 provider freshness remains open, so these are not live-provider certified.

The most serious NCAAF mock leak was in `MockDraftRuntimeService`: both NFL and NCAAF attempted the NFL live ADP feed. G53 restricts that fast path to NFL and forces NCAAF through `loadSportAwareDraftPlayerPool`.

Unknown/missing data must remain labeled unavailable or stale. No data was fabricated in G53.

## 19. Recommendation findings

The production deterministic engine excludes drafted players and scores candidates using roster need, ADP edge and format boosts. It is called by human recommendation, live brain, autopick, mock CPU and War Room wrappers. It does not expose raw prompts. Sport, scoring flags, roster configuration and availability are present, but tier depletion, bye clustering, opponent tendencies, keeper/traded-pick context and next-pick survival are not uniformly authoritative in every caller.

Multiple recommendation entry points remain. `lib/shared-services/draft/**` is an unused shadow system and should not become another engine. Follow-up should normalize one `DraftDecisionContext`, preserve deterministic ranking as authority, and attach short evidence labels: Best Available, Team Need, Tier Pressure, Next-Pick Risk and Alternatives.

## 20–22. Visual, mobile and accessibility findings

The current live room already reflects much of the intended AllFantasy War Room structure:

- `DraftTopBar` for draft/clock/connection/status controls.
- `DraftRoomShell` desktop workspaces and mobile modes.
- Responsive `DraftBoard`/cells with position and current-pick presentation.
- `PlayerPanel`, queue, roster construction, Draft Assist and player detail.
- Docked/collapsible chat.
- Mobile tabs: Board, Players, Queue, Helper, Roster, Keepers and Chat.
- Sticky mobile current pick/timer plus one-action queue/roster/chat/helper shortcuts.
- Loading, alert/status live regions and explicit reconnect/offline states.

Status is **partial**, not “overhaul complete.” No trusted browser review at 390×844 or landscape was possible. Source still needs a systematic keyboard/focus pass, modal focus traps, timer announcements that avoid verbosity, position semantics beyond color in every cell, reduced-motion verification, 44px touch-target verification, and screen-reader board traversal.

Mock and live rooms are visually separate and should converge on the AllFantasy shell/presentation tokens without forcing their persistence engines together.

## 23. Performance findings

Positive source evidence:

- Draft pool has memory + Prisma TTL caching and prewarm support.
- Board/cells are memoized.
- Search/filter work is client-side with derived memoized lists in key areas.
- Secondary research and intelligence are asynchronous and do not gate pick submission.
- Polling avoids overlap, adjusts for visibility and reduces secondary refresh frequency.

Risks:

- `DraftRoomPageClient.tsx` remains a very large orchestration component.
- Player list/board virtualization and long-draft profiling were not proven.
- Mock CPU can repeatedly load player pools inside its loop; long CPU-only rooms need query-count profiling.
- Polling at two seconds across many rooms needs load testing.
- No measured initial load, search latency, render cost or 20-round/large-league browser profile was collected.

## 24. Implementation completed during G53

1. Added deterministic idempotent replay recognition for committed live picks.
2. Prevented duplicate route side effects on an idempotent replay.
3. Added retry/conflict regression coverage.
4. Isolated NCAAF mock pools from NFL live ADP.
5. Added NFL/NCAAF pool-path regression coverage.
6. Removed unsupported auction from both live mock-room format selectors.
7. Rejected live mock-room auction session creation with truthful customer copy.

## 25. Files modified during G53

- `lib/live-draft-engine/PickSubmissionService.ts`
- `app/api/leagues/[leagueId]/draft/pick/route.ts`
- `__tests__/live-draft-engine/submitPick.transaction.test.ts`
- `lib/mock-draft-engine/MockDraftRuntimeService.ts`
- `__tests__/mock-draft-engine/sport-pool-isolation.test.ts`
- `components/mock-draft/MockDraftSetup.tsx`
- `components/mock-draft/MockDraftSleeperRoomClient.tsx`
- `app/api/mock-draft/create/route.ts`
- `docs/redraft/G53_NFL_NCAAF_DRAFT_ROOM_AUDIT_AND_OVERHAUL.md`

The repository was already heavily modified before G53. Unrelated user changes and generated artifacts were preserved.

## 26. Validation

### Passing authority/domain suite

```text
npx vitest run
  __tests__/live-draft-engine/submitPick.transaction.test.ts
  __tests__/live-draft-engine/draft-core-behavior.test.ts
  __tests__/live-draft-engine/draft-access-auth.test.ts
  __tests__/live-draft-engine/undo-resets-timer.test.ts
  __tests__/commissionerPickEditService.test.ts
  __tests__/draft/use-live-draft-sync.test.ts
  __tests__/mock-draft-engine/sport-pool-isolation.test.ts
  --pool=threads --maxWorkers=1
```

Result: **7 files passed; 81 tests passed; 0 failed, skipped, retried or timed out; 84.08 seconds.**

### Passing UI/trade suite

```text
npx vitest run
  __tests__/draft-room-single-board.DraftBoard.test.tsx
  __tests__/draft-board-cell-commish-edit.test.tsx
  __tests__/commissioner-control-center-timer-ui.test.tsx
  __tests__/draft/draft-room-functional-regression.test.ts
  __tests__/draft-room/draft-room-ui-state.test.ts
  __tests__/draft-room/draft-queue-ux.test.ts
  __tests__/draft-room/draft-pick-action-visibility.test.ts
  __tests__/draft-room/draft-board-layout.test.ts
  __tests__/draft-room/ncaafb-stat-columns.test.ts
  __tests__/live-draft-engine/draft-pick-trades.transaction.test.ts
  --pool=threads --maxWorkers=1
```

Result: **10 files passed; 134 tests passed; 0 failed, skipped, retried or timed out; 102.03 seconds.**

Combined final passing evidence: **17 files and 215 tests passed.**

### Disclosed initial/baseline failures

The first broad run contained 8 files and 102 tests: 99 passed and 3 failed. One G53 retry-test assertion incorrectly counted the shared lock transaction as a pick mutation; the assertion was corrected to verify the actual invariant (one persisted pick), after which the final authority suite passed. Two failures remain in `__tests__/draft/nfl-redraft-draft-room-smoke.test.ts`: the already-dirty `DraftRoomPageClient.tsx` does not import/use the expected `draftPoolReadinessState` helper and still contains the inline “Preparing player pool” ternary. Those failures are unrelated to the G53 files changed in that client (none) and are retained as a pre-existing source/test inconsistency, not counted as passing.

### Static validation

- Targeted ESLint across all eight changed TypeScript/TSX implementation/test files: **0 errors, 2 pre-existing `no-img-element` warnings** in `MockDraftSleeperRoomClient.tsx` at lines 1338 and 1919.
- Targeted `git diff --check`: **passed with no whitespace errors**; only LF-to-CRLF working-tree notices were emitted.
- Full `npx tsc --noEmit --pretty false --incremental false`: **failed after 167.8 seconds with Node heap exhaustion**; it is not counted as passing.
- Focused TypeScript project for the six changed source/UI modules with a 6 GB heap: completed in 66.1 seconds and reported four unrelated baseline errors only: three NextAuth session augmentation errors in `lib/auth.ts` (missing `username`, `id`, `spotifyAccount`) and missing declarations for `web-push` in `lib/push-notifications/push-service.ts`. No error pointed to a G53-modified file.

### Runtime boundaries

- No skipped test is counted as passing.
- No retry is counted as passing.
- No timeout is counted as passing.
- Component harness evidence remains fixture-only.
- Authenticated browser, real DB and multiplayer checks remain unperformed.

## 27. Remaining blockers

### P0 launch certification

1. Authenticated commissioner + two managers/observer on a real non-production DB.
2. Normal, queue, autopick, commissioner, concurrent and final pick physical validation.
3. Refresh/reconnect, timer synchronization and missed-state reconciliation.
4. Atomic/repair behavior for the per-pick roster projection.
5. NCAAF real player-pool/provider completeness and live selection.
6. Live auction certification or clear league-creation gating.
7. Destructive commissioner-action matrix with physical rollback/audit proof.

### P1 public beta

- Consolidate mock/live recommendation context and remove unused shadow/dead paths.
- Profile/mock pool reuse and large-board rendering.
- Complete accessible keyboard/focus/timer review.
- Complete live trade propagation and on-clock race tests.
- Verify chat mentions, blocks and mobile keyboard behavior.
- Finish provider-backed player research certification in G52.

### P2

- Presenter mode, richer reactions/GIF discovery, advanced share/export, portfolio exposure and enhanced draft grades.

## 28. Recommended follow-up phases

1. **G53B — Authenticated Multiplayer Pick Certification:** commissioner + two managers, physical DB, contention, reconnect and finalization. This is the single next recommended action when the trusted browser is available.
2. **G53C — Roster Projection Atomicity and Recovery:** make in-draft roster projection deterministic/idempotent and add repair evidence without weakening `DraftPick` authority.
3. **G53D — Commissioner and Live Trade Certification:** destructive action matrix, on-clock trades, audit and propagation.
4. **G53E — Draft Experience Visual/Accessibility Certification:** real desktop + 390×844 + landscape, keyboard/screen reader/reduced motion and performance profiling.
5. **G53F — Mock Runtime Consolidation:** eliminate duplicate creation/simulation paths, reuse pure live-domain contracts, and implement a real auction mock only through the auction state machine.
6. Resume **G52** provider certification only when its external prerequisites exist. Trade OS remains paused.

## 29. Updated readiness and truth table

The functional fixes justify stronger draft integrity evidence, but they do not close authenticated launch gates. Published readiness remains unchanged:

- NFL Redraft Beta: **95%**
- NCAAF Redraft Beta: **80%**
- August 10 Controlled Beta: **70%**

```text
G53 NFL & NCAAF DRAFT ROOM AUDIT: PASS
NFL LIVE DRAFT FULLY VERIFIED: NO
NFL MOCK DRAFT FULLY VERIFIED: NO
NCAAF LIVE DRAFT FULLY VERIFIED: NO
NCAAF MOCK DRAFT FULLY VERIFIED: NO
PICKS PERSIST AUTHORITATIVELY: PARTIAL
COMMISSIONER CONTROLS VERIFIED: PARTIAL
REALTIME MULTIPLAYER VERIFIED: BLOCKED
PLAYER RESEARCH DATA VERIFIED: PARTIAL
DRAFT RECOMMENDATIONS VERIFIED: PARTIAL
CHAT AND USER TAGGING VERIFIED: PARTIAL
VISUAL OVERHAUL COMPLETED: PARTIAL
READY FOR AUTHENTICATED MULTIPLAYER CERTIFICATION: YES
```

What was completed: a fresh cross-sport/live/mock audit plus idempotent pick replay, NCAAF mock pool isolation and truthful mock-auction gating.

Overall completion: **70% controlled-beta readiness, unchanged**.

What remains: authenticated multiplayer/database proof, roster-projection recovery, commissioner/trade physical certification, provider data certification and real mobile/accessibility/performance QA. The next phase is **G53B Authenticated Multiplayer Pick Certification** when the external browser gate is restored.
