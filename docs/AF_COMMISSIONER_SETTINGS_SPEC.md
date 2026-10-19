# AllFantasy Commissioner Settings & Privileges — Product Spec

**Status:** Draft v1 · 2026-10-19
**Goal:** Make AllFantasy the most commissioner-friendly fantasy app. Every league type gets a
**Free** commissioner toolkit that already beats Sleeper/ESPN/Yahoo, and a **Commissioner
subscription** ($14.99/mo · $149.99/yr, see `AF_TIER_BILLING_BUILD.md`) that automates the work
commissioners do today in spreadsheets.

**Core promise:** *If a commissioner would need a spreadsheet for it, AllFantasy does it for them.*

---

## 0. Tier model

| Tier | Who | What it means for commissioner tools |
|---|---|---|
| **Free (account)** | Any commissioner with an AF account | Full league setup, every league type, the extra basic controls in §2, manual versions of every automation (AF shows the math, commish clicks apply) |
| **Commissioner sub** | Commissioner plan (and higher tiers that include it: Supreme, Legacy/War Room) | Automations that run on their own, advanced rule engines, imported-league tools for Sleeper/ESPN/Yahoo/Fleaflicker/MFL leagues, AI commissioner assistant |

Rules that apply everywhere:

1. **The league is entitled, not just the person.** A league's subscription features are unlocked when its
   commissioner (or any co-commissioner) holds the Commissioner plan. Managers in that league never need to pay
   to *benefit* from those settings.
