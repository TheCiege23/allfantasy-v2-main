# Redraft commissioner — what's built, what's open, what's next

The working checklist for the **redraft** commissioner experience. We finish redraft first, then move
to dynasty, keeper and the specialty formats. Product source: `docs/AF_COMMISSIONER_SETTINGS_SPEC.md`
(PR #2494). **Free** = every commissioner; **Plan** = the Commissioner subscription; **Free / Plan** = a
manual or partial version is free and the automation or full version is on the plan; **no gate** =
the code checks no entitlement and the tier is still to be decided.

**Status key:** ✅ merged to `main` · 🟡 open PR (not merged) · ⬜ planned, not started.

⚠ "Merged" means the code is on `main`, **not** that it is live. `allfantasy-v2-main` deploys in batches
(`.github/workflows/railway-deploy.yml`, ~18–35 min after a merge), and cron-driven parts run on the
worker, which follows `worker-release` and moves about once a day. Check
`/api/af-debug/sha` before saying a feature is in production.

_Last updated: 2026-10-20._

## Running the week

| | Feature | Tier | PR |
|---|---|---|---|
| 🟡 | **Weekly commissioner checklist** — "This week · week N": scores final, waivers running, lineups set, trades waiting on you, dues, deadline heads-ups; each done or to do, linked to its fix | Free | #2575 |
| ✅ | Commish inbox — keepers, AI alerts, integrity flags, join and adoption requests, dues, payouts in the action queue | Free | #2500 |
| ✅ | Dispute desk — members file, commissioners rule | Free | #2501 |
| 🟡 | Lineup-integrity monitor — finished-week lineups that could not score (latest week free, full season on the plan) | Free / Plan | #2507 |
| 🟡 | Tanking scan fix — reads the week's saved lineup | Free | #2508 |
| 🟡 | Deadline autopilot — 72h / 24h / 1h reminders to managers who still have to act (ships off; turning on `DEADLINE_AUTOPILOT_ENABLED` on the worker is the owner's call) | Free / Plan | #2503 |
| 🟡 | Weekly recap review — edit Tuesday's recap before it posts | Free | #2506 |
| 🟡 | Scheduled announcements — write it now, posted at the time you pick | Free | #2565 |

## Rulings and control

| | Feature | Tier | PR |
|---|---|---|---|
| 🟡 | Score adjustments — add or take away points per matchup, with a reason in the audit log | Free | #2540 |
| 🟡 | Co-commissioner permissions — up to 2, each limited to scoring / rosters / trades / money / chat / league setup | Free | #2564 |
| 🟡 | Settings lock — lock areas for the season; mid-season changes need a league vote | Free | #2568 |
| ✅ | Trade deadline enforced server-side (other session) | Free | #2554 |
| 🟡 | Trade deadline day + time — trades close at the moment the commissioner picks (league timezone) or after the deadline week, whichever comes first | Free | #2582 |

## Rules, playoffs and the league's identity

| | Feature | Tier | PR |
|---|---|---|---|
| 🟡 | Commissioner-granted byes + bracket format picker (odd playoff counts stay free) | Free / Plan | #2498 |
| ✅ | Playoff seeding by record with a head-to-head tiebreak (other session) | Free | #2557 |
| 🟡 | Custom tiebreaker order — head-to-head, points for, fewest points against, all-play, coin flip, in the commissioner's order; standings and playoff seeds both follow it | Plan | #2590 |
| 🟡 | Constitution builder — generated from settings, versioned, amended by league vote | Free / Plan | #2505 |
| 🟡 | Rule templates library — save, share, start leagues from them | no gate | #2525 |
| 🟡 | Draft-day kit — order reveal / lottery show, printable board, absent-manager clock | Free | #2518 |
| 🟡 | Scenario explainer — #1 pick and elimination odds | Free | #2510 |
| 🟡 | Commish reputation — opt-in "Well-run league" badge | no gate | #2521 |

## Next for redraft (the plan, in order)

| | Feature | Tier | Notes |
|---|---|---|---|
| ⬜ | Separate deadlines for player trades and pick trades | Free | builds on #2554 and #2582 |
| ⬜ | League log for members, with a "commish only" toggle | Free | today members only reach a raw JSON viewer on the old league page |
| ⬜ | One-tap stat-correction review before standings move | Free | |
| ⬜ | Undo for commissioner actions until the next dependent event | Free | spec rule §0.3 |
| ⬜ | Trade review window that explains itself to managers | Free | |
| ⬜ | Inactive manager mode — AF sets the best lineup weekly | Free | auto-subs cover part of it |
| ⬜ | Waiver hold after drops, per player type | Free | a single hold period exists |
| ⬜ | Weekly side contests (high score, closest loss) feeding the payout calculator | Free | |
| ⬜ | Playoff reseeding, 2-week rounds, play-in week | Plan | rest of spec §1.3 |
| ⬜ | Consolation / toilet bowl with a last-place flag | Plan | |
| ⬜ | Lineup minimums for eliminated teams | Plan | |
| ⬜ | Next season's draft order rule (reverse standings / max PF / lottery / toilet bowl) | Plan | engine exists for dynasty rookie order |
| ⬜ | Rule-change simulator (re-score last season before a vote) | Plan | |
| ⬜ | Season rollover wizard | Plan | |
| ⬜ | Payout calculator | Free to track | |
| ⬜ | Ask Chimmy as commissioner | Plan | |

## Not redraft (parked for later formats)

Keeper: missed-deadline rule #2558, keeper value report #2562, imported keeper cost grid #2544.
Survivor: idol expiry #2535, idol play cutoff #2553. Guillotine: FAAB after a chop #2545.
Dynasty: live rookie order on imported platforms #2543 ✅.
