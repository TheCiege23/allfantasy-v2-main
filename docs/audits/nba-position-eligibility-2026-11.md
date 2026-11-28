# NBA position eligibility, injury status and live stats — audit and plan (2026-11-28)

**Why now.** r/YahooFantasy's November "Position Eligibility" thread has Yahoo basketball players
complaining about five things: eligibility that lags reality (set from last season, added only on Mondays
after review, never removed), a commissioner override that can only add and is hard to find, Yahoo Sports
and Yahoo Fantasy disagreeing on positions, an "O" removed while the player was still out (which broke IR
moves), and live stats that stopped updating mid-game. This audit asks how AF answers each one, for native AF
NBA leagues and for Yahoo NBA leagues imported into AF. Measured on `origin/main` `d6982e0c4a`.

## What AF does today

### 1. Where an NBA player's position comes from

| | native AF NBA league | Yahoo NBA league imported into AF |
|---|---|---|
| source | `SportsPlayer.position`: one string per player (`prisma/schema.prisma:332`), written by the Rolling Insights and Sleeper player syncs (`lib/rolling-insights.ts:686`, `lib/sleeper/SleeperPlayerSeedService.ts:127`) | Yahoo's `display_position` (for example "PG,SG") copied into the import's `playerMap` (`lib/league-import/yahoo/YahooLeagueFetchService.ts:886`). Yahoo's `eligible_positions` is never read. |
| how many positions | **exactly one.** The roster row stores that string, and `playerEligibleForSlot` (`lib/league/lineup-swap.ts:90`) compared it to the slot as one token | whatever Yahoo shows, as a display string. Lineups are set on Yahoo, so AF's slot check never decides anything here. |
| current-season usage | none. Nothing reads games or minutes by position. | Yahoo's own (the thing users are complaining about) |
| commissioner override | **none.** No model, route or UI (a repo-wide search for override or custom-eligibility code found nothing) | none in AF. Yahoo's add-only tool. |

So for native leagues, "Amen Thompson should also be SF" had no answer at all: one position per player,
and nobody could change it.

**What usage data we do hold.** `player_game_stats` stores every NBA box-score line from Rolling
Insights `/live`, written every ~3 minutes during games by the worker
(`lib/live/dailySportLiveTick.ts:76`) and swept again at 07:00 UTC. Each row's `statPayload.position` is the
position the box score listed (`lib/sports-data/rollingInsightsGameLogs.ts:392`). The committed fixture
shows that this is **one label per player per game, not minutes by position**: bench players are labelled
too, and there is no starter flag. NBA `minutes` ("MM:SS") is not stored. Recorded as
`contracts/rolling-insights/GAPS.md` **R-NBA-POS**, with the vendor questions it needs answered. Nothing
was probed.

### 2. Injury status

The injury designation comes from the injury feed (`lib/injuries/currentInjuryDesignations.ts:58`), not
`SportsPlayer.status`. **AF has Yahoo's complaint #4 in its own code:**

- an NBA fact goes stale **36 hours after its report date** (`lib/injuries/injuryRecency.ts:54`,
  `lib/injuries/injuryReadPort.ts:259`);
- a stale game-day "Out" is suppressed as last week's news (`lib/core-app/injuryStatus.ts:136`, `:157`);
- the repo's own NFL note says a feed **re-dates a row only when its word changes**
  (`lib/injuries/injuryRecency.ts:58-64`). That is why the NFL horizon was raised to 7 days. NBA still uses 36h.

So an NBA player ruled "Out" on Monday for three weeks shows no designation in AF by Wednesday. The waiver
pool's `injury_status` (`lib/sport-teams/SportPlayerPoolResolver.ts:464`) and the lineup screen's IR check
(`components/league/native/screens/NativeLineupScreen.tsx:447`, `isIrEligibleStatus`) then refuse the IR
move, the same failure Yahoo users describe. No timestamp or source is shown next to a badge.

### 3. Live stats

