# Daily lineups for MLB, NBA and NHL — design

Status (2026-10-19): **phases A, B and C built; the migration is written but NOT applied.**
The owner ruled on the three scoring questions: matchups are the **daily sum**, each player locks
**at his own game start**, and a player who has played stays locked **until the next day**. Phase B
(per-day lineups on both save paths) and phase C (per-day stats and per-day matchup scoring) are in
`lib/redraft/dailyLineups.ts`, behind the same per-league opt-in, with the migration in
`prisma/migrations/20261020120000_daily_lineups`. Nothing turns the opt-in on yet. Games-played caps,
the NHL goalie minimum and MLB innings limits (phase D) are built behind their own settings (§5c); the
day-picker UI (phase E) is **not built**.

> 🛑 **Apply the migration before any league gets `dailyLineupsEnabled: true`.** The per-day tables are
> read and written only for an opted-in league, so the code is inert until then, but an opted-in
> league on a database without the tables fails every lineup save and every score.

Line references are to `origin/main` at the time of writing unless marked "this branch".

---

## 1. TL;DR

- In dynasty and redraft leagues for MLB, NBA and NHL, managers normally set a lineup every day. Each
  player locks when his own game starts that day, and his points count only for the days he sat in a
  starting slot. Those daily totals add up to the weekly head-to-head score.
- AllFantasy has **no notion of a day**, in the lineup or in the score. A team has one lineup per
  fantasy week, and each player has one weekly stat total. The matchup score is each starter's
  **whole-week** total, for whoever holds the starter slot when the week is scored.
- Because of that, a lock that releases a player the next day is **unsafe** as long as scoring stays
  weekly. A manager could bench a player the morning after a bad game, and that game would drop out of
  his week. The only safe lock under weekly scoring is the one already in place: lock each player at his
  team's first game of the week.
- Real daily lineups therefore need (a) a lineup stored per day, (b) player points stored per day, and
  (c) a matchup total equal to the sum over days of each day's starters. (a) and (b) need new tables
  (§6, proposed migration).
- This branch ships the part that needs no migration: a real `daily` lock decision. It only applies when
  a league opts in, and it uses the kickoff data the lock already reads. It also stops the silent
  fallback: a `daily` setting that is not in effect now produces a warning. Existing leagues are unchanged.

---

## 2. Current model

### 2.1 How lineups are stored: one lineup per team per week

| Store | Shape | Where |
|---|---|---|
| `RedraftRosterPlayer.slotType` | The **current** slot for each roster player. There is no week or day on it. | `prisma/schema.prisma` `model RedraftRosterPlayer` (~14581) |
| `af_roster_lineup_assignments` (`AfRosterLineupAssignment`) | The lineup saved for a **week**: `@@unique([rosterId, season, week, playerId])`, with `section` = starters/bench/ir/taxi/devy. No day. | `prisma/schema.prisma:8281-8299` (unique at 8295) |
| `af_lineup_lock_state` (`AfLineupLockState`) | A cached lock snapshot per roster per **week**. | `prisma/schema.prisma:8324-8342` |
| `RedraftMatchup.lineupSnapshots` (Json) | A copy of the scoring result written by the scorer. It is not a lineup input. | `prisma/schema.prisma:14650` |

There are two ways to save a lineup:

1. **Redraft route.** `PATCH /api/redraft/roster` writes `slotType` directly
   (`app/api/redraft/roster/route.ts:697-702`). Before applying the moves, it adds `isLocked` to each
   player through `hydrateRedraftLineupLocks` (`:658`).
2. **AF roster engine.** `persistRosterLineupWithEngine` writes `Roster.playerData`, the weekly
   `af_roster_lineup_assignments` rows, and keeps `slotType` in step
   (`lib/roster-lineup-engine/lineupService.ts:71-205`). It checks locks through
   `resolveFullLineupLockContext` (`:140-164`). It never calls `hydrateRedraftLineupLocks`.

