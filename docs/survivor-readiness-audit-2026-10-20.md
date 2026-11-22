# Survivor League readiness audit — 2026-10-20

Base commit: `b6a631ed` (origin/main, 2026-10-20). Read-only code audit against the owner's full Survivor spec (creation → tribes → draft → idols → chat → weekly loop → council → Exile → merge → jury). Seven parallel code audits, each citing `file:line`; this document consolidates them. Nothing in the repo was changed.

## 1. Bottom line

| Scope | Readiness | Verdict |
| --- | --- | --- |
| NBA, 16 or 20 managers, closed test group, commissioner willing to click 3–5 times a season | ~70% of the spec | Runnable as a supervised pilot once two production flags are set and two chat bugs are fixed. |
| NBA, fully unattended public league | ~55% | Blocked by the chat bugs, two privacy leaks, the finale click, and the playing-commissioner tie stall. |
| NFL / NHL / MLB | ~15% (NHL ~35%) | Creation is hard-blocked to NBA. NHL has a season plan and scoring; NFL has defaults but no scheduled council driver; MLB has no scoring, no defaults, no plan. |
| Your Exile Island design (FAAB bid on anchor, autofill team, tokens, commish rules) | ~40% | Tokens and return work. Bidding, autofill, your anchor positions, commissioner-on-Exile, and the "lose one token" mode do not exist. |

Automation estimate for an NBA league with `SURVIVOR_PLANNED_SEASON_AUTOMATION_ENABLED=true` and `DRAFT_TICK_CRON_ENABLED=true`: roughly 85–90% of season events run with no commissioner action. With the flags at their code defaults (both off) no council ever opens, so automation is effectively 0%.

## 2. Confirmed bugs (fix before any league, regardless of sport)

1. **Tribe chat cannot store messages (schema).** `LeagueChatMessage.source` is `@db.VarChar(16)` (`prisma/schema.prisma:8090`, init migration, never altered). Tribe chat is addressed as `tribe_<uuid>` (`lib/survivor/constants.ts:142`), which is 42 characters. Postgres rejects the insert unless the live column was widened by hand. Every tribe huddle send from the UI goes through this column (`app/api/shared/chat/threads/[threadId]/messages/route.ts:259-306`).
2. **Two tribe-chat systems that do not meet.** Engines (host posts, sit-out cards, merge welcome, Exile chat, ceremony results) write to `SurvivorChatChannel`/`SurvivorChatMessage` (`lib/survivor/survivorTribeChatProvisioning.ts`, `survivorMergeCast.ts`, `leagueChatPoster.ts`). No UI reads that table (`/api/survivor/chat` has zero callers). The UI opens `LeagueChatMessage` rows with `source=tribe_…` (`components/chat/LeagueChatPanel.tsx:95-104`). Players never see what Chimmy posts to their tribe.
3. **Privacy leak to a playing commissioner:** `app/api/survivor/notifications/route.ts:27-30` checks role only, so a playing commissioner can read any member's notification rows via `?userId=`, including `idol_found`. `server/api-route-modules/league-survivor/idol-setup/route.ts:30` likewise returns the drawn idol types to any commissioner regardless of blind mode. `…/tribes/route.ts:73-96` returns cross-tribe membership that `/api/survivor/season` deliberately redacts.
4. **Exact tie stalls a playing-commissioner league.** After revote, an exact season-points tie becomes `commissioner_tiebreak_required`; `resolve-exact-tie` requires a non-playing host (`server/api-route-modules/league-survivor/foundation/route.ts:524-536`), and `advanceWeek` blocks until resolved (`lib/survivor/gameStateMachine.ts:209-211`).
5. **Finale needs a human.** `openJuryVoting` is only reachable from `app/api/survivor/jury/route.ts:76-78`; `settleFinaleIfDue` runs only on page load or that POST, never from the season runner (`survivorPlannedSeasonRunner.ts:123`). If one juror never votes, the season never crowns a winner.
6. **Rocks cannot finish an elimination.** `survivorTieRule` defaults to `revote_then_rocks` in the schema, but only dead legacy code reads it. The manual `rocks_draw` path sets `eliminatedRosterId` without `eliminatedUserId`/`isTie:false` (`lib/survivor/rocksEngine.ts:122-130`) and `resolveElimination` refuses tied councils (`survivorEliminationService.ts:25`). The live rule is revote → lowest season points.
7. **Non-planned leagues send the wrong tribe to council.** The non-planned path picks the first non-immune tribe rather than the lowest scorer (`gameStateMachine.ts:436-441`). Only the planned NBA/NHL path picks the lowest (`:444-449`).
8. **Exile League creation failure is silent.** `LeagueBootstrapOrchestrator.ts:270` wraps `getOrCreateExileLeague` in `.catch(() => {})`.
9. **Legacy idol DM targets a channel that never exists.** `SurvivorDraftBootstrapService.ts:147-171` writes `channelId: chimmy:<userId>`; no such `SurvivorChatChannel` row is created, the FK fails, and the error is swallowed. The native path (`survivorIdolProvisioning.ts:152-165`) writes a private league-chat message and does work.
10. **`@chimmy` non-vote commands post publicly.** In the thread route only ballots are privatized; successful `sit out`, `play idol`, `challenge pick` commands are stored as public messages (`messages/route.ts:430-446`). System-A chat posts any non-vote `@chimmy` text publicly (`app/api/survivor/chat/route.ts:160-162`).

