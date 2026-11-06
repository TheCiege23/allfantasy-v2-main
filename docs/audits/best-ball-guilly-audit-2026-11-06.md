# Best Ball + Guilly audit — NFL, NBA, NHL, MLB

**Date:** 2026-11-06 · **Code audited:** `origin/main` at `b2cb2bba6d` (a detached worktree, not the shared
`G:` checkout, which is 3,343 commits behind `origin/main`). · **Fix branch:** `fix/best-ball-transaction-gates`
(local, not pushed).

How to read the evidence labels:

- **Verified** — I read the code myself and/or a test now pins it (`__tests__/bestball/best-ball-audit-2026-11.test.ts`).
- **Code-read** — traced by reading code, with file:line, but not executed.
- **Unverified** — could not be established without production data, a database, or a live run.

Nothing here touched a database, a live league, a draft, a claim, or a notification.

---

## 1. Readiness by sport and preset

| | Classic Best Ball | Guilly + Best Ball |
|---|---|---|
| **NFL** | **Partial.** Scoring is correct and automatic. Before this branch, waivers/FA were not blocked on the server. Scheduled drafts never auto-start. The wizard has no Best Ball setup. The Best Ball tab read tables native scoring never writes (fixed in branch). | **Partial.** The chop pipeline is complete, locked, idempotent and tested. But the chop scores the *current* roster rather than that week's, up to 20% missing stats seal as zero, post-chop corrections are never applied, and the calendar is not validated. |
| **NBA** | **Partial / not launch-ready.** As NFL, plus the draft is 13 rounds against 18 non-reserve seats (code-read). It is labelled "daily" but computes weekly. It cannot run a tournament. | **Partial.** Weekly-total best ball works. The NBA Guilly setup screen refuses best ball for stale reasons; the main wizard allows it. The chop lands 1–2 days into the next period, which is where current-roster scoring bites hardest. |
| **NHL** | **Partial / not launch-ready.** Same as NBA (17 rounds against 21 seats, code-read). Goalie eligibility is correct. | **Partial.** Same as NBA, with no NHL-specific gap found. |
| **MLB** | **Partial / not launch-ready.** Same as NBA (24 rounds against 26 seats, code-read). Innings are handled correctly. Two-way players are one asset. | **Unverified.** There are no multi-week elimination periods, so a 26-team field needs 25 single weekly chops. The calendar fit is not validated. The season is not live, so none of this was observable. |

**In one line:** the scoring core (the exact optimizer, final-only sealing, chop locking) is the strongest
part. The weak parts are setup (the wizard silently defaults everything), transaction enforcement (fixed for
the server in this branch), scheduled drafts, and the member-facing explanation of who counted.
Roster-as-of-week scoring is also fixed in this branch.

---

## 2. Feature matrix

W = Working · P = Partial · M = Missing · B = Broken · U = Unverified

### Creation and settings

| Feature | Status | Evidence |
|---|---|---|
| Live creation path | W | `CreateLeagueWizard` → `POST /api/leagues` → `createCanonicalLeagueInTransaction.ts:620` |
| Best Ball options in the live wizard | **B** | `BestBallAdvancedSettings.tsx` is reachable only from `CreateLeagueUnifiedForm`, which nothing imports. The wizard always uses `bestBallSetupForTeamCount()` defaults (`CreateLeagueWizard.tsx:220-232`). |
| Guilly offered from Best Ball creation | M | A league has one concept. |
| Best Ball offered from Guilly creation | P | The wizard checkbox works (`settings.best_ball=true`, `createCanonical…:526`). `GuillySetup` (NBA) refuses it with a stale reason (`lib/guilly/setup.ts:59,105`). The legacy route accepts `roster_mode:'best_ball'` and drops it. |
| Equivalent saved shape from both paths | **B** | Classic: `leagueType 'best_ball'` + `bestBallMode` + `best_ball_settings` + `bb*` columns. Guilly+BB: `guillotineMode` + `settings.best_ball`, with no `bb*` values. Both run the same optimizer. |
| Lineup mode / roster policy / competition / lifecycle kept separate | P | Lineup mode lives in two places (`bestBallMode`, `settings.best_ball`). Roster policy is split three ways (`bb*` columns, `best_ball_settings`, trade review). |
| Rules summary before creation | M | The review step shows sport, concept, team count and draft only (`CreateLeagueWizard.tsx:1505-1515`). |
| League size vs pool / positions / calendar validation | M | Only team-count limits are checked. The chop calendar is checked only in NBA `GuillySetup` (`lib/guilly/setup.ts:79-94`). |
| Commissioner Best Ball settings edit | P | Role-checked (`app/api/bestball/settings/route.ts:37`). No lifecycle lock, no audit row. Playoff and season-length edits never reach the `playoffTeams`/`playoffStartWeek` columns. A tournament can be enabled with no contest. |
| Settings saved and never read | B | `bbFaEnabled`, `bbIrEnabled` and `bbTaxiEnabled` had no reader. This branch makes `bbFaEnabled` and `bbWaiversEnabled` enforced. Also unread: `slowDraftClockMinutes`, `autoPickBehavior`, the draft pause/force toggles, `bestBall.draftDateUtc`, and `bbScoringPeriod` (scoring ignores it). |
| "No playoffs" | B | Still writes 6 playoff teams and a playoff start week (`createCanonical…:614-616,688-691`). |