Scoring reads the lineup for the week from `af_roster_lineup_assignments` when rows exist, and from
`slotType` when they don't (`lib/redraft/weekLineupSlots.ts`, `loadWeekLineups` / `weekSlotType`).

### 2.2 How points reach a lineup slot: weekly aggregates

- **Per-game stats** arrive in `player_game_stats` (`PlayerGameStat`). Each row has a correct
  Eastern-day `gameDate`, and `weekOrRound` is always 0 for daily sports
  (`lib/scoring-runtime/dailySportStatNormalization.ts:344-360`).
- **Weekly roll-up.** `syncPlayerWeeklyScoresForRedraftSeason` selects a player's games inside the
  week's date window (`lib/redraft/playerWeeklyScoreService.ts:420-427`). It then sums them with
  `aggregateWeeklyStats` (`:763`, defined in `dailySportStatNormalization.ts:300-320`) and upserts
  **one** `PlayerWeeklyScore` row (`:731`). That model is
  `@@unique([playerId, week, season, sport])` (`prisma/schema.prisma:15405`). It is per player and
  per week, and it is shared across leagues.
- **Matchup score.** `scoreRosterStarters` loads the lineup for the week (`lib/redraft/scoringEngine.ts:353`)
  and keeps the starters (`:358`). It reads each starter's single `PlayerWeeklyScore` row (`:369`) and
  scores the whole week's stats. `updateMatchupScores` writes `homeScore`/`awayScore` for the
  `RedraftMatchup.week` (`:515-620`). Category leagues compare the summed weekly stat totals
  (`resolveCategoryMatchup`, `:565`).

So **a player's weekly points go to whatever slot he holds when the week is scored.** No day is involved.

### 2.3 How locking is enforced: two systems that disagree

**A. Redraft lock** (`lib/redraft/lineupLock.ts`). This lock is derived from the schedule. It is used
by the redraft roster route, the live-scoring runtime, trades, waivers and survivor.

- Modes are `per_player_kickoff` (default), `first_game_of_week` and `manual`
  (`resolveLineupLockMode`, main `:62-68`). **Any other value, `daily` included, falls back silently
  to `per_player_kickoff`** (main `:68`).
- For daily sports, `buildWeekKickoffMap` reads the games of the **week** and keeps each team's
  **earliest kickoff of the week** (main `:307-308` for the RI-schedule sports MLB/NCAAB; `:346-347`
  for `SportsGame` NBA/NHL). So under `per_player_kickoff`, a player locks at his team's **first game of
  the week** and stays locked for the rest of it. The header comment says this is intentional
  (main `:172-180`): it is the only lock that is safe while scoring is weekly.

**B. AF engine lock** (`lib/roster-lineup-engine/lineupLockService.ts` and `lib/league/lineup-lock.ts`).
This lock is used by `persistRosterLineupWithEngine` and `GET /api/league/roster`.

- For NBA, NCAAB, MLB and NHL, `dailySportLock` locks the **whole lineup from 6:00 PM ET until
  midnight**, every day (`lib/league/lineup-lock.ts:74-84`, applied at `:123-125`). It does not read the
  schedule.
- It locks per player only when `Roster.playerData[...].gameTime` is in the past
  (`computePerPlayerKickoffLocks`, `lineupLockService.ts:44-68`, applied at `:257`). I did not trace
  which writer fills `gameTime` for these sports, so I have not verified how reliable it is.

### 2.4 How fantasy weeks are defined for daily sports

- A week for a daily sport is **seven days counted from the regular-season opener**:
  `weekWindowFromSeasonStart` (`dailySportStatNormalization.ts:361-373`),
  `resolveDailySportWeekWindow` (`lib/season-week/dailySportSeasonStarts.ts:131-146`) and the schedule
  re-label (`lib/season-week/sportWeekSignal.ts:220`). The opener dates are hard-coded
  (`dailySportSeasonStarts.ts:43-73`).
- `sportWeekSignal.ts:43` (`WEEK_SIGNAL_SPORTS = NFL, NCAAF, SOCCER`) excludes the daily sports from
  the feed-week resolver on purpose. Their week comes from the calendar instead.