## 3. Scorecard against your spec

Status key: DONE = built and wired; PARTIAL = part works; NOT WIRED = code exists but nothing calls it or it is behind an off flag; MISSING = no code.

### Creation and setup

| Spec item | Status | What the code does |
| --- | --- | --- |
| Create → redirected to league dashboard | DONE | `/api/leagues` → `homepageUrl` → `router.push` (`createCanonicalLeagueInTransaction.ts:1267`, `CreateLeagueV2Client.tsx:189`). |
| Exile Island created with the league | DONE (silent on failure) | Exile `League` row + link created at bootstrap (`SurvivorExileEngine.ts:12-54`); game-side `ExileIsland` row flips active only on first elimination (`survivorEliminationService.ts:102`). |
| Tribe count chosen | DONE | Wizard picks count (`CreateLeagueWizard.tsx:914-920`); editable 2–5 post-create. |
| Tribe names chosen | PARTIAL | Names come from a fixed 50-tribe catalog (`lib/survivor/tribeCatalog.json`); no free-text name. |
| Tribe images assigned | PARTIAL | 50 catalog mascot SVGs + colour override (`SurvivorTribePicker.tsx:16-43`); no upload, no AI generation. |
| Random vs manual assignment, decided before start | PARTIAL | Random / manual / draft-pattern modes exist (`SurvivorSetupPanel.tsx:89`); manual plan locks pre-draft but members materialize only after the draft completes (`survivorPhase2Init.ts:140-159`). Lock requires every seat claimed and 4–6 per tribe, which conflicts with the 16-cast/2-tribe option the wizard allows. |
| Intro video on entry | DONE (first entry per browser) | `SurvivorFirstEntryModal` gated by localStorage (`SurvivorFirstEntryModal.tsx:58-73`); two different intro modals exist on `/league` and `/survivor` routes. |
| Survivor background | DONE | 20 mood × sport SVG backgrounds (`SurvivorIslandHero.tsx:48-52`). |
| Mock and live draft boards set up | DONE | Live `DraftSession` created at creation (`createCanonicalLeagueInTransaction.ts:1114-1138`); mock uses the generic mock tool, nothing Survivor-specific. |
| Scoring / roster / general / draft / commish / manager settings persist | DONE | Base tabs + 10 Survivor tabs, persisted via `/survivor/update-settings` and `/survivor/config`. |
| NFL, NBA, NHL, MLB | **NBA ONLY** | `SURVIVOR_CREATION_SPORTS = ['NBA']` (`lib/survivor/survivorCreationAvailability.ts:2`), enforced in wizard tiles and server validation (`validateCreateLeague.ts:201-203`). MLB is not even an eligible sport in defaults. |
| Cast size | 16 or 20 only | `SURVIVOR_CREATE_CAST_SIZES = [16, 20]` (`sport-team-limits.ts:29`); 24 deferred. |

### Invites, draft, draft room