2. **Downgrade never breaks a league mid-season.** If the sub lapses, or the paying commish hands the league to a
   non-subscriber, the league **stays unlocked until season rollover**: settings in effect stay in effect and
   automations already configured keep running (e.g., this season's rookie order still finalises itself). After
   rollover, subscription-only settings are read-only and automations fall back to "AF calculates, commish clicks
   apply" until a commish or co-commish subscribes.
3. **Every automated action is previewed, logged and reversible.** Each automation posts a preview to the
   commish ("Rookie order updated after Semifinals — review"), writes to the commissioner audit log, and has a
   one-click undo until the next dependent event (e.g., until the draft starts).
4. **Transparency to the league.** Commish can choose to auto-post results (draft order, keeper costs, bracket)
   to league chat with a shareable graphic.

Feature keys (proposed, for the entitlement engine): `commish.rookieOrderAuto`, `commish.keeperRulesAdvanced`,
`commish.playoffsCustom`, `commish.importAssist`, `commish.aiAssistant`, plus per-format keys listed in §5.

---

## 1. Headline features

### 1.1 Automatic rookie / next-season draft order (Commissioner sub; manual calc is Free)

**Problem today:** On Sleeper with "reverse max PF for non-playoff teams, playoff teams by finish, champ picks
last, runner-up second-to-last", the commish has to build the order by hand at the end of the regular season,
then wait for every playoff round to finish and finish the spreadsheet.

**AF behaviour:** AF owns the draft order as a **living object** that fills itself in as the season ends.

#### Settings

**A. Non-playoff teams are ordered by** (pick one, plus tiebreakers):
- Reverse **max PF** (potential points / optimal lineup points) — *default for dynasty*
- Reverse standings (W-L, then tiebreakers)
- Reverse **points for**
- Reverse **all-play record**
- Weighted lottery (uses existing `lib/draft-lottery/WeightedDraftLotteryEngine.ts`), with odds based on any of the above
- **Toilet-bowl / consolation bracket result** (anti-tank: winner of the consolation bracket gets #1)
- Hybrid: lottery for the first *N* picks, the rest by the chosen metric
- Tiebreakers (ordered list): max PF → PF → record → head-to-head → points against → coin flip (seeded, logged)

**B. Playoff teams are ordered by** (pick one):
- **Playoff finish, then seed** — *default*. Champion picks last, runner-up second-to-last, then 3rd/4th (if a
  3rd-place game exists, else semifinal losers ordered by the tiebreak below), then quarterfinal losers, etc.
- Playoff finish, then reverse max PF *within each elimination round*
- Reverse regular-season standings (ignore playoff result)
- Reverse max PF (ignore playoff result)

**C. Within an elimination round** (teams that lost in the same round), order by:
- Worse seed picks earlier (**default**, owner decision 2026-10-19) · reverse max PF · reverse PF · lottery

**D. Applies to:** Round 1 only · all rounds (same order) · snake/linear/3rd-round-reversal follow-on.

**E. Traded picks:** picks follow the **original owner's slot**. AF shows "2027 1.03 (via Team X)" on every pick
the moment Team X's slot locks.

#### Timeline (automatic)

| Moment | What AF does |
|---|---|
| Final regular-season week is final (after stat corrections window) | Locks slots 1…(N − playoff teams) using setting A; playoff teams placed in **provisional** slots by seed |
| Each playoff round ends | Teams eliminated that round are locked into their tier (setting B/C); notification + chat post |
| Championship final | Remaining slots locked; order marked **Final** |
| Season rollover (dynasty "convert to new season") | Final order written onto the new season's draft board automatically, pick ownership preserved, managers notified |

Every slot shows **why** it landed there (e.g. "Pick 3 — 1,412.6 max PF, 3rd lowest").

#### Imported leagues (Sleeper, ESPN, Yahoo, Fleaflicker, MFL)
AF runs the same engine on ingested data. For Sleeper: `rosters[].settings` gives `fpts`, `fpts_against`, `ppts`
(max PF) and `/winners_bracket` + `/losers_bracket` give playoff results. AF can't write the order back (Sleeper's
API is read-only), so AF produces:
- the final order with reasons,
- a step-by-step "set it in Sleeper" checklist (Draft → Draft order → drag Team X to slot 1 …),
- a shareable graphic for league chat.

Free: one-time calculation on demand after the season. Commissioner sub: live updates each playoff round,
notifications, rollover automation, history of past orders.

---

### 1.2 Keeper league engine (basic in Free, advanced rules in Commissioner sub)

When the **keeper deadline** passes, AF locks every team's keepers and **places them on the draft board** in the
round they cost. Managers see their cost before the deadline; the commish sees a league-wide grid.

#### Keeper cost rule (one primary rule per league)

Definitions used by the UI (confirmed by the owner 2026-10-19), shown with an example next to each option:
**"Up" = earlier round** = more expensive (R5 → R4). **"Down" = later round** = cheaper (R5 → R6).

| Rule | Example (drafted R5 last season) | Tier |
|---|---|---|
| Match player's round from previous season | Costs R5 | Free |
| One round **later** than previous season ("one round down") | Costs R6 | Free |
| One round **earlier** than previous season ("one round up") | Costs R4 | Free |
| Escalating: earlier by *X* rounds per consecutive year kept | Yr1 R5, Yr2 R4, Yr3 R3 | Sub |
| ADP-based: cost = round of current ADP (± X rounds) | ADP 3.07 → R3 | Sub |
| Auction: last price + $X or + X% | $22 → $27 | Sub |

#### Modifiers (combine with the primary rule)

| Modifier | Detail | Tier |
|---|---|---|
| **Waiver / free-agent pickups cost round [X]** | Undrafted pickups cost round X (default: last round). Option: "round X or later if picked up after week Y" | Free |
| **Two keepers in the same round** | Options: (a) lose that round **plus the round before** — **default** (owner decision 2026-10-19); (b) lose that round **plus the round after**; (c) next-available earlier round; (d) next-available later round; (e) not allowed — validation blocks it | Sub (a/b), Free (e) |
| Round floor | Keeper can never cost earlier than round X (e.g., Round 1 players can't be kept) | Free |
| Max years kept | Player can be kept N seasons, then returns to the pool | Free |
| Max keepers per team | 0–N; optional per-position limits | Free |
| Traded player keeps original cost | vs. cost reset to receiving team's slot | Sub |
| Mid-season trade of draft-pick-tied keepers | Cost travels with the player | Sub |
| Default if a manager doesn't submit | Keep none · keep previous keepers if eligible · AF auto-picks best value | Sub |
| Keeper cost of a pick you traded away | Option: forfeit next-earliest owned pick | Sub |

#### Automation at deadline
1. Lock submissions, apply default rule to non-submitters.
2. Resolve same-round conflicts with the chosen rule (shows the forfeited picks).
3. Place keepers on the draft board in their cost slot; forfeited picks are greyed out.
4. Post the keeper grid to chat; draft room opens with keepers pre-filled.

Imported leagues: AF computes costs from the other platform's draft results + transactions and gives the
commish the grid and a "set keepers in Sleeper/ESPN" checklist.

---

### 1.3 Custom playoffs (standard in Free, custom brackets in Commissioner sub)

Everyone else ships the same 4/6/8-team bracket. AF lets the commish design the playoffs.

| Setting | Free | Commissioner sub |
|---|---|---|
| Playoff teams | 4, 6, 8 (standard) | **Any number 2 – 16 including odd (3, 5, 7, 9, 11…)** |
| Byes | Standard (top-2 in 6-team) | **Grant any number of byes to top seeds**, including multi-round byes for the #1 seed |
| Play-in games | — | Lowest seeds play a play-in week before Round 1 |
| Re-seeding | Fixed bracket | Fixed **or** re-seed after every round (top remaining seed plays lowest) |
| Matchup length | 1 week | 1 or 2 weeks per round (e.g., two-week championship) |
| Seeding method | Record | Record · PF · max PF · all-play · division winners guaranteed top seeds · wildcard by PF/max PF |
| Consolation | On/off | Consolation bracket, **toilet bowl** (loser gets punishment flag), 3rd-place game, 5th-place game |
| Ties in playoffs | Higher seed advances | Higher seed · bench points · max PF · co-advance (multi-week only) |
| Playoff start | End of reg. season | Any week; validation keeps final before the sport's last week |

**Bracket engine rule:** bracket size = smallest power of 2 ≥ playoff teams; byes = size − teams, given to top
seeds; commish may add extra byes, which converts the lowest seeds' Round 1 into play-in games. Validation shows
the number of weeks the bracket needs and blocks configs that overrun the season.

Examples AF must support out of the box:
- **5 teams:** #4 vs #5 play-in; then #1 vs winner, #2 vs #3; final. (3 rounds)
- **7 teams:** #1 bye; #2v#7, #3v#6, #4v#5; then re-seed or fixed. (3 rounds)
- **9 teams:** #8 v #9 play-in, winner joins an 8-team bracket. (4 rounds)
- **6 teams, top seed double bye:** #1 waits until the final four… (custom bye)

The bracket feeds the rookie-order engine (§1.1) directly, so the draft order is always consistent with whatever
bracket the commish designed.

---
## 2. Universal commissioner controls (every league type)

These apply to every format. Format-specific settings in §4 build on top of them.

### 2.1 Free — "extra basic controls" (things other apps don't give a free commish)

| Area | Control |
|---|---|
| Co-commissioners | Up to 2 co-commishes with **granular permissions** (scoring, rosters, trades, money, chat moderation) instead of all-or-nothing |
| Roster overrides | Add/drop/move any player for any team, set any lineup before lock, with a required reason that's visible in the audit log |
| Score adjustments | Manual point adjustment per matchup with reason (stat-correction disputes, penalties) |
| Trade review | Veto mode: none · commish · league vote (threshold %) · commish + vote; review window 0–72 h |
| Trade deadline | Week + day + time, separate deadlines for player trades and pick trades |
| Waivers | FAAB / rolling / reverse standings; waiver time and day per week; hold period after drops |
| Inactive managers | Flag a team inactive → AF auto-sets the best lineup weekly until the manager returns |
| Announcements | Pinned announcements + scheduled posts to league chat |
| League rulebook | Rulebook page auto-generated from settings (always matches what's configured) plus free-text house rules |
| Audit log | Full, league-visible log of every commish action (toggle: visible to league / commish only) |
| Polls | League polls for rule changes with % threshold and deadline |
| Dues tracker | Who has paid, amount, method (tracking only — AF holds no money) |
| Settings lock | Lock any setting for the season so it can't change mid-year without a league vote |
| Manual automations | Every Commissioner-sub automation is available as a **"calculate for me"** button: AF shows the result, the commish applies it |

### 2.2 Commissioner subscription — the in-depth toolkit

| Area | Control |
|---|---|
| Automations | Rookie order (§1.1), keepers (§1.2), playoffs (§1.3), rollover, weekly awards — run on their own, previewed and undoable |
| Season rollover wizard | One flow: final draft order → keeper/taxi deadlines → contracts/salaries roll → dues reset → schedule for next season → invite link |
| AI commissioner assistant (Chimmy) | "Draft our rulebook", "is this trade collusion?", "what would standings be if we'd used 0.5 PPR?", "explain this week's chop" |
| Trade fairness review | AI fairness grade + collusion signals (repeated lopsided trades between the same two teams, dump trades by eliminated teams) |
| Rule-change simulator | Re-score last season under proposed settings before a league vote (scoring, playoff format, draft order method) |
| Custom schedule builder | Rivalry weeks, divisional weeks, doubleheaders, manual matchup editing, schedule import from a spreadsheet |
| Divisions & conferences | Any number; division winners' seeding rules |
| Custom scoring | Per-position scoring, bonuses (100-yard, 40+ yd TD), negative scoring, decimal precision, league-specific stat categories |
| Penalty & punishment tracker | Last-place punishment, toilet bowl loser flag, lineup-violation penalties (e.g., −5 for starting an empty slot) |
| Anti-tank tools | Toilet-bowl draft order, lineup minimums for eliminated teams, "max PF" order (already rewards playing it out) |
| Payout calculator | Splits for 1st/2nd/3rd, weekly high score, regular season #1 — tracked and posted, not paid out by AF |
| Manager replacement | Post an orphan team to the AF "open teams" board; transfer team history to the new manager |
| League history | Import past seasons from Sleeper/ESPN/Yahoo/MFL → record book, champions wall, all-time standings, rivalries |
| Imported-league assist | All the above calculators for leagues that live on other platforms, plus checklists to apply the result there |
| Notifications | Auto-reminders to managers with empty lineup slots, unsubmitted keepers, unpaid dues, upcoming deadlines |
| Branding | League logo, trophy name, custom recap graphics |

---

## 3. More ideas to make AF *the* commish-friendly app

Ranked by how much commish pain they remove. ★ = recommended for the first build.

1. ★ **"Commish Inbox."** One queue of everything waiting on the commish: trades to review, disputes, unsubmitted
   keepers, unpaid dues, expired lineups, draft-order confirmations. Clear it and you're done for the week.
2. ★ **Dispute desk.** Managers file a dispute (stat correction, lineup glitch, trade complaint); the commish rules on
   it with a canned ruling template; the ruling posts to chat and the audit log. Optional league vote.
3. ★ **Constitution builder.** Wizard that writes the league constitution from settings + a few questions, versioned,
   with "proposed amendment" → league vote → auto-applies the setting change at the next season.
4. ★ **Platform-agnostic commish tools.** Everything in §1 works on imported Sleeper/ESPN/Yahoo/Fleaflicker/MFL leagues.
   This is the acquisition funnel: commishes who don't want to move their league still pay for AF.
5. **Deadline autopilot.** Every deadline (keeper, trade, taxi, franchise tag, contract, idol play) gets reminders
   at 72 h / 24 h / 1 h to the managers who haven't acted.
6. **Weekly league recap.** Auto-generated recap (top score, biggest upset, bench blunders, chop/eviction drama)
   that the commish can edit before it posts.
7. **Lineup-integrity monitor.** Flags teams starting injured/bye/empty slots after lock — evidence for a tank or
   inactivity ruling.
8. **Scenario explainer for managers.** "What do I need to make the playoffs / avoid the chop / get the #1 pick?"
   — reduces the questions commishes get in chat.
9. **Draft-day kit.** Draft order reveal animation, draft-slot lottery show, printable board, keeper pre-fill,
   auto-pick rules for absent managers.
10. **Commish reputation.** Opt-in commish rating from managers ("well-run league" badge) — helps commishes recruit
    for open teams.
11. **Rule templates library.** Save a league's full settings as a template; share it; start a new league from a
    popular template (e.g., "Superflex TE-premium dynasty, reverse max PF").

---
## 4. Settings by league type

The 12 formats are `LeagueTypeId` in `lib/league-creation-wizard/types.ts` / `FORMAT_REGISTRY` in
`lib/league/format-engine.ts`. Every format gets everything in §2. The tables below add what's specific to that
format. **Free** = any commish with an account. **Sub** = Commissioner plan.

### 4.1 Redraft
| Free | Sub |
|---|---|
| Standard playoffs (4/6/8), standard byes, consolation on/off | Custom playoffs (§1.3): odd counts, extra byes, play-ins, re-seeding, 2-week final |
| Waiver type, FAAB budget, trade deadline | FAAB min bid / $0 bids, conditional waivers, waiver lock on game day |
| Draft order: random or manual | Draft-slot lottery show, "pick your slot" order by last year's finish, KDS (draft slot choice) |
| Scoring presets | Custom scoring tables (`advanced_scoring`), position-specific bonuses |
| — | Anti-tank: lineup minimums, toilet-bowl prize/punishment |

### 4.2 Dynasty
| Free | Sub |
|---|---|
| Rookie draft order: worst-to-first or reverse PF, **calculated on demand**, commish clicks apply | **Auto rookie order** (§1.1): reverse true max PF, playoff finish + seed, live updates per playoff round, written onto next season at rollover |
| Taxi squad size + eligibility (rookies / 1st–2nd year) | Taxi rules: lock after week X, max years on taxi, promote-only windows, taxi stealing (claim another team's taxi player) |
| Future pick trading (1–3 years out) | Conditional pick trades ("becomes a 1st if Team X misses playoffs"), pick-protection |
| Season rollover (manual) | Rollover wizard (§2.2): order → taxi → contracts → dues → schedule |
| IR slots | IR rules: OUT-only, auto-move to bench when activated |
| — | Weighted rookie lottery (existing lottery engine), anti-tank "toilet bowl gets #1" |
| — | Orphan team auction / dispersal draft for abandoned rosters |

### 4.3 Keeper
| Free | Sub |
|---|---|
| Keeper count, max years, deadline, max per position | Escalating, ADP-based and auction keeper costs |
| Cost rule: same round / 1 round later / 1 round earlier | Same-round conflict rule: lose that round + the round before (default) or after, or bump to next open round |
| Waiver pickups cost round X (default last) | Waiver pickup cost by pickup week ("after week 8 = round 10") |
| Round floor (e.g., R1 can't be kept) | Traded keepers keep original cost; non-submitter default (AF picks best value) |
| Keepers pre-filled on the draft board at deadline | Keeper value report: surplus value of each candidate vs. its cost, shared to managers before the deadline |

### 4.4 Best ball
| Free | Sub |
|---|---|
| Auto optimal lineup, roster size, draft | Best-ball **tournament mode** (multiple leagues → advance on total points) |
| Season-long standings by total points or H2H | Advance rounds (top N by points advance each X weeks) |
| — | Guillotine best ball (§4.5) and survivor best ball |

### 4.5 Guillotine (incl. best-ball guillotine)
| Free | Sub |
|---|---|
| Roster mode: standard **or best ball** (both already supported by `GuillotineValidation`) | Teams chopped per week by schedule (e.g., 1/wk then 2/wk after week 10) |
| First chop week, teams per chop | **Double-chop weeks**, "no-chop" holiday weeks, final-N format (final 3 play for title over last 2 weeks) |
| Tiebreak order, stat-correction window | Released-player rules: FAAB reset amount, release timing (instant / next waiver run / blind auction) |
| Chop announcement post | **Immunity**: weekly top scorer is chop-proof next week; buy-back (re-enter once by FAAB bid) |
| — | Chop drama recap + danger-zone alerts to the bottom 3 before lock |

### 4.6 Survivor (idols, tribes, jury)
| Free | Sub |
|---|---|
| Tribes, merge week, jury start, elimination by vote or by low score | **Idol settings**: number of idols, random vs commish-picked types, which of the 20 catalog idols are live, hidden from commish, expiry week, play deadline before lock |
| Exile island on/off | Per-idol tuning: point surge %, tribute %, vote steal, extra vote, immunity; "idols are transferable / tradeable" |
| Vote visibility (public / revealed at tribal) | Tribe swaps (weeks + method), Redemption/Edge of Extinction returns, final-tribal format (final 2 or 3) |
| — | Commish "host mode" with AI host narration (`survivor_host_ai`) |

**Build note:** only 4 of 20 catalog idols have play engines today (`lib/survivor/survivorIdolEngines.ts`). The
picker should only offer idols that have an engine and grey out the others as "coming soon".

### 4.7 Big Brother
| Free | Sub |
|---|---|
| HOH / nominations / veto / eviction schedule, final nominee count | **Twists**: double/triple eviction, battle back, secret HOH, America's vote, hidden powers, safety pass (already modelled in `premiumEngineSpec`) |
| Jury start, finale (final 2 / final 3) | Custom competition rotation, Have-Not penalties, consecutive-HOH rule |
| Vote visibility, auto-nomination fallback | AI host and diary-room recaps (`big_brother_host_ai`) |
| Pause the game (holiday / emergency) | Scheduled twist calendar (commish sets twists ahead, hidden from houseguests) |

### 4.8 Zombie
| Free | Sub |
|---|---|
| Infection rule (loss to a zombie = infected), starting zombie count | Cure/antidote items, horde bonuses, zombie-only waiver pool |
| — | Weekly event cards (blood moon double-infection week, safe-house immunity) |

### 4.9 Salary cap
| Free | Sub |
|---|---|
| Cap amount, min salary, auction startup | Contract years, rookie-scale contracts, franchise tag, cap holds, dead money on cuts |
| — | Cap-space trading, mid-season extensions, contract escalators; AI cap advice (`commissioner_cap_advice`) |

### 4.10 Devy and C2C (Campus to Canton)
| Free | Sub |
|---|---|
| Devy slots, college roster size | Devy/C2C rookie order uses the same engine as §1.1; graduation rules (auto-promote when drafted to NFL/NBA) |
| — | Devy pick trading, separate devy draft order, AI devy scouting (`commissioner_devy_scouting`) |

### 4.11 Tournament
| Free | Sub |
|---|---|
| Bracket size, advancement by points | Multi-league tournaments with redraft between rounds, custom seeding, odd brackets, byes (§1.3 engine) |

### 4.12 Concept leagues (survivor-guillotine, royal, pirate/vampire, king of the hill)
Inherit the base format's Free settings; the concept itself and its special rules are Sub.

---

## 5. What already exists vs. what to build

Mapped from the current codebase (2026-10-19). Paths are relative to the repo root.

| Feature | Exists | Gap to close |
|---|---|---|
| Tier gating | `lib/subscription/FeatureGateService.ts`, `requireEntitlement.ts`, feature matrix in `lib/monetization/feature-monetization-matrix.ts` (`commissioner_automation`, `advanced_playoff_setup`, `advanced_scoring`…) | Add the new keys (below); gate by **league** (any commish/co-commish entitled), not only by user |
| Rookie order | `lib/league/rookieDraftOrder.ts` (worst_to_first, reverse_max_pf), route `app/api/commissioner/leagues/[leagueId]/rookie-draft-order` | "Max PF" is really points-for; playoff teams ordered by `currentRank`, not bracket results; route has no entitlement check. Reuse the true max PF engine from `lib/commissioner-os/efl/maxPfEngine.ts` and bracket placements |
| Draft lottery | `lib/draft-lottery/` (weighted, eligibility, tiebreaks) | `maxPf` = `pointsFor` in `standingsForLottery.ts`; `reverse_max_pf` fallback coerced to reverse standings; non-lottery teams placed by rank not playoff finish |
| Sleeper ingest | `fpts_against` stored; bracket placements in `lib/league-import/sleeper/bracketPlacements.ts`; draft order in `draftArchiveMetadata.ts` | `ppts` (Sleeper's max PF) is read but not stored — store it as a cross-check; compute true max PF from weekly player scores |
| Keepers | `lib/keeper/` — round_based, inflation, auction (stub), free; conflict rule player_chooses / reject_both; waiver = last round | Add "1 round later", same-round **lose adjacent round** and **bump** rules, waiver = round X, auction cost based on real price (not the $40 stub); merge with `lib/league/keeper-policy.ts` so there's one cost model |
| Playoffs | `PlayoffBracketConfigResolver.ts` (counts, byes, consolation, toilet bowl, 3rd place) | `lib/redraft/oddPlayoffBracket.ts` already supports 3/5/7/9/11 but **nothing calls it**, and `redraftDefaults.ts` forces even counts. Wire it in behind `advanced_playoff_setup`; add play-ins, custom byes, re-seeding |
| Co-commissioners | Roles in `LeagueSettingsPermissionsService` | `lib/commissioner/permissions.ts` excludes co-commishes; add granular co-commish permissions |
| Survivor idols | `SurvivorIdolConfig`, 20-idol catalog | 16 idols without engines; Survivor runtime flagged not production-safe in `capabilities.ts` |
| Big Brother twists | `premiumEngineSpec` | Expose twists in commish settings UI behind the Sub |

### Build status

- **Rookie order engine — built (2026-10-19).** `lib/rookie-order/`: pure engine (`rookieOrderEngine.ts`), playoff
  game adapters for native and Sleeper brackets, a loader for both, and `liveRookieOrderService.ts` (settings,
  Commissioner gate, lapse rule, saved final order). API: `GET/PUT /api/commissioner/leagues/[leagueId]/rookie-draft-order/live`.
  The live draft seats the saved order through `resolveRookieDraftSlotOrderForLeague`.
  Not yet: commissioner UI, chat post after each playoff round, true Max PF for native leagues (they fall back to
  points for with a warning), toilet-bowl and lottery options.

### Proposed new feature keys
`commish_rookie_order_auto`, `commish_keeper_rules_advanced`, `commish_playoffs_custom` (or reuse
`advanced_playoff_setup`), `commish_import_assist`, `commish_rollover_wizard`, `commish_inbox`,
`commish_rule_simulator`, `commish_guillotine_advanced`, `commish_survivor_idols`, `commish_bb_twists`.

### Suggested build order
1. **Rookie order engine** (true max PF + bracket placements + live per-round updates + rollover write) — the flagship.
   Works for native and Sleeper-imported leagues on day one.
2. **Odd-count playoffs + custom byes** — the code mostly exists; wire `oddPlayoffBracket.ts` in and lift the even-count rule.
3. **Keeper cost rules + auto board placement at deadline.**
4. **Commish Inbox + deadline autopilot** (§3.1, §3.5) — the everyday "this app does my job" feeling.
5. Format-specific Sub settings (guillotine schedule/immunity, survivor idol picker, BB twist calendar).

---

## 6. Owner decisions

**Decided by the owner (2026-10-19):**
1. **"Up" = earlier round** (more expensive, R5 → R4); **"down" = later round** (cheaper, R5 → R6).
2. **Same-round keeper conflict default:** lose that round **plus the round before**. Commish can switch to "round
   after" or a bump rule.
3. **Imported-league tools** (rookie order, keepers, playoffs calculators for Sleeper/ESPN/Yahoo/MFL leagues) are
   part of the **Commissioner plan** — no separate add-on. Free keeps the one-time on-demand calculation (§1.1).

4. **Playoff teams eliminated in the same round:** the **worse seed picks first** (default; commish can switch to
   reverse max PF or reverse PF).
5. **Commish handoff mid-season:** if the paying commish hands the league to a non-subscriber, the league **stays
   unlocked until season rollover**, then falls back to Free behaviour unless a commish/co-commish subscribes.

No open questions remain.