---

## 3. What breaks for daily sports today

| # | Problem | Evidence |
|---|---|---|
| B1 | **`daily` falls back silently.** The sport configs declare `lineupLockType: 'daily'` (`lib/sportConfig/configs/nba.ts:60`, `nhl.ts:56`, `mlb.ts:96`), but the redraft lock maps `daily` to `per_player_kickoff` without saying so. | `lib/redraft/lineupLock.ts` main `:62-68` |
| B2 | **No daily management.** Under the default mode, a player locks at his team's first game of the **week** and stays locked until the week ends. A manager can't sit a player on his off night or start a bench player who plays tonight after either of them has played once that week. | main `:307-308`, `:346-347` (week-earliest `byTeam`) |
| B3 | **Category NBA/MLB leagues are forced onto `first_game_of_week`.** The whole lineup freezes at the first game of the week. | `lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts:210-212`, `:325`; `carryOverImportedLeague.ts:290` |
| B4 | **Neither lineups nor scores have a day.** Lineups are weekly (`AfRosterLineupAssignment` unique on rosterId+season+week+playerId) and scores are weekly (`PlayerWeeklyScore` unique on player+week+season+sport). Per-day attribution can't be computed or stored. | `schema.prisma:8295`, `:15405`; `scoringEngine.ts:353-369`; `playerWeeklyScoreService.ts:731,763` |
| B5 | **A lock that resets daily is a scoring exploit under weekly scoring.** Any lock that releases a player after his game lets a manager change which slot holds his whole week. A bad game disappears if he is benched, and a good game counts if a bench player is started afterwards. This is why B2 is deliberate. | follows from B4; main `:172-180` |
| B6 | **The AF engine path already resets daily.** Its whole-lineup lock opens again at midnight ET, and its per-player lock depends on `playerData.gameTime`, not on the schedule. On native leagues that save through the engine (these saves decide scoring via `weekLineupSlots.ts`), B5 may therefore be reachable today, unless `gameTime` keeps a player who has already played locked. **Not verified end to end. Worth a follow-up.** | `lib/league/lineup-lock.ts:74-84`; `lineupLockService.ts:44-68,257`; `lineupService.ts:140-164` |
| B7 | **The engine's 6 PM ET lock is wrong at both ends.** Afternoon games (MLB day games, weekend NBA/NHL matinees) can still be changed after they start. Players in late West Coast games are frozen from 6 PM even though they haven't played. | `lib/league/lineup-lock.ts:74-84` |
| B8 | **No games-played caps (NBA/NHL) and no MLB innings minimums or maximums.** Nothing in `lib` or `app` reads such a setting. | `grep -rniE "gamesPlayedCap\|minInnings\|maxInnings\|maxGoalieStarts" lib app` finds nothing |
| B9 | **Weeks are 7 days from the opener, not Monday to Sunday.** NBA 2026 opens on a Tuesday (`dailySportSeasonStarts.ts`), so every NBA week runs Tuesday to Monday. MLB 2026 opens on a Wednesday. Major platforms run Monday to Sunday and stretch week 1 instead. This is a product choice, but it affects GP caps and the UI. | `dailySportStatNormalization.ts:371`; `sportWeekSignal.ts:220` |

---

## 4. Target model

1. **Lineup per day.** For each roster and each US Eastern scoring day `D`, store the slot of every
   rostered player. A day with no save carries over the most recent earlier day's lineup, so a manager
   who sets it once keeps it.
2. **Lock per player per day.** Player `P` is locked for day `D` from his first game start on `D`
   (doubleheaders count from game 1) until the end of `D` (midnight ET). He can't be moved in or out of
   a starting slot for `D` during that time. Days after `D` stay editable. An emergency commissioner
   unlock still wins.
   - The day boundary is midnight ET, the same rule `player_game_stats.game_date` is written under
     (`lib/sports-data/easternGameDay.ts`). A 10:30 PM ET tip belongs to the day it started. Once
     scoring is per day, moving that player after midnight affects only the next day, so the lock does
     not need to run until the game ends.
