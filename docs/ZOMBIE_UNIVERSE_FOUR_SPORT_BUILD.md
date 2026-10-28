# Zombie League / Zombie Universe: four-sport build plan

Status: build contract updated October 27, 2026. The foundation and selected weekly mechanics are implemented on draft PR #2823; the remaining release work is listed below.

## Product promise

A manager drafts and plays an ordinary fantasy roster while their team has a second identity: Human (called Survivor in existing code), Zombie, or Whisperer. Weekly results change identities, award items and winnings, and create a story the league can follow. The app performs deterministic rule changes, records why each change happened, and posts the weekly story so the commissioner mainly handles exceptions.

The next release supports **NFL, NBA, NHL, and MLB**. Existing college and soccer Zombie data must remain readable; new Zombie creation should offer only these four sports until each other sport is certified. Each league has its own fantasy season, draft, schedule, settings, chat, and Whisperer selection. A universe groups multiple leagues into levels under one commissioner without merging their rosters or scoring calendars.

## Current code and known gaps

| Area | Current code | Work required |
| --- | --- | --- |
| Season calendars | `zombieSeasonSchedule.ts` defines NFL 17, NBA 21, NHL 23, MLB 23 scoring weeks. | The pre-scoring power gate now reads trusted stored NFL regular-season and NBA/NHL/MLB dated provider games and closes when that source is absent. Read-only production data contains games in all 17/21/23/23 expected weeks; no full create-to-settlement provider rehearsal has passed. |
| Draft and universe | League and universe setup, levels, and per-league drafts exist. | Certify create → draft → first week for all four sports and every level. |
| Infection and serum | Native high-score and Bashing/Mauling serum awards use stable award keys. Configured revival cost, exact spending, and optional automatic revival are wired. | New resolutions save a pre-week snapshot. A serializable correction transaction can replay changed infections, protection use, score-based serum/weapon awards, and winnings when no combat decisions, automatic revival, later settled week, or later valid action exists. Other corrections still enter the commissioner exception queue. Full combat/revival replay and status history remain release work. |
| Trade restriction | Server trade gate blocks Zombies. This branch blocks Whisperers from trading at all times, independent of the commissioner-controlled Zombie trade setting. | Lock and explain the rule in commissioner settings before the draft; review every trade execution path and pending offers. |
| Weapons and Whisperer powers | Knife, Bow, Axe, and Gun can now arm one infection shield; a Whisperer can swap two unscored matchups via `@Chimmy ambush swap <team name>`. Bombs and other powers remain disabled. | The GameSchedule first-game lock is wired and fails closed if times are absent. Finish scoring-period mapping, bomb/power designs, and live four-sport verification. |
| Weekly report | Report posts share a durable announcement/chat key, show named serum/weapon awards and threat matchups, and display commissioner-recorded external prize amounts. | Settled matchup facts now produce accessible mobile Horde victory cards. Add full settlement snapshots, provider confirmation, and universe rollup. |
| Commissioner UI | Several Zombie modal panels still contain static controls. This branch wires Whisperer selection and replaces the placeholder structure controls with live league details. | Apply loaded settings, validated save actions, error feedback, and per-league/universe scope to the remaining panels. |
| Two Whisperers | Team status can represent several Whisperers, but the selection, record, and UI paths assume one. | An independent second seat, draft selection, ambush balance, report, secrecy, and commissioner count control are on this branch. Integration and access testing are still required before release. |

Older audit documents describe several of these areas as complete. Acceptance must be based on current running code and end-to-end tests.

## Two experiences

| | Simple Zombie | Enhanced Zombie |
| --- | --- | --- |
| Setup | One league, guided defaults | One league or a multi-level universe |
| Identity | One Whisperer, Humans, Zombies | One Whisperer in NFL; one or two in NBA/NHL/MLB |
| Infection | Automatic after a final eligible matchup | Same, with configurable loss and protection rules |
| Serums | One simple revive rule; automatic use is optional | Award thresholds, protection, revival, inventory, and commissioner automation choice |
| Weapons and ambushes | Hidden | Enabled only when each effect is fully implemented and tested |
| Chat | Short weekly recap and essential alerts | Full story report, danger preview, item awards, event cards, universe report |
| Settings | A short guided set | Advanced per-league controls and universe defaults with visible overrides |
| Money | Optional third-party prize tracker | Per-manager weekly prize ledger and universe rollup |

Simple and Enhanced are season-scoped presets on one game engine. Creation and pre-draft setup save the mode; draft activation saves a rules snapshot. Changes that alter competitive outcomes take effect next season unless the commissioner records an explicit, visible override. A league can choose Enhanced next season without losing its history.

## Season and draft rules

