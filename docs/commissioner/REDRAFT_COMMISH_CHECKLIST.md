# Redraft commissioner — what's built, what's open, what's next

The working checklist for the **redraft** commissioner experience. We finish redraft first, then move
to dynasty, keeper and the specialty formats. Product source: `docs/AF_COMMISSIONER_SETTINGS_SPEC.md`
(PR #2494). **Free** = every commissioner; **Plan** = the Commissioner subscription; **Free / Plan** = a
manual or partial version is free and the automation or full version is on the plan; **no gate** =
the code checks no entitlement and the tier is still to be decided (none left in this list).

**Status key:** ✅ merged to `main` · 🟡 open PR (not merged) · ⬜ planned, not started. A ✅ row that ships part of its line says what is left in its notes.

⚠ "Merged" means the code is on `main`, **not** that it is live. `allfantasy-v2-main` deploys in batches
(`.github/workflows/railway-deploy.yml`, ~18–35 min after a merge), and cron-driven parts run on the
worker, which follows `worker-release` and moves about once a day. Check
`/api/af-debug/sha` before saying a feature is in production.

_Last updated: 2026-10-26 — rows re-checked against `main`: league log and undo merged, consolation and draft-order work by another session recorded, play-in split out. Earlier: 2026-10-20 — every PR in the three built sections has merged (#2507 last, on 2026-10-22). Tiers set 2026-10-20: rule templates and the reputation badge are Free; the constitution builder stays Free with Plan extras._

## Running the week

| | Feature | Tier | PR |
|---|---|---|---|
| ✅ | **Weekly commissioner checklist** — "This week · week N": scores final, waivers running, lineups set, trades waiting on you, dues, deadline heads-ups; each done or to do, linked to its fix | Free | #2575 |
| ✅ | Commish inbox — keepers, AI alerts, integrity flags, join and adoption requests, dues, payouts in the action queue | Free | #2500 |
| ✅ | Dispute desk — members file, commissioners rule | Free | #2501 |
| ✅ | Lineup-integrity monitor — finished-week lineups that could not score (latest week free, full season on the plan) | Free / Plan | #2507 |
| ✅ | Tanking scan fix — reads the week's saved lineup | Free | #2508 |
| ✅ | Deadline autopilot — 72h / 24h / 1h reminders to managers who still have to act (ships off: set `DEADLINE_AUTOPILOT_ENABLED=1` — exactly `1` — on the `allfantasy-v2-worker` service; live once the code reaches `worker-release`) | Free / Plan | #2503 |
| ✅ | Weekly recap review — edit Tuesday's recap before it posts | Free | #2506 |
| ✅ | Scheduled announcements — write it now, posted at the time you pick | Free | #2565 |

## Rulings and control

| | Feature | Tier | PR |
|---|---|---|---|
| ✅ | Score adjustments — add or take away points per matchup, with a reason in the audit log | Free | #2540 |
| ✅ | Co-commissioner permissions — up to 2, each limited to scoring / rosters / trades / money / chat / league setup | Free | #2564 |
| ✅ | Settings lock — lock areas for the season; mid-season changes need a league vote | Free | #2568 |
| ✅ | Trade deadline enforced server-side (other session) | Free | #2554 |
| ✅ | Trade deadline day + time — trades close at the moment the commissioner picks (league timezone) or after the deadline week, whichever comes first | Free | #2582 |
| ✅ | League log — every commissioner action in plain words, readable by the league unless set commish only; the raw audit rows are now commissioners-only | Free | #2657. Chimmy reads the latest entries the viewer may see (#2738). |

## Rules, playoffs and the league's identity

| | Feature | Tier | PR |
|---|---|---|---|
| ✅ | Commissioner-granted byes + bracket format picker (odd playoff counts stay free) | Free / Plan | #2498 |
| ✅ | Playoff seeding by record (other session). Its head-to-head-first tiebreak was reversed by #2590: points for now breaks record ties first, everywhere (owner decision 2026-10-20) | Free | #2557 |
| ✅ | Custom tiebreaker order — head-to-head, points for, fewest points against, all-play, coin flip, in the commissioner's order; standings and playoff seeds both follow it | Plan | #2590 |
| ✅ | Constitution builder — generated from settings, versioned, amended by league vote | Free / Plan | #2505 |
| ✅ | Rule templates library — save, share, start leagues from them | Free | #2525 |
| ✅ | Draft-day kit — order reveal / lottery show, printable board, absent-manager clock | Free | #2518 |
| ✅ | Scenario explainer — #1 pick and elimination odds | Free | #2510 |
| ✅ | Commish reputation — opt-in "Well-run league" badge | Free | #2521 |

## Next for redraft (the plan, in order)

| | Feature | Tier | Notes |
|---|---|---|---|
| ✅ | One-tap stat-correction review before standings move | Free | #2663 detects: for 6 days after a week is final, the score cron re-checks its stats hourly and shows the commissioner (League settings → Score adjustments) which scores would change and whether a result flips. #2700 applies: Apply per matchup or Apply all posts each team's correction as a tagged score adjustment, so the result, standings and league log move together, once. With AF Commissioner's Extended scoring corrections on (#2699) the same corrections apply automatically for 14 days; the two paths count each other's adjustments, so a correction never lands twice. Never applied in elimination formats or once playoff seeds are set. Native NFL points leagues; team defenses and players dropped since the week are not re-checked. |
| ✅ | Undo for commissioner actions until the next dependent event | Free | #2707, spec rule §0.3. Undo in the league log for FAAB, waiver-order and standings edits: for 24h, while the value is still what was set, until waivers run (FAAB, waiver order) or anything else writes the standings row. Commissioners and co-commissioners. **Not yet undoable:** settings changes and roster/lineup overrides (overrides need a before-snapshot first). |
| ✅ | Trade review window that explains itself to managers | Free | The review window opens when the receiver accepts (`League.tradeReviewHours`, 48 by default — the existing setting, now enforced). The trade goes through when it ends unless vetoed; before, it silently expired. Each pending trade in the Trade Center says who reviews it, the vote tally and when it goes through. #2710; Commish OS files a task for each trade in commissioner review (#2736) and Chimmy can say when a trade goes through (#2738). |
| ✅ | Inactive manager mode — AF sets the best lineup weekly | Free | Commissioner Hub card: the commissioner (or a co-commissioner) hands a team's lineup to AllFantasy; AllFantasy suggests teams manager health calls inactive but never turns it on itself. Hourly, it sets the projected-best lineup from players whose games have not started, and stops the moment the owner saves a lineup. Every switch is in the league log. #2714; Commish OS files a task for suggested teams nobody has handed over (#2736). |
| ⬜ | Waiver hold after drops, per player type | Free | a single hold period exists |
| ✅ | Weekly side contests (high score, closest loss) feeding the payout calculator | Free | #2724. The commissioner turns on weekly high score and closest loss on the Standings screen, each with an optional prize per week; every member sees each week's winners and the season's prize money per team. Worked out from the stored final scores on every read, so an adjustment or applied stat correction moves the winner. Regular-season weeks only; a tie splits the prize; a tied game has no loser. `prizeTotals` is what the payout calculator will sum. Saved through the settings patch under the co-commissioner money scope. Chimmy reads the winners and prize money (#2738). |
| ✅ | Playoff reseeding and multi-week rounds | Plan | Already in the playoff engine and settings: reseed after each round (`reseedAfterEachRound`, always on with a commissioner bye plan) and `playoffWeeksPerRound`. Custom bye plans are AF Commissioner (`advanced_playoff_setup`); the tier of reseeding itself is as the settings panel has it. |
| ✅ | Play-in week | Plan | League settings → Playoffs → bracket format → **Play-in week**: the last playoff spot (#N v #N+1) or the last two (#N-1 v #N+2, #N v #N+1) decided in a game the week before the N-team playoffs. Built as a bye plan, so the bracket engine plays it unchanged: round 1 is named "Play-in" and the rounds after keep the normal N-team names; it adds one playoff week, checked against the season like any plan. AF Commissioner, through the existing `advanced_playoff_setup` gate on custom byes. The standings screen reads "6 + play-in · #6 v #7". `lib/playoff-brackets/playIn.ts` |
| ✅ | Consolation / toilet bowl with a last-place flag | no gate | #2713 (another session): the lower bracket is played to its final — consolation (winners advance) or toilet bowl (losers advance) — and the toilet bowl final's loser finishes last in the final standings; a third-place game too. The code checks no entitlement, so the tier is still to be decided. |
| ⬜ | Lineup minimums for eliminated teams | Plan | |
| ✅ | Next season's draft order rule (reverse standings / max PF / lottery / toilet bowl) | no gate | Worst-to-first, reverse max PF and the weighted lottery were already in the rookie-order engine; the consolation / toilet bowl "plays for: Draft pick" rule landed in #2716, #2730 and #2735 (another session): new leagues and commissioner saves only, toilet bowl pick 1 to the loser (default) or the winner, and **dynasty and keeper only** by owner ruling — a redraft league starts each season fresh. No entitlement check in code, so the tier is still to be decided. |
| ⬜ | Rule-change simulator (re-score last season before a vote) | Plan | |
| ⬜ | Season rollover wizard | Plan | |
| ✅ | Payout calculator | Free to track | Standings → **Payouts**: the commissioner sets a buy-in (or uses the league entry fee) and a percent per finishing place. Pot = buy-in × teams; the weekly side-contest prizes for the whole regular season come out first; the places split the rest, to the cent. Every member sees each place's amount and each team's take (place + weekly prizes won): final once the bracket completes, "if the season ended today" before that. Commissioners also see buy-ins collected. Commish OS files a task when the weekly prizes promise more than the pot holds, and Chimmy can say what each place pays. AllFantasy tracks the money; it does not collect or pay it. Saved through the settings patch under the co-commissioner money scope. `lib/payouts/` |
| ⬜ | Ask Chimmy as commissioner | Plan | |

## Not redraft (parked for later formats)

Separate deadlines for player trades and pick trades: dropped for redraft. A redraft league trades only the current draft's picks (`lib/league-trade-engine/redraftDraftPicks.ts`), and that window closes when the draft completes — before any in-season trade deadline — so a separate pick deadline would never bite. Keep it for dynasty/keeper.

Keeper: missed-deadline rule #2558, keeper value report #2562, imported keeper cost grid #2544.
Survivor: idol expiry #2535, idol play cutoff #2553. Guillotine: FAAB after a chop #2545.
Dynasty: live rookie order on imported platforms #2543 ✅.