3. **Points per day.** For each player and day: the summed stats of his games on that day, plus
   `gamesPlayed` (and `inningsPitched` / `gamesStarted` for MLB pitchers, and goalie starts for NHL).
4. **Weekly matchup total** = Σ over the days of the week of Σ over that day's starters of that
   player's points for that day. Category leagues sum the starters' stats per day across the week, then
   compare categories exactly as `resolveCategoryMatchup` does now.
5. **Games-played caps (NBA/NHL)** apply per lineup position (or per team). They count a starter's
   games in chronological order across the week (or season), and games beyond the cap don't count.
   *Owner decision:* whether the game that crosses the cap counts (Yahoo-style "the day you hit it
   counts in full" versus strict cut-off).
6. **MLB innings minimum and maximum.** These are weekly (H2H) or seasonal (roto). The maximum works
   like a GP cap on innings: pitching stats past it don't count. The minimum is a penalty, for example
   forfeiting ERA and WHIP for the week. *Owner decision:* the penalty, and the defaults.

---

## 5. What this branch implements (no migration)

`lib/redraft/lineupLock.ts` (this branch):

- **A real `daily` mode.** `computeLineupLock` gains a `daily` case that locks only on
  `playerKickoffTodayUtc`, which is his earliest start on the current Eastern day.
  `buildWeekKickoffMap` now also returns `byTeamDay` (team → Eastern day → earliest start), built from
  the same game reads the lock already makes. For RI-schedule sports (MLB) the day is the schedule's
  own `day` field. For `SportsGame` sports (NBA/NHL) it is `easternCalendarDay(startTime)`.
  Postponed and replaced games are still skipped. A game with no start time still locks from the
  start of its day.
- **Three things are needed before `daily` takes effect**, through `readLineupLockSettings(settings, sport)`:
  1. `sportConfig.lineupLockType === 'daily'`,
  2. `sportConfig.dailyLineupsEnabled === true`, the explicit per-league opt-in (default off, and
     nothing in the product sets it), and
  3. sport ∈ `DAILY_LINEUP_LOCK_SPORTS` (`NBA`, `NHL`, `MLB`). NFL and NCAAF never get it.

  Callers that pass no sport (the commissioner route and survivor NBA scoring) see exactly what they
  saw before. `resolveLineupLockMode('daily')` still returns `per_player_kickoff`, because existing
  leagues may already store `'daily'` and have always been locked per player at the first game of the
  week.
- **The fallback is no longer silent.** When `daily` is requested but not in effect (no flag, or a
  weekly sport), the lock still behaves as `per_player_kickoff`, and `hydrateRedraftLineupLocks` /
  `...ForRosters` now return a warning that says so. When `daily` *is* in effect, they warn that scoring
  is still weekly (B5).
- **Tests** are in `__tests__/redraft/daily-lineup-lock.test.ts`. They cover NBA (a late tip that falls
  on the next UTC date, a reset across the day boundary, a second game on the next day), NHL
  (movable on an off day, locked on a game day), MLB (day game versus night game, a doubleheader, a
  postponed game, a game with no start time) and the controls: the existing modes, emergency unlock,
  NFL ignoring `daily`, and `daily` without the flag.

**Deliberately not done here:**

- `app/api/redraft/lineup-lock/route.ts` does **not** accept `daily` (`VALID_MODES`). Because of B5,
  turning the flag on before per-day scoring exists would open an exploit. The route is the place to
  allow it once §7 Phase C has landed.
- The AF engine lock (B6/B7) is unchanged, and so are the forced `first_game_of_week` on category
  leagues (B3) and the week windows (B9).

> 🛑 **Do not set `dailyLineupsEnabled: true` on a real league before per-day scoring (Phase C) ships.**
> With weekly scoring, a lock that resets each day lets a manager move a player after his game and
> change whether that game counts.

---

## 5b. What phases B and C implement (2026-10-19)

All of it is in `lib/redraft/dailyLineups.ts` and is gated by `isDailyLineupScoringEnabled`, which is
exactly the lock's three-part `daily` gate (§5). An unflagged league never reads or writes the
per-day tables.

- **Saving (B).** Both save paths — `PATCH /api/redraft/roster` and `persistRosterLineupWithEngine` —
  call `writeDailyLineupForSave` inside their own transaction, after their slot update. It writes the
  roster's current slots for every day the save decides: today (Eastern) through the end of the week,
  or the whole week for a save made ahead of it. Those days are replaced wholesale, so a dropped
  player cannot linger. A week with no date window **refuses the save** rather than fall back to
  weekly scoring under a daily lock (§3 B5).
- **Reading a day's slot.** That day's row, else the player's latest earlier row (carry-forward), else
  — when no daily save has named him — his slot in the weekly lineup (`weekSlotType`).
- **Stats (C).** The weekly sync, for a flagged league only, also writes one `player_daily_scores` row
  per player per game day, summed by the same normalizer as the weekly roll-up. Days with no game have
  no row (0 points). Rows for days that no longer have a game are deleted.
- **Scoring (C).** `scoreRosterStarters` sums, over the week's days, each day's starters' points for
  that day. A day before the player joined the roster never counts. Bench days feed `benchPoints`.
  Completeness still comes from the weekly row: no weekly row means the sync has not covered the
  player (missing), and the finalizer's seal stays on the weekly row. Category leagues sum the starters'
  per-day stat lines. Every caller — live updates, the finalizer, guillotine and roto — goes through it.
- **Not yet:** the commissioner lock route still refuses `daily` (phase E), so the opt-in can only be
  set by editing league settings; the AF engine lock stays on the weekly per-player lock from #2520,
  which is stricter than the daily lock and therefore safe.

## 5c. What phase D implements (2026-10-20)

Optional, per league, all off by default; stored in `League.settings.games_limits` (PATCH key `gamesLimits`)
rather than in `sportConfig`, which the commissioner panel rewrites wholesale. Refused (400) unless the
league is on daily lineups, because only the per-day rows say which slot a game was played in.

| Rule | Sports | Choice made |
|---|---|---|
| Games-played cap per slot, season | NBA, NHL, MLB | Entered per seat, × the league's seats for that slot. Checked at the START of each Eastern day: the day that reaches the cap counts in full (ESPN's practice); later days in that slot score 0 and add nothing to usage. |
| Goalie minimum, weekly | NHL | Goalie games from starting goalies (`gamesPlayed` on days with `g_*` stats). Below it, the week's goalie stats score 0. The feed has no "started" flag, so a relief appearance counts. |
| Innings minimum, weekly | MLB | Below it: points leagues lose all pitching that week; category leagues lose only the ERA/WHIP inputs (they go unqualified), W/SV/K still count. |
| Innings maximum, weekly | MLB | Same day rule as the caps: the day that reaches it counts in full; pitching on later days does not (batting still does). |