### Scoring and the optimizer

| Feature | Status | Evidence |
|---|---|---|
| Production optimizer is globally optimal | **W (Verified)** | `computeOptimalLineup` uses Kuhn augmenting paths over a transversal matroid (`lib/lineup-optimizer/optimalLineup.ts`). It is called by `scoreRosterBestBall` (`lib/redraft/scoringEngine.ts:724-795`), which feeds matchups, standings and Guilly chops. The counterexample where greedy fails is pinned in the new test. |
| Actual points, not projections | W (Verified) | Stats are rescored with the league's own rules (`scoringEngine.ts:762`). A missing row is counted as missing, not as 0. |
| Player never counted twice | **Fixed** | A duplicate roster row used to be seated twice (60 instead of 40). The optimizer now dedupes by `playerId`. |
| Negative scores, unfilled slots, deterministic ties | W (Verified) | A required seat takes a negative player only as a last resort. Unfilled seats are reported. Ties break on `playerId`. |
| IR/IL/taxi exclusion | W | Uses that week's saved lineup (`scoringEngine.ts:738-745`). |
| Roster *as of the scoring week* | **Fixed** | It was the current roster (`droppedAt: null`). Now a player counts for whoever held him at his first game lock that week (`lib/redraft/bestBallWeekRoster.ts`). Native leagues only; the scorer and the week finalizer share it. See P0-3. |
| Weekly vs daily | P | One lineup over weekly totals (the best-ball branch returns before the daily branch, `scoringEngine.ts:305` vs `:318`). The UI, rules and AI say "daily" (`lib/bestball/rules.ts:147,171,197`; `sportConfig.ts:81,112,139`). |
| Rule/settings version stored with a result | M | Assignments and unfilled seats are stored in `lineupSnapshots`. The algorithm id, slot config and scoring version are not. Rescoring an old week uses current settings (`scoringEngine.ts:212-219,805`). |
| Position-change effective dates | M | Current position everywhere. |
| Secondary optimizers agree with production | **B** | Greedy `optimizerCore.ts` feeds contests, survivor and the `/api/bestball/optimize` cache, and is wrong on dual eligibility (35 vs 50). The DFS in `leagueOptimizer.ts`/`weeklyProcessor.ts` uses hard-coded slots with no K/DST/superflex, and took 18s on a 30-player MLB roster. `best-ball-engine.ts` falls back to summing the whole roster. |
| NHL: goalie only in G slots | W (Verified) | Pinned against the real `buildBestBallSlots('NHL')`. |
| MLB: innings as outs (5.2 → 17 outs) | W (Verified) | `inningsFromBaseballNotation`, pinned. |
| MLB: two-way player | W (policy: one asset) | Hitter and pitcher stat groups go on one asset. `TWP` is eligible for UTIL/hitter seats only (`dailySportRedraftRoster.ts`). Unverified: whether Ohtani is stored as `TWP`. |
| NBA: points vs made-shot double count | W | FGM/FTM default to 0 (`configs/nba.ts`). |
| NFL: TEP/PPR/superflex/K/DEF/IDP | W in production path | From league config. The secondary optimizers ignore it. |
| NFL postseason excluded | U | `PlayerWeeklyScore` has no season-type key. |

### Drafts