| Spec item | Status | What the code does |
| --- | --- | --- |
| Invited + accepted → team assignment | DONE | Invite link: invitee picks an open team (`app/join/[token]/page.tsx:114-150`). Join code: auto-assigns lowest open seat (`placeholderClaim.ts:178-195`). Commissioner can assign/replace (`commissioner/leagues/[leagueId]/managers/route.ts:153-174`). |
| Tribe assignment at invite | MISSING | Nothing assigns a tribe at claim time; tribes are created post-draft. |
| Draft date/time persists, auto-start | DONE | `autostart: true` on Survivor create; `/api/cron/draft-tick` every minute → `startScheduledSurvivorDrafts` (`draft-tick/route.ts:98-103`). Refuses with a one-time commissioner DM if seats are unclaimed. |
| Auto-pick on expired timer | NOT WIRED in prod | Runs only when `DRAFT_TICK_CRON_ENABLED === 'true'` (`draft-tick/route.ts:37-39,114`). |
| Snake | DONE | Including third-round reversal. |
| Linear | DONE | Fixed order. |
| Auction | DONE (engine) | Nominate / bid / resolve / $200 budgets (`auction/AuctionEngine.ts`). Not surfaced as a Survivor-specific flow. |
| Offline | PARTIAL | Commissioner pick edit + results import, but import marks `completed` without `completeDraftSession`, so Survivor Phase 2 (tribes, idols, chats) only runs when someone opens recap/summary (`ImportCommitFlow.ts:166-206`, `PostDraftAutomationService.ts:152-174`). |
| Auto-pick draft | NOT WIRED | `aiAutoPick=true` is set but nothing reads it; behaves as snake + CPU-on-timer. |
| `real_time`, `by_team` | MISSING | IDs exist, collapse to snake. |
| Tribes identifiable in draft room | MISSING | Zero `tribe` references in draft-room code; manager colours are a palette (`ManagerColorResolver.ts`). |
| ADP, headshots, team logos, stats in draft | DONE | Shared draft room columns and avatars. |
| Manager images in draft | PARTIAL | Reads `LeagueTeam.avatarUrl`, which native Survivor seat claims never write, so managers show initials. |
| Tribe images in draft | MISSING | See tribe visibility. |
| Round-1 rookie-draft visuals | DONE | `DraftRoundOneAnnouncementOverlay.tsx` (headshot, logo, "Round 1 · Pick N", 6.2 s). Copy is not "With the Nth pick…". |
| Draft chat mirrored to league chat | PARTIAL (off by default) | Mirrors only when `liveDraftChatSyncEnabled` (default false) and draft is in progress; rows drop out of league chat after the draft ends. |
| Rosters set from picks after draft | DONE | `completeDraftSession` → `finalizeDraftToRedraftSeason` → `initializeSurvivorPhase2`. Proven by `scripts/verify-nba-survivor-20-draft.ts`. |
| Post-draft idol popup + Chimmy DM with player, idol, time frame | PARTIAL | Private Chimmy chat card with player name, headshot (NBA only), idol label (`survivorIdolProvisioning.ts:152-165`). No popup/modal. No time frame in the text. Push/email `idol_found` fires only on the legacy path. |

### Idols and Shot in the Dark

| Spec item | Status | What the code does |
| --- | --- | --- |
| Commissioner: system random count + types | DONE | Random mode, count 6–8, types drawn and sealed with `node:crypto` at draft start (`survivorIdolDraw.ts`, `survivorDraftStartReadiness.ts:112-114`). |
| Commissioner: choose types and how many of each | PARTIAL | Pick mode selects which types, each once; slots repeat picks in order; no per-type quantity; count locked to 6–8 (`survivorIdolDraw.ts:173-185`, `survivorIdolTypes.ts:31`). |
| Idols hidden on random pool players at draft | PARTIAL | Types are sealed at draft start, but idols bind to drafted picks after the draft completes, to a random third of managers (`survivorIdolSeedingEngine.ts:219-226`). Draft engine has zero idol references. |
| Idol follows player (elimination, waiver, steal) | DONE | `playerBoundIdolTransfer.ts`, called from waivers, trades, reversal, raid, elimination. Arrival DM to new holder. |
| 1–2 immunity idols in waiver pool | MISSING | Seeding requires an owner; nothing seeds undrafted players. |
| Play until votes start counting | DONE | `idolWindowOpen` enforced in a serializable transaction (`survivorIdolResolutionService.ts:30-33,75-77`); tally only after window closes. |
| Idol time frame / expiry | PARTIAL | Three unconnected mechanisms; owner cannot set expiry in idol setup; holder is not told. Play refused at ≤4 players left (default). |
| Shot in the Dark, 1-in-4/5/6 configurable | PARTIAL | One per manager, persisted, honoured by tally, reachable from Tribal screen and `@Chimmy shot in the dark`. Odds hard-coded 1-in-6 (`survivorShotInTheDark.ts:40,66-68`). |
| Idol effects implemented | 4 of ~25 | Immunity, extra vote, vote steal, steal-three. Tribe immunity, point surge, tribute, captain, and the rest are catalog-only ("not playable yet"). |
| Single idol storage | NOT DONE | Native and legacy state machines coexist on one table; chat `play idol` goes through the legacy engine the native tally does not read. |