Minimums are judged on the stored data as it stands, so the live score is what the week would end at.
Season cap usage is recomputed from `redraft_daily_lineups` + `player_daily_scores` on every scoring run
(no new table). The step runs after each started day's points are computed and before they are summed; a
day no rule touches keeps its exact points, so a league without limits scores byte for byte as before.
The scorer adds a `gamesLimits` usage summary to the team's `redraftScoring` snapshot; the matchup view
shows it. Not built: the MLB pitcher starts cap.

## 6. Data-model changes: a migration IS required (proposed, NOT applied)

Per-day attribution needs a lineup per day and points per day. Neither fits the current unique keys:
`AfRosterLineupAssignment` is unique per week, and `PlayerWeeklyScore` is unique per week. Putting
per-day data into existing Json columns (`RedraftMatchup.lineupSnapshots`, `AfLineupLockState.metadata`,
`PlayerWeeklyScore.stats`) was considered and **rejected**:

- `lineupSnapshots` is read-modify-written by the scorer (`scoringEngine.ts:607-617`), so concurrent
  lineup saves would race with it.
- `stats` is read as `Record<string, number>` by every scorer, so a nested key would end up summed or
  ignored.
- None of these can be indexed for "lineup for day `D`".

Both new tables are **additive**. No existing column or unique key changes, so code that ships ahead of
the migration fails only on the new, flag-gated paths.