| Feature | Status | Evidence |
|---|---|---|
| Scheduled auto-start, Classic BB | **Fixed** | The tick started `leagueType:'redraft'` only. `SCHEDULED_SEASONAL_LEAGUE_TYPES` (`redraftScheduledStart.ts`) now adds `best_ball` under redraft's rule: the draft time is the commitment. The tick's query and the settings UI read the same list. Guilly start still needs Autostart on. |
| Server autopick when nobody is online | P / U | Needs `DRAFT_TICK_CRON_ENABLED==='true'`, which defaults off (`app/api/cron/draft-tick/route.ts:40-42`). Production value unverified. |
| Autopick keeps a usable roster | **Fixed** | One guard (`lib/live-draft-engine/autopickStarterGuard.ts`) now covers the queue, draft-as-me, need-based, best available and the Chimmy/orphan drafter. It bites only once the team's remaining picks just cover its open starting spots. |
| Rounds = draftable capacity | P | NFL is correct (18). NBA/NHL/MLB use the generic registry (13/17/24 against 18/21/26 seats; code-read, not executed). |
| No double-drafting under concurrency | W | Transaction re-reads the pick count; `@@unique([sessionId, overall])` (`PickSubmissionService.ts:413-428`). |
| Exactly-once finalization | P | `completeDraftSession` updates without a status condition, so draft-ended notifications can duplicate (`DraftSessionService.ts:1217-1247`). |
| Best Ball draft AI | **B** | `lib/bestball/ai/draftAssistant.ts` returns the first three client-supplied players. |
| Slow draft still running at season start | M | Weeks before completion get no rosters and no scores. No policy, no warning. |

### Transactions

| Feature | Status | Evidence |
|---|---|---|
| Classic: waivers/FA blocked on the server | **Fixed** | Previously nothing read `bbWaiversEnabled`/`bbFaEnabled`. Now enforced in the waiver phase gate. |
| Classic: trades blocked (AF engine) | W | `tradeSettingsResolver.ts:85-100`. |
| Classic/Guilly: trades blocked (redraft trade path) | **Fixed** | `/api/redraft/trade-proposals` and `trade-runtime` now refuse with `TRADES_DISABLED`. |
| Classic: manual lineup saves refused | P | Refused only for Guilly+BB (`lineupService.ts:177`). Classic saves "succeed" and change nothing except IR/taxi exclusion. |
| Guilly: survivors keep FAAB/waivers | W | Nothing disables them. This branch explicitly exempts Guilly from the new gate. |
| FAAB ordering, $0 bids, minimum bid, roster space, blind bids | W | `process-engine.ts:398-431,686-707`. Members see only their own claims. |
| Concurrent waiver runs | **Fixed** | Every run now serializes on `waiver:process:{leagueId}`, taken inside `processWaiverClaimsForLeague`: busy waits ~6s, then skips with claims pending. A team's claims share one roster object for the run; previously a second award overwrote the first. The roster write is a compare-and-set on `playerData` + `faabRemaining`. Still open: an instant free-agent add racing a run can put one player on two rosters; the add path takes no lock. |
| No retroactive points for acquisitions | **Fixed (best ball)** | See P0-3. The standard weekly (non-daily) lineup path still reads the current roster; its starters are locked per game, so the exposure there is smaller. |
| Ownership history | W | `addedAt`/`droppedAt` are now read by best ball scoring. A trade moves the row and keeps `addedAt`, so trades are not split by week; best ball refuses trades. |

### Guilly automation

| Feature | Status | Evidence |
|---|---|---|
| Trigger | W | `/api/redraft/score-sync` every 5 min → `runNativeGuillotineWeek` (`route.ts:425`). |
| Final-only before a chop | W | All games final + 12h grace + coverage floor + correction window (`weekFinalizer.ts:439-449`; `nativeGuillotineWeek.ts:155-166`). |
| Missing stats | P | Above 80% coverage, the missing players are sealed at 0 (`weekFinalizer.ts:60-69,618-639`). |
| Post-chop stat corrections | M | `statCorrectionHandler.ts:13-35` is a stub. |
| Ties | P | Configurable order. The final fallback is `Math.random` or DB order, which is not reproducible (`GuillotineTiebreakResolver.ts:38,73-79`). |
| Double chops, Final N | W | `chopSchedule.ts`, `endgameRules.ts`. A Final N is not validated against the season length. |
| Idempotency and recovery | W | Two locks, a unique index on (season, period, roster), the audit row, and `resumeAuditedRosterRelease` every tick. |
| Calendar = teams − 1 | **B** | Not validated. 27 teams are allowed against 18 NFL weeks, and the season just ends ranked by points. |
| Release into the fair process | P | Blind-FAAB hold works. The chop writes no drop transaction, so the after-drop waiver hold may not apply in instant-FA leagues (code-read). |
| Eliminated team: no transactions | **Fixed** | Previously only claims were blocked. Add/drop and trades through the roster gate are now refused. |
| Eliminated team: keeps view access; commissioner powers separate | W | Membership kept; `commissioner/permissions.ts` is independent of elimination. |
| Pending trades cancelled at chop | M | Moot while Guilly trades are off (now enforced on both paths). |
| Chop → waivers ordering | P | Two independent crons. Ordering relies on the blind window, not on sequencing. |
| Champion and season end | W | `finishGuillotineSeason.ts`. No champion notification. |
| Specialty-automation handler | B (dead) | Never passes `periodEndedAt`, so it can never chop (`guillotineHandler.ts:30`). |

