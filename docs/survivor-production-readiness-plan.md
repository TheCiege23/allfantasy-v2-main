# Survivor production-readiness plan

Companion to `docs/survivor-readiness-audit-2026-10-20.md`. That document says where the code is. This one says how it gets to "a commissioner sets up the league, the system runs it, and the commissioner is only contacted when something is wrong" for NFL, NBA, NHL, and MLB.

## Definition of production ready

A league is production ready when all of the following hold for that sport:

1. A commissioner can create the league, set tribes, idols, Exile, scoring, and council rules from the wizard and settings, and never touch a database or a flag.
2. The draft starts itself, auto-picks expired timers, and hands off to tribes, idols, chats, and Exile with no click.
3. Every week opens, scores, awards immunity, opens council, collects ballots, reveals, eliminates, moves the loser to Exile, releases their roster, scores Exile, and advances with no click.
4. Merge, reshuffle, Exile return, jury, and finale resolve on schedule with no click.
5. A playing commissioner cannot see any hidden information from any surface, including Chimmy.
6. Every stall (missing scores past a deadline, unresolved tie, unclaimed seat at draft time, automation error) sends the commissioner a push or email with a one-tap fix.
7. A full season has been replayed on an isolated database with real provider fixtures and a multi-account browser rehearsal has passed for the draft, a council, a Torch Ceremony, and the finale.

## Defaults assumed where the audit left a question open

Work starts on these defaults. Each one is reversible, but changing it after Phase 2 costs a rework. Override any of them before Phase 1 ends.

| Decision | Default |
| --- | --- |
| Sport order | NBA → NHL → NFL → MLB |
| Cast size | 16–20 inclusive, any value; 24 deferred |
| Tribe membership | Written when the commissioner locks the pre-draft plan, so tribes exist before the draft; random draw at lock if no manual plan |
| Tribe names and images | Catalog stays the default; free-text rename and image upload added; AI generation deferred |
| Tribe plan size rule | Equal sizes computed from cast ÷ tribe count, replacing the fixed 4–6 rule |
| Idol placement | Types sealed at draft start (as now); idols bound to hidden pool players at draft start so a pick can carry one; plus 2 immunity idols seeded on undrafted players after the draft |
| Idol config | Pick mode gets a quantity per type; count range 1–12; random mode keeps 6–8 |
| Idol expiry | One league setting: "idols expire at merge" / "at N players left" / "week N"; shown in the reveal DM and the vault |
| Idol reveal | Private Chimmy DM (existing) plus a modal on next league load; push/email on the native path |
| Shot in the Dark | Setting with 1-in-4, 1-in-5, 1-in-6; default 1-in-6 |
| Non-voters | Each missing ballot is auto-cast for the voter's tribe's lowest-scoring active manager that week |
| Tie rule | Setting: "revote then rocks" (default) or "rocks immediately"; rocks is a seeded random draw among the tied, recorded in the audit |
| Re-voting | Allowed until the window closes (`voteChangePolicy = until_close`) |
| Council day/time | Per-sport defaults from `sportScheduleEngine` applied at creation; commissioner override stays |
| Reshuffle trigger | A tribe below 50% of the largest other tribe; commissioner chooses random redraw (default), manual reassign, or merge now |
| Post-merge random tribes | Setting "surprise tribe weeks" with a count; the runner picks weeks at random and splits the cast into two equal temporary tribes |
| Two-highest-tribes immune | Setting, off by default |
| Challenge FAAB rewards | Credit the real waiver budget |
| Tribe chat | Canonical store is `LeagueChatMessage` with `source = tribe_<id>` (what the UI reads); engines post there; channel name "Tribe Huddle"; `SurvivorChatChannel` kept for membership and archive only |
| `@chimmy` | Every `@chimmy` message, command or not, is private from every chat |
| Draft chat sync | On by default for Survivor; rows stay in league chat after the draft |
| Draft types | snake, linear, auction, offline, auto; `real_time` and `by_team` removed from the Survivor picker |
| Exile anchor | NFL QB, NBA C, NHL G, MLB C |
| Exile bidding | FAAB with a window that closes at a configured time before the week's first game; ties by waiver priority then stable ID |
| Exile autofill | Winning the anchor auto-fills the Exile roster from that real team by projected starters; manager may swap within the team |
| Exile boss | Chimmy-managed roster for every sport; non-playing commissioner is enrolled as a competitor; playing commissioner is not |
| Boss-win penalty | Setting: "everyone loses one token" (default) or "everyone else loses all tokens" |
| Finale | Runner opens jury voting at the finale ceremony time and settles at the deadline; abstaining jurors are skipped |
| Exact tie with a playing commissioner | Seeded draw, never a commissioner decision |