### Chat

| Spec item | Status | What the code does |
| --- | --- | --- |
| Tribe Huddle auto-created, members auto-added | PARTIAL (broken, see bugs 1–2) | Channel named `<Tribe> Tribe`, not "Tribe Huddle". |
| Huddle private to the tribe | DONE (System A), PARTIAL (System B) | Playing commissioner sees own tribe only. Non-playing host can read in A, refused in B. |
| Member removed from huddle on elimination | PARTIAL | System A yes (`survivorEliminationService.ts:86-89`); System B removal is not called from `resolveElimination`. |
| 1-on-1 DMs private | DONE | Platform DM threads, member-only. |
| `@chimmy` → private DM from any chat | PARTIAL | Votes and Shot in the Dark are private from league/tribe/draft chat. Other commands leak publicly (bug 10). No durable per-user Chimmy transcript. |
| Vote via Chimmy DM or `@chimmy <name>` | DONE | Both paths record a server-side secret ballot. Re-voting before close is off by default (`voteChangePolicy = first_valid_locks`). |
| Sit-out via `@chimmy` | PARTIAL | Works only from the tribe composer; from league chat it goes to the LLM; command text is public. |
| Exile chat | DONE (System A only) | No UI reads it. |

### Weekly loop

| Spec item | Status | What the code does |
| --- | --- | --- |
| NFL TNF challenge + tribe challenge + MNF challenge | MISSING | One random catalog challenge per week for non-planned leagues; the per-sport cadence table has no runtime consumer. |
| NBA/NHL/MLB 1–3 challenges per week | PARTIAL | Planned NBA/NHL seasons get one tribe + one individual "verified slate" contest per week (`survivorVerifiedSlateChallenges.ts`). |
| Challenge winners tracked, immunity or FAAB awarded | PARTIAL | Catalog challenges cannot auto-tally (`tallyChallengeResults` throws "no verified scoring adapter"). FAAB reward is record-only (`SurvivorEffectEngine.ts:272,294`). Challenge immunity is honoured only by legacy council code, not the canonical council. |
| Tribe vs tribe: highest immune, lowest to council | DONE (planned NBA/NHL) | `gameStateMachine.ts:326-366, 444-449`. Non-planned path is wrong (bug 7). |
| Two highest tribes immune | MISSING | No setting. |
| Idol used for a tribe | PARTIAL | `tribe_immunity_modifier` exists, only legacy council honours it. |
| Council day/time per sport, commissioner override | PARTIAL | Override works; default is Tuesday 20:00 ET for every sport; per-sport table is written at bootstrap but never read by the deadline code. |
| Non-voter auto-cast = tribe's lowest scorer | MISSING | Missing ballots simply don't count; only an entirely empty council falls back to eliminating the lowest scorer. Late ballots stamped "Does Not Count". |
| Secret ballots | DONE | Reveal shows target, never voter. |
| Scroll reveal one by one, tally, "voted off" | DONE | `survivorRevealGate.ts`, `SurvivorVoteRevealScrolls.tsx`, real ballots, no fake data. |
| Elimination → off island, out of tribe chat, to Exile, players to waivers | DONE | `survivorEliminationService.ts:20-115`. |
| Sit-outs, no two weeks in a row | DONE (NBA only) | `SurvivorSitOutEngine.ts`; returns `not_nba` for other sports. |
| Merge week by commissioner | DONE | Week or player-count trigger. |
| Reshuffle when a tribe falls below 50% of others | PARTIAL | Trigger is 40% of original size; commissioner can approve/postpone a seeded random redraw; no manual mid-season assignment. |
| Post-merge random temporary tribes | MISSING | |
| Tie → rocks, or revote then rocks | PARTIAL | Live rule is revote → season points → commissioner. Rocks is dead code (bug 6). |
| Jury votes for the winner | DONE (semi-manual) | `SurvivorFinaleEngine.ts`; needs commissioner to open jury voting (bug 5). |
| Exile returnee comes back at a set week | DONE | One return from a sealed token snapshot, configurable week/min tokens. |

### Exile Island