### Members, notifications, renewal, AI

| Feature | Status | Evidence |
|---|---|---|
| Best Ball tab shows the scoring lineup | **Fixed** | Hosted leagues now read the matchup snapshot's started lineup and `league_player_weekly_scores` (`lib/bestball/nativeBestBallTabLoad.ts`). Imported leagues keep the legacy tables. |
| Provisional label and "why he counted" | **Fixed (tab)** | Each card is Final or Provisional, shows unfilled slots and players still awaiting stats, and gives each bench player a one-sentence reason (`benchReason`). My Team still says "Your **provider** selects…" (`MyTeam.tsx:1944-1946`). |
| No "set your lineup" nags for Classic | P | Chimmy lineup and slate-lock alerts skip best ball. The commissioner reminder recipe (off by default) and the AI commissioner alert do not. |
| Weekly recap / power rankings | **B** | Scheduled as GET; the routes export POST only, so they 405 every week (`app/api/redraft/ai/weekly-recap/route.ts:8`). |
| Discovery | P | Public leagues are listed. No Guilly category. |
| Private join needs approval | **M** | Anyone holding the code joins directly (`app/api/leagues/join/route.ts:125-160`). Approval exists only via Find-a-League requests. |
| Revoked invite link | B | A disabled link still works unless visibility is `invite_only` (`InviteValidationResolver.ts:212`). |
| Joins closed after the draft | **M** | Closed for Survivor only (`join/route.ts:307-314`). |
| Android → app/Play; iPhone/desktop → web | P | Android relies on App Links (`assetlinks.json`). There is no Play prompt for league invites. Destination is kept through sign-in via `callbackUrl`. |
| Renewal | P | Duplicate guard, claim/trade cancel and new draft work. Guilly chops reset. **A tournament renewal keeps a completed `bbContestId`, so the new season auto-completes on its first tick** (code-read). |
| Chimmy reads real state | P | Sport, scoring and structure come from the league. Lineup slots come from sport defaults, and score history from `weeklyScore`. |
| Chimmy cannot write official state | W | `AIActionWriteScope.ts:5`; no score/chop/pick/FAAB writers found. |
| Hidden data | W | `get_waiver_status` returns only the asker's own bids. |
| Dynasty/devy/C2C excluded from standalone presets | W | `bestBallDefaults.ts:309-333`; creation guards at `createCanonical…:474-480`. |
| Integrity | P | Duplicate-account join gate. The tanking scan is not best-ball-aware. Collusion detection is trade-based. |

---

## 3. Prioritized findings

### P0 — wrong results or broken core rules

1. **Classic Best Ball allowed waivers and free-agent adds** *(Verified, fixed in branch)*.
   - Where: `bbWaiversEnabled`/`bbFaEnabled` default false (`rules.ts:344`; schema) but had no reader. The phase gate used by add/drop, `createClaim`, `/api/redraft/waivers` and the processor ignored them.
   - Impact: the format's defining rule was cosmetic.
   - Repro (pre-fix): in a native best ball league, `POST /api/waiver-wire/leagues/{id}/add-drop`.
2. **The redraft trade path ignored Best Ball / Guilly "trades off"** *(Verified, fixed in branch)*.
   - Where: `lib/redraft/tradeProposalValidation.ts`, behind `/api/redraft/trade-proposals` and `/api/redraft/trade-runtime`.