- NBA live box scores: `/live/{Eastern date}/NBA` every ~3 min while a game is in its window, rotated
  across sports, hash-gated, written through the same parser as the daily sweep, then rescored
  (`lib/live/dailySportLiveTick.ts:18-56`). It runs on the worker and is controlled by the **worker's**
  `DAILY_SPORT_LIVE_SCORING`.
- Not verified here: whether the matchup screen shows "updated N min ago". Without that, a stalled feed
  looks the same as a slow game, which is Yahoo's complaint #5.

## Ranked plan (by value to commissioners)

| # | fix | complaint | size | status |
|---|---|---|---|---|
| **1** | **Commissioner position tool: add AND remove, with a log every member can read, and box-score evidence beside each player.** Applies to native lineups immediately, and is checked on the server against the log. | 1, 2 | M, plus a migration | **built in this PR** |
| 2 | **Keep a still-current NBA "Out".** Give daily sports the same "the feed re-dates only on change" treatment NFL got: hold a game-day Out while the latest ingestion still lists it, rather than dropping it at 36h. Fixes AF's own IR-move refusals. | 4 | S–M, careful: it overlaps the "re-fetch made 2020 reports fresh" bug in `injuryReadPort.ts:226-243` | next |
| 3 | **Source and age on every injury badge** ("Out · ESPN · 2 days ago") on the roster, waiver and lineup screens. | 3, 4 | S | next |
| 4 | **"Updated N min ago" on live NBA matchups**, plus a "stats delayed" state when the tick's last good write is older than its cadence while a game is live. | 5 | S | needs a check of the current matchup UI |
| 5 | **"Close to a new position" list**: players whose box-score labels have moved (e.g. 5 of the last 10 games at SF), so commissioners can act before managers ask. | 1 | S once #1 is in. **The signal quality depends on R-NBA-POS.** | blocked on vendor answer |
| 6 | **Automatic current-season eligibility** (e.g. 5 games or 10% of minutes at a position), with the evidence shown, and the commissioner tool as the override. | 1 | M | blocked on R-NBA-POS questions 1–2 |
| 7 | **Yahoo imports: read `eligible_positions`** and show AF's evidence next to Yahoo's positions, so an imported league sees the lag. AF cannot change a Yahoo lineup; once the league switches to AllFantasy, #1 applies. | 1, 3 | S | later |

## What #1 does (this PR)

- **Log, not state.** `LeaguePositionEligibilityChange` is append-only (add, remove, reset). The current
  eligibility is a fold of it (`lib/league-eligibility/nbaPositionEligibility.ts`), so the log members read
  is the same record the lineup check uses.
- **Remove works, and so does undo.** A player always keeps at least one position. No-op changes are
  refused, so the public log stays meaningful. Add and remove require a reason, which every member sees.
- **Evidence, honestly labelled.** "Games this season by box-score position: SG 8 · SF 7", from
  `player_game_stats`. DB-only, with no provider call.
- **Lineups.** The roster API returns an NBA player's effective positions as "PG,SF". A slot accepts a
  comma-joined position if any one of them fits (a slash never splits, so "D/ST" is unchanged). The lineup
  save re-applies the log on the server, so a stale screen cannot seat a player at a position the
  commissioner removed.
- **Where.** League settings › Roster, for native NBA leagues. Imported leagues don't get the tool,
  because their lineups are set on the host.
- **Access.** Read: any league member. Write: the head commissioner, or a co-commissioner granted
  `rosters` (`lib/league/commissionerAccess.ts`).

## Left open

- **The migration needs the owner's OK before merge.** Merging applies it to production (preDeploy runs
  `railway-prod-migrate`). It adds one table and changes nothing existing.
- R-NBA-POS vendor questions (blocks #5 and #6).
- Server trust of `row.position` for players **without** a commissioner change is unchanged (pre-existing).
- Fix #2's interaction with the report-date rule needs its own measurement before it changes.