## Phase 1: Stabilize (NBA, closed league)

Goal: a closed NBA league with the existing rules can run start to finish with the automation flags on and nothing silently broken. Everything here is a bug fix, so it can ship behind no flag.

| # | Fix | Where |
| --- | --- | --- |
| 1 | Widen `LeagueChatMessage.source` to 64 chars (additive migration) | `prisma/schema.prisma:8090`, new migration |
| 2 | Point every engine chat post at `LeagueChatMessage` with the tribe/merge/exile source; delete the dead `/api/survivor/chat` read path or make it a thin alias | `survivorTribeChatProvisioning.ts`, `survivorMergeCast.ts`, `leagueChatPoster.ts`, `SurvivorSitOutEngine.ts`, `survivorEliminationService.ts` |
| 3 | Call `removeRosterFromTribeChat` from `resolveElimination`; grant the host read access to huddles on System B when the host is not playing | `survivorEliminationService.ts`, `messages/route.ts:75-90` |
| 4 | Route notifications, idol-setup, and tribes reads through `resolveSurvivorAccessContext` | `app/api/survivor/notifications/route.ts`, `idol-setup/route.ts`, `tribes/route.ts` |
| 5 | Exact tie: seeded draw for playing commissioners; keep the host option for non-playing hosts | `survivorVoteTallyService.ts:182-207`, `foundation/route.ts:524-536` |
| 6 | Runner opens jury voting at the configured time and calls `settleFinaleIfDue` each tick | `survivorPlannedSeasonRunner.ts:123`, `juryEngine.ts` |
| 7 | Rocks: either remove the dead legacy path and the schema default, or make `executeRocksDraw` set `eliminatedUserId` and clear `isTie` (Phase 2 builds rocks properly) | `rocksEngine.ts:122-130` |
| 8 | Non-planned council selection picks the lowest-scoring non-immune tribe | `gameStateMachine.ts:436-441` |
| 9 | Surface Exile League creation failure as a commissioner alert and a readiness blocker | `LeagueBootstrapOrchestrator.ts:270` |
| 10 | Privatize every `@chimmy` command result; create the per-user Chimmy channel or drop the legacy `chimmy:<userId>` write | `messages/route.ts:430-446`, `app/api/survivor/chat/route.ts:160-162`, `SurvivorDraftBootstrapService.ts:147-171` |
| 11 | Commissioner alerts for `lastError`, scores missing more than 6 hours past the window, unclaimed seats 24 hours before draft, unresolved tie, jury deadline missed | `survivorNotificationCatalog.ts`, `notificationEngine.ts` |
| 12 | Native idol path sends push/email `idol_found` | `survivorIdolProvisioning.ts` |

Tests: a vitest suite per fix, plus one integration test that runs `runPlannedSurvivorSeasonBatch` through a scripted 16-manager season on a local Postgres (extend `scripts/verify-nba-survivor-20-draft.ts` into a season verifier).

Exit: `scripts/verify-nba-survivor-season.ts` completes draft → 10 weeks → merge → jury → champion with zero commissioner calls, and the two-browser rehearsal spec passes on a workstation.

## Phase 2: Your rules, on NBA

Goal: the league plays by the owner's rules, not the pilot's.

1. **Tribes before the draft.** Locking the plan writes `SurvivorTribe` and `SurvivorTribeMember` rows; `initializeSurvivorPhase2` reuses them instead of creating new ones. Draft room reads tribe for each seat and shows a badge, emblem, and tribe colour on picks and the manager strip. Tribe free-text rename and image upload in the Tribes panel.
2. **Idol placement.** At draft start, bind the sealed idol types to random hidden pool players; when a pick lands on one, the idol moves to the drafter and the private DM fires. After the draft, seed two immunity idols on undrafted players. Pick mode gains per-type quantities. Expiry becomes one setting and appears in the DM, vault, and modal. Shot odds setting. Remove or hide the 20 catalog-only idols until their engines exist.
3. **Council rules.** Non-voter auto-cast. Rocks in the canonical tally with the tie-rule setting. Re-vote until close. Per-sport council defaults applied at creation.
4. **Challenges.** FAAB credits the real budget. Challenge immunity feeds the canonical council. Two-highest-immune setting. Tribe idol honoured in planned leagues.
5. **Reshuffle and merge.** 50%-of-largest trigger, three commissioner choices, manual mid-season assignment. Surprise two-tribe weeks post-merge.
6. **Draft types.** `auto` drafts the whole board from queues then ADP. `offline` completion goes through `completeDraftSession`. Draft chat sync default on for Survivor. Manager avatars written at seat claim. Round-one overlay copy: "With the Nth pick, {tribe} {manager} selects {player}".
7. **Idol reveal modal** on next league load for any unread private idol DM.