3. **Best ball scoring used the roster as it is now, not as it was that week** *(Verified, fixed in branch)*.
   - Where: `lib/redraft/scoringEngine.ts` (best ball). The standard weekly path at `:321-326` still reads the current roster.
   - Impact in Guilly+BB: the chop runs 24–48h after the week. Anyone added in that window counted for the closed week, and anyone dropped was erased from it — enough to change who is eliminated.
   - Fix: a player counts for whoever held him at his team's first kickoff that week (`lib/redraft/bestBallWeekRoster.ts`). The week finalizer seals the same set, so the week can still go final.
   - The daily path's per-day rule (`daysOnRoster`) could not be reused: per-day stat rows exist only for daily-lineup leagues.
4. **Chopped Guilly teams could still add free agents and trade** *(Verified, fixed in branch)*.
   - Where: `lib/roster-legality/rosterTransactionGates.ts` checked only `survivorGuillotineChop`.
5. **Classic Best Ball scheduled drafts never auto-started** *(fixed in branch)*.
   - Where: `lib/draft/startScheduledRedraftDrafts.ts` filtered `leagueType: 'redraft'`.
   - Now: Best Ball drafts start at their scheduled time, like redraft.
   - ⚠ Server autopick for absent managers still needs `DRAFT_TICK_CRON_ENABLED=true` on the worker. It defaults off, and its production value is unverified; it was not changed here because setting a Railway variable redeploys the service.
6. **The live wizard has no Best Ball setup** *(code-read)*. Every Best Ball choice the brief lists is silently defaulted, and the rules summary does not exist.
7. **The Best Ball tab read tables native scoring never writes** *(fixed in branch; screenshots checked in dark and light mode at desktop and phone width)*. Found while checking: `border-white/8` and `/6` are not generated by the app's Tailwind 3.4 config (374 and 35 uses app-wide), so those borders fall back to the default light grey. Avoided in this tab; the app-wide fix is open.

### P1 — integrity, automation and correctness gaps

8. **Overlapping waiver runs** could award the same player twice or lose FAAB *(fixed in branch)*.
   - Found while fixing: a team winning two claims in ONE run lost its first award and was charged from the stale balance. Also fixed.
   - Still open: instant free-agent adds take no lock.
9. **Autopick could draft an unusable roster** (no QB/G/SP) on the queue-first, draft-as-me and Chimmy/orphan branches *(fixed in branch)*. The orphan branch's wiring is covered by the shared guard's unit tests only, not by an end-to-end test.
10. **NBA/NHL/MLB draft rounds below roster capacity** (code-read: 13/17/24 rounds against 18/21/26 seats).
11. **The Guilly calendar is not validated** against teams − 1 or Final N length.
12. **Missing stats seal as zero** up to the 80% coverage floor, and post-seal corrections are never applied (Guilly: `statCorrectionHandler.ts` stub).
13. **Tournament renewal auto-completes the new season** (code-read).
14. **Weekly recap and power rankings crons 405 every week.**
15. **Private-league joins skip commissioner approval**; joins stay open after the draft; revoked links still work for private leagues.
16. **Commissioner Best Ball edits have no lock or audit**, and playoff/season-length edits are not applied.
17. **Secondary optimizers disagree with production** (greedy, hard-coded-slot DFS, the scoring-worker whole-roster fallback). Any UI or contest reading them shows different numbers from the matchup.

### P2 — clarity and polish

18. NBA/NHL/MLB labelled "daily" but computed weekly; `bbScoringPeriod` is unread.
19. "No playoffs" still writes 6 playoff teams; season-total leagues still crown a bracket winner when `playoffTeams > 0`.
20. Non-reproducible final Guilly tiebreak (`Math.random`/DB order).
21. `GuillySetup` refuses best ball and double chops for stale reasons.
22. My Team says "provider" for AF-hosted leagues; the War Room uses sport-default slots.
23. Best ball draft-rec AI is a stub.
24. `__tests__/guillotine-summary-escapes-route.test.ts` times out deterministically (likely unmocked DB imports).
25. `optimalLineup.ts` header cites `__tests__/commissioner-os/efl/optimalLineup.test.ts`, which does not exist.

---

## 4. Proposed presets (AF product choices, not copied from providers)

Provider rules were used as reference points only. Three of the six requested pages refused automated
fetching (HTTP 403: DraftKings, Underdog, Fantasy Life). Both NFBC MLB/Guillotine URLs served the lobby, not the
rules. NFBKC NBA was read directly. The rest comes from secondary coverage.