| Spec item | Status | What the code does |
| --- | --- | --- |
| No draft | DONE | |
| Weekly bid on anchor from waivers | PARTIAL | First-come claim under a lock, no FAAB/auction window (`exileRosterService.ts:48-78`). |
| Anchor: NFL QB, MLB C, NHL G, NBA C | PARTIAL | Code: NFL QB, **MLB SP**, NHL G, **NBA PG** (`lib/survivor/constants.ts:155-163`). A test calls PG "user-approved". |
| Winning anchor auto-fills the rest of the team | MISSING (native) | Anchor reserves the team; teammates claimed one by one. Only Chimmy's NBA boss roster is auto-built. |
| Highest score wins an Exile token | DONE | NFL/NBA/NHL scored from finalized stats. MLB wired but unverified. |
| Most tokens by week N returns | DONE | Scheduled only for planned NBA/NHL leagues. |
| Non-playing commissioner competes on Exile | MISSING | No enrollment path. |
| Playing commissioner → Chimmy runs the Exile team | PARTIAL | New leagues default the "boss" to a median score, not a roster; Chimmy roster exists only for NBA in legacy `chimmy_roster` mode. |
| Chimmy wins → everyone loses one token OR others lose all (setting) | PARTIAL | Only "wipe" exists, no "lose one", and the flags are not commissioner-settable. |
| Eliminated roster to waivers | DONE | |

### Commissioner hub and automation

| Spec item | Status | What the code does |
| --- | --- | --- |
| Hub helps run both islands | DONE | Dashboard, council control, redraw approval, broadcasts, pause. |
| No insider info for a playing commissioner | PARTIAL | Access context masks idols, ballots, DMs, AI context. Three leaks (bug 3). |
| Commissioner contacted only on issues | PARTIAL | Only two commissioner alerts exist (unclaimed seats at draft, tribe-shuffle recommendation). Automation errors, missing scores, unresolved ties, and finale stalls are dashboard-only. |
| 95–99% automated | 85–90% (NBA, flags on) | Manual: finale open/settle, exact tie, redraw decision, seat filling, reading `lastError`. |

## 4. Direct answers to the questions you asked

- **Invite accepted → assigned automatically?** With an invite link the person picks their own open team. With a join code they get the lowest open seat automatically. The commissioner can also assign or replace anyone. Tribes are not assigned at invite time; they are created after the draft, randomly or from the commissioner's locked pre-draft plan.
- **Draft date/time set and auto-start?** Yes. Survivor leagues are created with autostart on, the draft-tick cron runs every minute, and the draft starts at the saved time if all seats are claimed and the player pool is ready. Expired-timer auto-pick needs `DRAFT_TICK_CRON_ENABLED=true` on the worker service.
- **Are idols randomly chosen and attached to random players in the live draft?** Idol types are randomly drawn and sealed at draft start. The players are chosen after the draft completes, from the picks of a random third of managers. They are not hidden in the pool during the draft, so no pick can be made "for" an idol.

## 5. Production settings that must be on for an unattended NBA season

| Setting | Where | Why |
| --- | --- | --- |
| `DRAFT_TICK_CRON_ENABLED=true` | `allfantasy-v2-worker` | Expired-pick auto-pick. Autostart itself is not gated. |
| `SURVIVOR_PLANNED_SEASON_AUTOMATION_ENABLED=true` | `allfantasy-v2-worker` | The planned-season runner (councils, Exile, merge, recap). Docs still say keep it off until the season replay passes. |
| `CRON_SECRET`, `APP_URL` | GitHub Actions cron loop | All crons are dispatched from Actions, none from `vercel.json`. |
| NBA ADP rows for the season | DB | Draft readiness check (`survivorDraftStartReadiness.ts:85-94`). |

## 6. Questions for the owner

### Sports and scope
1. Which sport do you want to launch first for real managers: NBA now, then which order for NFL, NHL, MLB?
2. For NFL, is the Thursday / tribe / Monday-night challenge triple the only acceptable week shape, or is "one tribe slate + one individual slate" (what NBA/NHL have) acceptable as the first NFL release?
3. MLB has no Survivor scoring, no defaults, and no season plan. Is MLB a 2027 target, or needed this cycle?
4. Cast size: 16 and 20 only today. Do you need 24, or free entry between 16 and 20?

### Tribes
5. Must tribe names be free text and images uploadable or AI-generated, or is the 50-tribe catalog plus colour override enough for launch?
6. Should tribe assignment be a hard pre-draft step (members written when the commissioner locks the plan), so the draft room can show tribe badges and emblems? Today tribes exist only after the draft.
7. The pre-draft plan requires 4–6 managers per tribe, which conflicts with the 2-tribe option at 16 managers. Which wins?
8. Reshuffle trigger: 40% of original size (live) or "below 50% of the other tribes" (your spec)? Should it force a merge, or only offer a redraw? Do you need manual mid-season reassignment?