```sql
-- PROPOSED — NOT APPLIED. Needs the owner's decision (CLAUDE.md: a migration is not pushable work).
-- prisma/migrations/<ts>_daily_lineups/migration.sql

-- One row per (redraft roster, Eastern scoring day, player): the slot he held that day.
CREATE TABLE "redraft_daily_lineups" (
  "id"           TEXT         NOT NULL,
  "leagueId"     TEXT         NOT NULL,
  "rosterId"     TEXT         NOT NULL,   -- RedraftRoster.id (scoring is keyed on redraft rosters)
  "season"       INTEGER      NOT NULL,
  "week"         INTEGER      NOT NULL,   -- fantasy week the day belongs to (denormalized for reads)
  "scoringDay"   DATE         NOT NULL,   -- US Eastern calendar day
  "playerId"     VARCHAR(128) NOT NULL,
  "slotType"     VARCHAR(32)  NOT NULL,   -- same vocabulary as RedraftRosterPlayer.slotType
  "lockedAt"     TIMESTAMP(3),            -- first game start that day, once reached (audit)
  "source"       VARCHAR(32)  NOT NULL DEFAULT 'user',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "redraft_daily_lineups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "redraft_daily_lineups_rosterId_scoringDay_playerId_key"
  ON "redraft_daily_lineups" ("rosterId", "scoringDay", "playerId");
CREATE INDEX "redraft_daily_lineups_leagueId_season_week_idx"
  ON "redraft_daily_lineups" ("leagueId", "season", "week");
CREATE INDEX "redraft_daily_lineups_rosterId_season_week_idx"
  ON "redraft_daily_lineups" ("rosterId", "season", "week");
ALTER TABLE "redraft_daily_lineups"
  ADD CONSTRAINT "redraft_daily_lineups_rosterId_fkey"
  FOREIGN KEY ("rosterId") REFERENCES "redraft_rosters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per (player, sport, season, Eastern day): that day's summed stats, sport-wide (like PlayerWeeklyScore).
CREATE TABLE "player_daily_scores" (
  "id"            TEXT         NOT NULL,
  "playerId"      TEXT         NOT NULL,
  "sport"         TEXT         NOT NULL,
  "season"        INTEGER      NOT NULL,
  "week"          INTEGER      NOT NULL,
  "scoringDay"    DATE         NOT NULL,
  "stats"         JSONB        NOT NULL,
  "gamesPlayed"   INTEGER      NOT NULL DEFAULT 0,
  "gamesStarted"  INTEGER      NOT NULL DEFAULT 0,   -- MLB pitchers / NHL goalies
  "inningsOuts"   INTEGER,                           -- MLB: innings pitched as outs (IP * 3), exact
  "isFinalized"   BOOLEAN      NOT NULL DEFAULT false,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "player_daily_scores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "player_daily_scores_playerId_sport_season_scoringDay_key"
  ON "player_daily_scores" ("playerId", "sport", "season", "scoringDay");
CREATE INDEX "player_daily_scores_sport_season_week_idx"
  ON "player_daily_scores" ("sport", "season", "week");
```

Settings changes (League.settings JSON, **no migration**). They all live under `sportConfig`:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `lineupLockType` | `'daily'` | per sport | already exists |
| `dailyLineupsEnabled` | boolean | `false` | **this branch**: the per-league opt-in |
| `gamesPlayedCaps` | `{ scope: 'week'\|'season', perSlot?: Record<slot, number>, perTeam?: number, overflowDay: 'counts'\|'strict' }` | none | NBA/NHL GP caps (owner sets defaults) |
| `goalieStarts` | `{ minPerWeek?: number, maxPerWeek?: number }` | none | NHL |
| `pitchingInnings` | `{ scope: 'week'\|'season', min?: number, max?: number, minPenalty: 'forfeit_ratio_cats'\|'zero_pitching'\|'none' }` | none | MLB |
| `pitcherStartsCap` | `{ perWeek?: number }` | none | MLB |