| | Reference point (provider example) | **Proposed AF default** | Existing executed default |
|---|---|---|---|
| NFL Classic | DK: 20 rounds; QB, 2RB, 3WR, TE, FLEX | 18 rounds; QB, 2RB, 3WR, TE, 2 FLEX (RB/WR/TE); no K/DST/IDP by default; half-PPR | 18 rounds, 9 starters (matches) |
| NBA Classic | NFBKC: 26 rounds; 4G, 4F, 2C, 2 FLEX; weekly; no moves | **Weekly** lineup; G, G, F, F, C, UTIL ×3 (8 starters); **18–20 rounds**, so the bench covers rest days and unequal game counts | 10 starters, 13 rounds, "daily" label |
| NHL Classic | Underdog: C, 2W, D, FLEX (skater), G; 16 rounds | Weekly; C, C, W, W, D, D, UTIL (skater only), G (8 starters); **18–20 rounds**; recommend 3+ goalies in the draft guidance | 13 starters, 17 rounds |
| MLB Classic | NFBC best ball (rules not retrievable); guillotine forum: 34-deep | Weekly; C, 1B, 2B, 3B, SS, OF ×3, UTIL (hitter), P ×7 (SP/RP-agnostic); **30–35 rounds** for injuries and demotions; a two-way player is **one asset** in one seat per week (hitter *or* P seat), whose weekly total includes both stat groups | 18 starters, 24 rounds |
| Guilly + BB | NFBC: the cut team's players go to the free-agent pool, claimed via FAAB | NFL weekly chop. NBA/NHL weekly chop after a complete opening period. **MLB: two weekly scores combined per elimination period.** Released players go into one blind FAAB run before the next lock. Trades off. Teams ≤ periods + 1. | Weekly for all sports; no multi-week periods |

**Policies to publish with every preset:**

- **Zero/inactive:** an inactive player scores 0 and can still fill a seat. Unfilled seats score 0 and are shown as unfilled.
- **Weekly ownership (implemented for best ball):** a player counts for the whole week for the team that held him at his team's first game of that week.
  - Added before that game: counts this week.
  - Added at or after it: counts from next week, so no points from games already played.
  - Dropped at or after it: still counts this week, so earned points stay.
  - Drafted and kept players count from season start.
  - If the schedule cannot be read, the current roster counts, as before.
- **Corrections:** a correction after a week is final changes standings but never reverses a chop or a crowned champion.

---

## 5. Automation inventory

| Routine task | Trigger | Recovery | Remaining human work |
|---|---|---|---|
| Draft start (Classic BB) | `draft-tick` every minute (fixed in branch) | Conditional claim on the session; setup blockers are retried each tick | None |
| Draft start (Guilly) | `draft-tick` every minute, only with autostart on | Conditional claim on the session | Turn autostart on |
| Autopick when away | `draft-tick`, only if `DRAFT_TICK_CRON_ENABLED` | Expired-pick processor | Unverified in production |
| Stat ingestion | `import-player-game-stats` daily; `import-scores` every 2 min; score-sync pulls each week | Next tick | None |
| Best ball weekly score | `/api/redraft/score-sync` every 5 min | Re-runs until sealed | None |
| Week sealing | score-sync finalizer | Named refusals, retried | Late corrections are commissioner-only |
| Standings | score-sync | Rebuilt after sealing | None |
| Guilly chop + release + FAAB split | score-sync → `runNativeGuillotineWeek` | Locks, unique index, audit row, resume | None |
| Survivor waivers | `/api/cron/waivers` every 5 min; `/api/redraft/waiver-process` hourly | Claim-level idempotency | None (but see the concurrency finding) |
| Tournament advance/finalize | score-sync | Serializable transactions; archive retried | "Recovery required" errors have no tool |
| Classic champion | `season-week-roll` hourly | Idempotent finalize | None |
| Depth alerts | `alert-sweep` every 15 min | Weekly claim | None |
| Weekly recap / power rankings | Scheduled, **always 405** | — | Everything |
| Renewal | Commissioner POST | Duplicate guard | Selecting returning managers (intended) |

**Manager strategy decisions** (intended to stay human): the draft, queue and rankings; FAAB bids in Guilly.
**Commissioner administration that should not be needed but is today:** applying stat corrections, and noticing a stalled tournament.

---

## 6. Implementation plan

1. **Land this branch.** It enforces Classic waivers/FA, the redraft trade path, chopped-team transactions,
   and optimizer dedup.