- Create independent draft rooms and schedules for each league. A universe may offer a shared draft date template, but each league retains its own start time and readiness state.
- Use scoring-period IDs supplied by the season calendar. NFL may use 17 Zombie weeks; NBA 21, NHL 23, and MLB 23 are current defaults, not permanent dates.
- A weekly resolution waits until every counted game is final plus the configured stat-correction buffer. A skipped or partial sports week cannot infect someone.
- Resolve regular season and final week from the same calendar source used for fantasy scoring. Display the next lock deadline in the manager's time zone.
- Choose Whisperer(s) after the draft and before Week 1. Record selection method, seed or commissioner choice, actor, and timestamp. A league cannot start with an unfilled Whisperer seat.
- For two-Whisperer NBA/NHL/MLB leagues, each Whisperer has an independent ambush balance. A Whisperer cannot target or infect the other through a self-serving matchup swap unless rules explicitly permit it.

## Weekly state machine and automation

One authoritative job processes each `leagueId + season + scoringPeriodId`:

1. Lock the week's eligible lineups and any accepted pre-lock Chimmy actions.
2. Read final fantasy matchup scores and a rules snapshot.
3. Apply serum protection, weapons, and matchup effects in a deterministic order.
4. Resolve wins, losses, ties, and infections. Write identity history and lock Zombie trades immediately. Whisperer trades remain locked from role assignment onward.
5. Award serums and weapons to the correct roster owner. Transfers and winnings follow the winning manager and are represented in separate ledgers. A replacement manager inherits a team inventory only according to the published replacement-owner rule.
6. Calculate weekly prizes or points, then materialize a report snapshot and event cards.
7. Post one league chat report. Post one universe summary after all due leagues finish. Deliver notifications once.
8. Advance the league week only after settlement completes.

Every step uses a stable event key, an audit record, and an idempotent retry path. Replaying a corrected week reverses the old derived events and recalculates the same ledger rows; it cannot award items or money twice. An unresolved external sports result should create a commissioner attention item instead of a guessed outcome.

## Chimmy actions

Chimmy parses a manager's `@Chimmy` message, but the rules engine decides and executes it. A reply must show the target, cost, deadline, and effect before a consequential action is confirmed. Chat, direct messages, and in-app buttons use the same server command path.

- **Human:** `@Chimmy use serum` registers infection protection. `@Chimmy use knife/bow/axe/gun` arms one defensive shield. Both must be declared before scoring starts; they are spent only if they stop infection.
- **Zombie:** `@Chimmy revive` uses enough serums to restore Human status if the commissioner allows it. With automatic revival enabled, settlement applies it when the configured count is reached and announces the result.
- **Whisperer:** `@Chimmy ambush swap <exact Survivor team name>` makes a one-for-one matchup remap before scoring starts. The atomic commit updates both affected pairings and spends one ambush. The earliest scheduled game locks the action; provider-backed lock coverage still needs four-sport verification.
- Unknown or disabled commands receive truthful help. The UI and rules page must never advertise a command as live when its effect is disabled.

## Weekly report and visuals

The report is built from settlement events, never inferred from current balances. It must name:

- each Human facing a Whisperer or Zombie in the next scoring period;
- this week's Whisperer and Zombie matchup winners, new infections, revivals, and remaining Human count;
- each serum and weapon winner, the award reason, and each item used or transferred;
- each paid league's manager, **recorded weekly prize amount**, currency, and external provider status; or Outbreak Points in a free league;
- the next action and lineup deadlines.

A Whisperer or Zombie win produces a branded result card with winner, opponent, score, status effect, and a spoiler-safe preview. Animation is optional and respects reduced motion. The accessible text card is the source of truth even if video fails. Rules use the existing status/item icon vocabulary consistently across the rules page, chat cards, standings, and notifications.

For third-party payments, store `projected`, `commissioner_confirmed`, and `provider_confirmed` as separate states. Show the amount won without claiming an external payout occurred. LeagueSafe's published flow has the commissioner assign winnings when payouts are available; the app should prepare an export/reconciliation view rather than promise automatic external transfers without a supported provider integration. See [LeagueSafe payout instructions](https://help.leaguesafe.com/hc/en-us/articles/115005841583-How-do-I-assign-winnings-or-allocate-funds-to-a-winner-in-my-league).

## Commissioner controls

The hub detects one league versus a universe. One-league commissioners land on that league's operations view. Universe commissioners see a level map and a table of each league's sport, week, draft state, unresolved settlement, Whisperer count, pending actions, payment reconciliation, and next deadline. A universe setting is a default template; each league displays its effective value and any override.

The main settings groups are: season and draft; team and scoring rules; infection and serum; weapons and ambushes; Whisperer count/selection; trade and waiver policy; weekly announcements; external prize ledger; visual and notification preferences. Standard league controls remain available beside Zombie controls. Save actions require commissioner authorization, server validation, an audit event, and immediate UI feedback. Outcome-changing controls become read-only after the first lineup lock except through a logged correction flow.

Default: one ambush per scoring period, one Whisperer, manual serum use, Zombie trade block on, permanent Whisperer trade prohibition, and automatic reports on. NBA/NHL/MLB may choose two Whisperers before the draft. The commissioner can set the ambush cap, automatic serum use, infection triggers, report timing, and payout formula. A single table should show which settings are editable now and which wait until next season.

## iPhone-first interface