### Draft
9. For "auto-pick draft", do you mean the system drafts the entire board instantly from ADP/queues, or CPU-on-timer as today?
10. For "offline draft", is commissioner pick entry plus results import the right flow?
11. Should draft chat mirror into league chat by default for Survivor, and remain there after the draft ends?
12. Round-one visual: is the existing overlay (headshot, logo, "Round 1 · Pick N") enough, or do you want the announcer copy and a longer reveal?

### Idols
13. Pick mode: do you need quantities per type (e.g., 2 Immunity, 1 Steal-3) and counts outside 6–8?
14. Should idols be bound to hidden players before the draft (so a manager might draft one unknowingly, your spec) or stay bound to drafted players after the draft (today)? Should every drafted player be equally likely, or keep "a third of managers hold one"?
15. Waiver-pool immunity idols: how many, seeded when, and do they expire?
16. Expiry: one league rule (fixed week, N players left, merge) or per idol type? Should the DM and vault show it?
17. Shot in the Dark odds: expose 1/4, 1/5, 1/6 in settings? Should the public verdict name who used it?
18. Is a modal popup required after the draft, or is the private Chimmy card plus vault enough?
19. Scoring idols (point surge, tribute, captain, etc.) are catalog-only. Build now, or hide until built?

### Chat
20. Confirm the tribe chat name should be "Tribe Huddle".
21. Should re-voting before the window closes be allowed? Default forbids it.
22. Should `@chimmy sit out <name>` work from league chat and the Chimmy DM, and be hidden from the tribe?
23. Should a non-playing host be able to read tribe huddles?

### Weekly loop
24. Non-voters: auto-cast each missing ballot as the tribe's lowest scorer (your spec), replacing today's "missing ballots don't count"?
25. Tie rule: build rocks into the canonical tally (revote → rocks), or keep revote → season points?
26. For a playing commissioner, should an exact tie fall to a seeded draw instead of stalling?
27. Council day/time: wire the per-sport defaults (NBA/NHL Monday, NFL Tuesday, etc.), or keep Tuesday 20:00 ET everywhere until the commissioner changes it?
28. Should FAAB rewards actually credit the waiver budget?
29. Post-merge random two-tribe weeks and "two highest tribes immune": build both?
30. Should the runner auto-set a jury deadline and settle the finale with no commissioner click?

### Exile
31. Anchor positions: NBA Center and MLB Catcher (your spec) vs NBA PG and MLB SP (code, and a test calls PG "user-approved"). Which is final?
32. Should the anchor claim be a FAAB bid with a processing window, or is first-come-under-lock acceptable?
33. Should winning the anchor auto-populate the rest of the Exile roster from that real team?
34. Boss model: keep the median-score boss, or require a Chimmy-managed roster for every sport?
35. Non-playing commissioner competing on Exile: build it?
36. Penalty mode: add "everyone loses one token" and a commissioner toggle?

### Operations
37. Are you ready to set `SURVIVOR_PLANNED_SEASON_AUTOMATION_ENABLED=true` and `DRAFT_TICK_CRON_ENABLED=true` on the worker for a closed test league?
38. Should automation errors, missing scores beyond N hours, unresolved ties, and unclaimed seats become commissioner alerts (push/email)?

## 7. Suggested build order

1. **Stabilize (1 sprint):** widen `LeagueChatMessage.source`, pick one tribe-chat system and make the UI read it, close the three privacy leaks, add seeded tie fallback for playing commissioners, let the runner open and settle the finale, surface Exile creation failure, privatize all `@chimmy` commands.
2. **Your Survivor rules, NBA (1–2 sprints):** non-voter auto-cast, rocks in the canonical tally, Shot odds setting, idol quantities per type, waiver-pool immunity idols, expiry in DM/vault, popup, tribe badges in the draft room, per-sport council defaults, commissioner alerts.
3. **Exile per your design (1 sprint):** FAAB anchor bid window, autofill from the anchor's team, anchor position per sport, non-playing commissioner enrollment, Chimmy roster for all sports, lose-one-token mode and toggle.
4. **Sports expansion:** NHL creation (season plan and scoring exist, needs roster eligibility, readiness check, sit-outs); NFL (TNF/tribe/MNF challenge generator, scheduled council driver, week calendar); MLB (scoring adapter, defaults, season plan).
5. **Certification:** multi-account staging season replay per sport with the automation flags on.