2. **Roster-as-of-week for best ball scoring** (P0-3) — **done in this branch**, with the weekly ownership
   rule above. Weeks already sealed are not re-scored. Still open: the standard weekly lineup path, and a
   per-day split for NBA/NHL/MLB if per-day stats are ever written for every league.
3. **Scheduled draft start for Classic Best Ball** and **the starter guard on every autopick branch** —
   **done in this branch**. Still open: confirm or set `DRAFT_TICK_CRON_ENABLED` on the worker (the user's call).
4. **Wire the live wizard to the existing Best Ball settings model**, and show a rules summary (lineup
   automation, transaction policy, season window, champion rule).
5. **Make the Best Ball tab read native scoring** — **done in this branch**. Still open: the My Team banner wording, and the app-wide `border-white/8` / `/6` classes that Tailwind 3.4 does not generate.
6. **Guilly calendar validation** at creation and on save (teams − 1 ≤ elimination periods; Final N fits).
   Add MLB two-week periods.
7. **Waiver-run mutex on every processing entry point** — **done in this branch**, plus the same-run
   double-award and a roster compare-and-set. Still open: make instant free-agent adds take the same lock.
   against the sealed version.
9. **Retire or repoint the greedy and DFS optimizers** to `computeOptimalLineup`.
10. Close joins after the draft; private join → approval; honour revoked links; reset `bbContestId` on
    renewal; add GET (or switch to POST) for the recap and power-rankings crons.

---

## 7. Checks performed, changes made, limitations

**Changes** (branch `fix/best-ball-transaction-gates`, PR #3321; the Zombie test mock got one added
delegate):

| File | Change |
|---|---|
| `lib/waiver-wire/season-phase-policy.ts` | `BestBallRosterPolicy`, `applyBestBallRosterPolicy`, three new refusal codes. It narrows and never widens a phase refusal. |
| `lib/waiver-wire/season-phase-gate.ts` | `resolveBestBallRosterPolicy`: native, non-guillotine Classic best ball only. Guilly+BB and imported leagues are explicitly excluded. |
| `lib/roster-legality/rosterTransactionGates.ts` | Refuses a roster with `GuillotineRosterState.choppedAt` set. |
| `lib/redraft/tradeProposalValidation.ts` | Refuses `TRADES_DISABLED` for best ball/guillotine leagues whose resolved trade settings disallow trades. |
| `lib/lineup-optimizer/optimalLineup.ts` | Dedupes players by `playerId` before seating. |
| `__tests__/bestball/best-ball-audit-2026-11.test.ts` | 19 tests. |
| `lib/redraft/bestBallWeekRoster.ts` (new) | The weekly ownership rule, shared by the scorer and the finalizer. |
| `lib/redraft/scoringEngine.ts` | `scoreRosterBestBall` reads the roster as of each player's lock (native leagues). |
| `lib/redraft/weekFinalizer.ts` | Best ball seals the same week roster it scores. |
| `__tests__/bestball/best-ball-week-roster.test.ts` | 12 tests: the ownership rule, the loader, the scorer end to end and the finalizer. Controls: switching the scorer wiring off fails 1; disabling the ownership filter fails 4; reverting the finalizer fails 1, sealing `wLate` instead of `wDrop`. |
| `lib/draft/redraftScheduledStart.ts`, `lib/draft/startScheduledRedraftDrafts.ts` | Classic Best Ball drafts start at their scheduled time. |
| `lib/live-draft-engine/autopickStarterGuard.ts` (new), `autopickBestAvailableSubmit.ts`, `slow-draft/SlowDraftRuntimeService.ts`, `lib/orphan-ai-manager/OrphanAIManagerService.ts` | One starter guard for every autopick branch. |
| `__tests__/live-draft-engine/autopick-starter-guard-all-branches.test.ts` (new), plus cases added to `autopick-fills-starters`, `scheduled-redraft-draft-start` and `redraft-scheduled-start-predicate` | Controls: reverting scheduled start fails 9+; removing the queue guard fails 2; reverting the resolver fails 1. The scan test was updated because it pinned `leagueType: 'redraft'`. |
| `lib/waiver-wire/process-engine.ts`, `claim-snapshot.ts`, `lib/automation/jobs/waivers/processLeagueWaiversJob.ts` | One run per league at a time; shared roster state within a run; compare-and-set roster write. |
| `__tests__/waiver-wire/waiver-run-serialization.test.ts` (new) | 7 tests. Controls: shared roster state off fails 1; run lock off fails 2; compare-and-set off fails 1. The mock writes unconditionally when no snapshot is sent, so the CAS test can fail. |
| `lib/bestball/nativeBestBallTab.ts` (new), `nativeBestBallTabLoad.ts` (new), `app/api/leagues/[leagueId]/bestball/handler.ts`, `app/league/[leagueId]/tabs/BestBallTab.tsx` | The Best Ball tab reads native scoring, with labels and reasons. |
| `__tests__/bestball/native-best-ball-tab.test.tsx` (new) | 12 tests: reasons, cards, loader, the API route and a render. Controls: tab reverted fails 1; late-stats branch off fails 1; handler reverted fails 1. |

**The 19 tests cover:**

- greedy-fail overlap
- duplicate rows
- negative scores in required seats
- unfilled seats
- deterministic ties
- weekly vs summed-daily
- NHL goalie seats against the real slot builder
- MLB pitcher/hitter separation
- MLB innings
- the best ball gate in four modes
- league detection, including Guilly and imported exclusions
- chopped rosters refused or allowed
- redraft trade refusals

**Positive controls:** reverting each source fix individually turned its tests red (1, 1, 2 and 2 failures),
then passed again on restore.

**Existing suites:** 267 files were selected — every best ball and Guilly test, plus every test that imports
or mocks a changed module.

- **First run:** `Test Files 4 failed | 260 passed | 3 skipped`, `Tests 10 failed | 3329 passed | 22 skipped`.
- **Two failures were mine, and both are fixed:**
  - a new refusal reason broke the repo's "every phase reason starts *Waiver claims are closed*" contract
    (reworded);
  - the Zombie trade-gate test's Prisma mock lacked the new `guillotineRosterState` delegate (added).
  - After fixing, those files pass: `3 passed (3)`, `57 passed`.
- **Not caused by this branch:**
  - `guillotine-summary-escapes-route.test.ts` fails the same way with the source changes stashed
    (30s timeouts on `origin/main`).
  - `redraft-trade-playoff-routes-contract.test.ts` timed out once on a cold import under load, then passed
    twice with the changes (`18 passed`). It mocks the validator this branch changes.

**Typecheck:** `scripts/ts-error-ratchet.mjs` reports **zero errors gained in all five changed source files**.

- The repo total (665 against a baseline of 136) is **not a valid measurement of this tree.**
- The worktree's `node_modules` is a junction to another checkout whose generated Prisma client predates
  322 lines of `origin/main`'s schema. For example, `PirateClaim` and `PirateProtectionSet` are absent from
  the client, and the gainers are almost all Zombie/Pirate files.
- A clean total needs `prisma generate` into an isolated `node_modules`, which was not done because it would
  rewrite a peer checkout's client.

**Limitations:**

- No database, no live league, no production data.
- Calendar boundaries and DST were not executed.
- No full simulated season per sport. The pure-function tests cover the consequential rules, but the
  end-to-end Classic and Guilly simulations the brief asks for need a seeded test database
  (`RUN_GUILLOTINE_CHOP_WEEK_DB` exists for Guilly) and were not run.
- Draft-round counts for NBA/NHL/MLB, tournament renewal, and the Android invite flow are code-read only.
- Production values of `DRAFT_TICK_CRON_ENABLED` and the cron service health are unverified.

---

## 8. Retention improvements

- **"Who counted" weekly card.** Per team: the scoring lineup, bench points left behind, and the
  best-ever week. It comes from the snapshots already stored, and it is the single most explanatory thing
  best ball lacks.
- **Weekly recap that actually runs** (fix the 405), with best-ball framing: the week's highest-scoring
  bench, and the late swap that would have mattered.
- **Draft review at draft close.** Positional depth against the preset's needs ("you have 2 goalies;
  winners average 3"), clearly labelled as projection.
- **Guilly danger alert.** Already exists and respects notification settings. Add "provisional until
  final" wording and the cut-line gap.
- **Released-player preview.** Before the FAAB run: who was released, with season points and remaining
  schedule. Include a FAAB reminder 12h before the run to survivors only.
- **Eliminated-manager spectator mode.** A follow-the-league view and a "pick the next chop" game (one
  exists, `nextChopPick`) so chopped managers stay engaged.
- **One-tap renewal** for Classic/Guilly, after fixing the tournament-contest reset.
- **Keep it quiet.** Classic managers get no lineup nags. Best Ball notifications are limited to results,
  recaps and draft events.