---

## 7. Rollout plan (feature flag per league, default off)

The flag is `League.settings.sportConfig.dailyLineupsEnabled`. Default off, set per league.

| Phase | Work | Migration | Gate |
|---|---|---|---|
| **A** *(done, #2514)* | `daily` lock decision, `byTeamDay`, warnings for a requested-but-inactive `daily`. Inert, because nothing sets the flag. | no | flag + sport |
| **B** *(built)* | Apply §6. Write `redraft_daily_lineups` on every lineup save **on both save paths** (redraft PATCH and `persistRosterLineupWithEngine`) for flagged leagues: the Eastern day of `now`, plus every later day of the week the save covers. A nightly carry-forward for days without a save is optional, because reads already carry forward. | **yes** (owner) | flag |
| **C** *(built)* | Stat sync writes `player_daily_scores` (the same rows `playerWeeklyScoreService.ts:420-450` already reads, grouped by `gameDate` instead of summed per week). `scoreRosterStarters` for flagged leagues computes Σ days Σ that day's starters. Same for the live-scoring runtime and the week finalizer. Category leagues sum the per-day starter stats. Unflagged leagues keep the weekly path byte for byte. | uses B | flag |
| **D** *(built, except the pitcher starts cap)* | GP caps, goalie starts, MLB innings min/max and starts caps, applied in C's per-day accumulation in chronological order. Built as `lib/redraft/gamesLimits.ts` (rules) + `gamesLimitsScoring.ts` (season ledger), stored in `settings.games_limits`; see §5c. | no | per-setting |
| **E** | UI: a day picker on the lineup screen, a per-day lock banner (`lib/core-app/lineupLock.ts` already formats a lock time), and the commissioner route accepting `daily`. The AF engine lock switches to the schedule-derived per-player lock for flagged leagues (fixes B6/B7 for them). Then default **new** MLB/NBA/NHL leagues to daily. Existing leagues opt in. | no | flag |
| **F** | Optional: re-evaluate B3 (category leagues forced to `first_game_of_week`) and B9 (Monday-to-Sunday weeks). Both change sealed-week semantics and need their own decision. | no | — |

Turning the flag off for a league mid-week falls back to weekly scoring for that week. Don't allow a
change mid-week: the commissioner route should only flip it between weeks.

---

## 8. Effort estimate (one engineer)

| Phase | Estimate |
|---|---|
| A | done (this PR) |
| B | 2–3 days (two save paths, transactions, tests) |
| C | 5–7 days (sync, scorer, live runtime, finalizer, categories, backfill of an in-progress week, tests) |
| D | 3–5 days (rules are simple; chronological ordering and edge days need care) |
| E | 4–6 days (lineup UI per day, banners, commissioner settings, engine-lock unification) |
| **Total** | **~3–4 weeks** |

---

## 9. Owner decisions needed

1. **Apply the §6 migration?** Yes or no, and when. Nothing in Phase B or later can ship without it.
2. **GP cap defaults** (NBA/NHL): per slot or per team; weekly or seasonal; whether the overflow day
   counts. **Goalie start** minimum and maximum (NHL).
3. **MLB innings**: weekly or seasonal minimum and maximum, and the penalty for missing the minimum.
   Pitcher starts cap.
4. **Week shape (B9)**: keep 7 days from the opener, or move to Monday-to-Sunday with a long week 1.
5. **Category leagues (B3)**: allow `daily` for category NBA/MLB once Phase C lands, or keep
   `first_game_of_week`.
6. **B6 follow-up**: confirm whether the AF engine save path lets a player who has already played be
   benched on a later day of the same week. If it does, that is a live scoring exploit independent of
   this design.