The manager home should answer four questions without hunting through tabs: What am I? Who do I face? What can I use? What happens next? Put the week and identity card first, then opponent threat, inventory/action button, and a compact event timeline. Keep the full rules one tap away with icons plus text. The commissioner hub uses a level picker and league cards on phone, a grid on wide screens, and a persistent actionable alert count.

Use at least 44 × 44 point touch controls and avoid horizontal page overflow, following [Apple's touch guidance](https://developer.apple.com/design/tips/). Motion conveys results but remains optional, following [Apple's motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion). Test with dynamic type, VoiceOver, reduced motion, safe areas, and a small iPhone viewport. A graphic may celebrate a win, but it may not be the only way to learn the result.

## Provider week verification (read-only, October 27, 2026)

Production `SportsGame` rows were grouped by trusted source and scoring period without changing data. API-Sports has dated, regular-season NFL games in all 17 configured weeks. TheSportsDB has dated games in all 21 NBA weeks and all 23 NHL and MLB weeks: 982 NBA, 1,088 NHL, and 2,070 MLB games inside those configured periods. These counts verify provider calendar coverage, including lower-volume break weeks. Production `game_schedules` currently has 2026 NFL rows but no NBA/NHL/MLB rows, which is why Chimmy's power lock now reads the trusted stored source directly.

This check establishes schedule coverage only. It does not certify a full provider-scored draft-to-settlement week or provider freshness after a rescheduled game.

## Delivery order and acceptance

1. **Foundation:** certify four-sport create/draft/season schedule, store the Simple/Enhanced snapshot, and enforce trades from the server. Acceptance: one league and a 3/6 league universe can all start their own drafts and weeks; a Whisperer trade is rejected before Week 1, and a Zombie trade is rejected on both create and accept after infection.
2. **Settlement:** make infection, serum, inventory, and winnings transitions atomic and correction-safe. Acceptance: replaying a week produces identical state and one set of ledger rows.
3. **Powers:** the first ambush remap and defensive weapon shield are wired through the Chimmy path. Acceptance still requires live four-sport scoring and lineup-lock verification; bombs and other powers remain disabled.
4. **Two Whisperers:** migrate record/card/selection assumptions and add NBA/NHL/MLB setup. Acceptance: two distinct Whisperers retain independent ambush counts and both appear in reports.
5. **Reports and money:** named award recipients, threat matchup preview, external prize amounts, and once-only chat posts are wired. Acceptance still requires settlement reconciliation, provider confirmation, and win cards.
6. **Commissioner and mobile:** live settings, universe operations view, Simple onboarding, iPhone accessibility and visual QA. Acceptance: a commissioner can run a normal week without manual status, inventory, or chat work.

## Improvements that preserve the game

- **Threat preview:** show a Human's infection risk and item options before lock, without predicting a guaranteed result.
- **Outbreak history:** keep a visual chain of who infected whom, giving the season a memorable story and making corrections explainable.
- **Commissioner exception inbox:** group only missing scores, invalid roster mapping, disputed stat corrections, and unverified prizes. Routine weeks require no action.
- **Fairness simulator:** before draft lock, preview expected infection pace and item frequency using the league's sport and settings. It should warn when a rule set is likely to eliminate Humans too early.
- **Season archive:** preserve roles, weekly result cards, universe promotion/relegation, and the final survivor story so managers want to return next season.

## Verification status (October 28, 2026)

The draft PR now includes a dedicated disposable-Postgres CI rehearsal for NFL, NBA, NHL, and MLB. It signs in a commissioner, creates all four leagues through the canonical API, fills each draft, activates each native season, checks one or two Whisperers, finalizes a synthetic week, verifies infection, winnings, once-only chat reports, and idempotency. The NFL leg records a third-party weekly prize through the commissioner API, then reverses a result to verify that the prize and ledger remain intact while commissioner reconciliation is requested. This new lane has not passed yet. Synthetic scores prove workflow integration; they do not calibrate real-sport combat thresholds or certify live provider scoring.

The isolated Railway `allfantasy-zombie-rehearsal` project is connected to the empty Neon `allfantasy-zombie-fixture` project. All 214 Prisma migrations completed with none pending. Its public staging address is https://zombie-web-staging.up.railway.app. The last verified staging deployment was PR commit `eddaa53`; the fixture database still had zero app users, leagues, Zombie leagues, and redraft seasons. A signed-in, provider-scored staging journey has not passed. The local shell currently fails with Windows error 267, so the isolated CI rehearsal is the executable route available for integration verification.

The iPhone Zombie shell now gives the notification bell and horde response buttons 44-pixel minimum touch targets, and the mobile test checks reduced-motion result cards. The latest PR head needs its CI result and a staging rebuild before these changes count as verified.

A read-only production score audit found eight final NHL native matchups from one league and no final MLB native matchups. It also found no representative NBA/MLB final weekly player score set. Keep sport combat thresholds unchanged until representative provider-scored weeks exist. Combat decisions, automatic revival, later-week dependencies, and recorded external prizes still require commissioner reconciliation after score corrections. Keep this PR in draft until provider-scored four-sport journeys and the remaining correction paths are certified.