Exit: season verifier passes with every new setting at both extremes; privacy test suite proves a playing commissioner sees nothing hidden from any route including Chimmy.

## Phase 3: Exile Island as designed

1. Anchor map NFL QB / NBA C / NHL G / MLB C.
2. FAAB bid window on the anchor; claims resolve at window close under the league lock; losers' bids refunded.
3. Autofill from the anchor's real team by projected starters, respecting the Exile roster template; swaps within the team allowed until lock.
4. Chimmy boss roster for every sport (generalize `exileChimmyBoss.ts` from NBA).
5. Non-playing commissioner enrolled as an Exile competitor at creation; playing commissioner excluded.
6. Penalty setting (lose one / others lose all) and commissioner toggles for boss wins; both modes in the token engine.
7. Exile return for non-planned leagues scheduled from the same runner.
8. Exile chat posts into `LeagueChatMessage` with an `exile` source and an Exile tab in the chat UI.

Exit: Exile verifier runs 10 weeks with 4 exiles, a Chimmy win, each penalty mode, and one return.

## Phase 4: Operations and certification (NBA)

1. Set `DRAFT_TICK_CRON_ENABLED=true` and `SURVIVOR_PLANNED_SEASON_AUTOMATION_ENABLED=true` on `allfantasy-v2-worker`. Confirm `CRON_SECRET` and `APP_URL` in the Actions cron loop. Confirm NBA ADP rows for the season.
2. Remove the per-league enablement flag from the runner once Phase 1–3 verifiers pass, or keep it as a per-league "automation on" setting the commissioner sees.
3. Staging season replay on an isolated database with real NBA fixtures across a DST change, a postponed game, and a stat correction after seal.
4. Multi-account browser rehearsal on a workstation: schedule, draft with pause and correction, idol notice, huddle message, ballot, Torch Ceremony, Exile claim, finale.
5. Sentry alert rules on `survivorGameState.lastError` and on any cron tick that throws.
6. Commissioner runbook: what each alert means and the one action that clears it.

Exit: the closed league runs two real weeks with no commissioner action and no alert, then public invites open for NBA.

## Phase 5: Sports expansion

**NHL (smallest gap).** Allow NHL in `SURVIVOR_CREATION_SPORTS`; add `nhlSurvivorRosterEligibility`; readiness check for pool and ADP; sit-out engine generalized from NBA tipoff to first puck drop; Chimmy boss roster. Season plan and scoring already exist.

**NFL.** Add NFL to the planned-season runner with the redraft week calendar; Thursday / tribe / Monday-night challenge generator with real slate adapters (pick the TNF winner, tribe total, MNF player prop); scheduled council driver replaces the unscheduled `/api/survivor/automation` route; sit-outs keyed to the first kickoff; NFL Chimmy boss roster.

**MLB.** Add MLB to `SurvivorEligibleSport` and defaults; weekly stat sync (today it throws); season plan; daily-sport week windows already exist; Catcher anchor; challenge cadence 1–3 per week; Chimmy boss roster.

Each sport exits through the same Phase 4 gates.

## Sizing

| Phase | Estimate (one engineer, full time) |
| --- | --- |
| 1 Stabilize | 1 sprint (2 weeks) |
| 2 Rules | 2 sprints |
| 3 Exile | 1 sprint |
| 4 Ops and certification | 1 sprint, elapsed time dominated by real game weeks |
| 5 NHL | 1 sprint |
| 5 NFL | 2 sprints |
| 5 MLB | 2 sprints |

NBA public launch after Phases 1–4: roughly 10 weeks. All four sports: roughly 20 weeks.

## What the owner has to supply

1. Confirm or override the defaults table above.
2. Set the two worker flags when Phase 4 starts (or grant access to set them).
3. Fifteen to twenty test accounts for the browser rehearsal.
4. A verdict on the three real-vs-code conflicts the audit found: NBA anchor PG vs C, 40% vs 50% reshuffle, revote-then-points vs rocks.
