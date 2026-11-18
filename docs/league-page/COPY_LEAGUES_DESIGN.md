# Copy leagues: design

Owner's page review #17 (2026-11-17): *"'Copy' leagues: managers take a real team's name and logo, and the
commissioner can use that team's real schedule."* Phase C3 shipped the schedule tools; this is the piece it
left out. Status: **design approved 2026-11-18. The four decisions are at the bottom.** Nothing is built yet.

## What exists today (measured in code, 2026-11-18)

| Need | What the repo has | Gap |
|---|---|---|
| A fantasy team's real team | Nothing. `LeagueTeam` and `RedraftRoster` hold `teamName` and `avatarUrl` only. The wizard's `setupSource: 'copy_league'` copies *settings* from another AllFantasy league and is unrelated. | New |
| Real team names and logos | `teamLogoUrl(sport, team)` in `lib/core-app/teamLogo.ts` builds a crest from a pure team registry and returns `null` for unknown teams. `normalizeTeamAbbrev` folds "Buffalo Bills" and "BUF" together. `SportsTeam` also has `name`, `logo` and `division`. | None |
| Real games by week | `SportsGame` (`sport, season, seasonType, week, homeTeam, awayTeam, startTime`). Two writers: `api_sports` rows carry `week` and `seasonType`, but the sync notes that the current plan refuses season-wide queries (`lib/api-sports.ts` ~l.1150). `rolling_insights` rows (`syncNFLScheduleToDb`) have `startTime` and **no `week`**. Both are written by the `import-schedules` cron. | Week must be derived when missing |
| Turning games into weeks | `nflWeekForDate` (`lib/import-os/season.ts:177`) uses a fixed Sep 4 start and Friday-to-Thursday windows. That would put a Thursday-night game in the wrong week, so it is **not safe** for this. | Derive from the games themselves (below) |
| Writing a week's matchups so they survive rebuilds | **C3 custom weeks** (`lib/schedule-runtime/customWeeks.ts`, `setCustomWeek`). Every regeneration and randomization keeps them, and the "every team once" check applies. | None |

## Proposal

### 1. Sports: NFL first

A real NFL team plays at most one game a week, and a fantasy matchup is one game a week. That is the whole
reason the idea works. Per sport:

- **NFL:** full copy (name, logo, real schedule).
- **NCAAF:** possible later, scoped to one conference: around 134 teams, mostly non-conference early games.
- **NBA, NHL, MLB:** a team plays 3–4 games in a fantasy week, so "its real opponent this week" has no single
  answer. These sports would get **name and logo only**, with no real schedule.

### 2. Who is which team

Stored in `League.settings.copy_league`, an AllFantasy-owned key like `schedule_custom_weeks`, so **no
migration**:

```json
{ "sport": "NFL", "teams": { "<leagueTeamId>": "BUF" }, "realSchedule": true }
```

- **Picking:** each manager picks from Team settings, first come first served, and a team can be taken
  only once. The commissioner can assign or swap teams from Member Settings.
- **Locking:** picks lock when the draft starts.
- **Name and logo:** picking writes the real name and crest to `LeagueTeam.teamName` and `avatarUrl`, because
  dozens of screens read those columns and a display-only overlay would have to touch every one of them. The
  manager's own name is saved in `copy_league.previous[leagueTeamId]`, so un-picking restores it.

### 3. The real schedule

- **Source:** read only from `SportsGame` (DB-first; no provider call from a request path): NFL, the league's
  season, regular season.
- **Week:** taken from `week` where the row has it. Otherwise it is derived from the games themselves: the
  season's first regular-season game sets a **Thursday-anchored** week 1, and every game falls into its
  Thursday-to-Wednesday window. A season whose games do not cluster into 18 clean weeks is reported as "not
  usable yet" rather than guessed.
- **Coverage first:** before anything is written, the Hub says what it found, for example "Real schedule loaded
  for weeks 1–14" or "The 2027 NFL schedule isn't loaded yet."

### 4. Applying it: every week becomes a custom week

"Use the real schedule" (Commissioner Hub › Schedule) writes each unstarted regular-season week as a C3 custom
week, built like this:

1. **Real game between two picked teams:** that is the matchup. Home and away follow the real game.
2. **Teams whose real opponent nobody picked, or whose team is on bye:** they are paired with each other, same
   real division first, then same conference, then anyone. The pairing is deterministic, so applying twice gives
   the same weeks.
3. **One left over (odd count):** that team plays the league median, the existing odd-team rule.

Because they are custom weeks, a later rebuild or randomize keeps them, and a commissioner can still edit any
single week by hand. The week view tags each matchup **Real game** or **Paired**, so nobody mistakes a pairing
for the real schedule.

**League size changes how real it is.** At 32 teams every matchup is a real game. With 12, about a third
are. The Hub states the count ("5 of 6 matchups are real NFL games in week 3") rather than hiding it.

### 5. What does not change

Scoring, rosters, waivers and the playoff bracket are untouched. This is identity plus the regular-season
schedule.

## Built

- **PR 1, teams (2026-11-18):**
  - Code: `lib/league/copyLeague.ts` (rules), `lib/league/copyLeagueService.ts` (database), `/api/leagues/[id]/copy-league`, and `components/league-settings/CopyLeaguePanel.tsx`.
  - Where it shows: the manager's picker is in My Settings; the commissioner's on/off switch and assign/swap are on the AllFantasy options page; a "Copy league" row appears in League Setup and the Commissioner Hub.
  - **NFL only for now, including the name and logo.** The NBA, NHL and MLB team lists in `lib/sport-teams/SportTeamMetadataRegistry.ts` hold abbreviations only and are partly out of date (NHL still lists ARI, MLB still lists OAK). Those three sports get name and logo once a verified team table exists; `copyLeagueTeams` is the one place to add it.

## Build plan (two PRs)

1. **Teams.** Add the `copy_league` settings key, the team picker in Team settings, the commissioner assign/swap
   in Member Settings, name and logo writes with restore, and the lock at draft start. Tests: picking a team that
   is already taken is refused, un-picking restores the name, and the lock holds.
2. **Real schedule.** The `SportsGame` reader with the Thursday-anchored week derivation, the coverage
   check, apply-as-custom-weeks with the real/paired tags, and the Hub button. Tests: the week derivation
   checked against a committed fixture, the pairing being deterministic, a 32-team league getting only real
   games, and odd counts falling to the median.

## Risks

- **Schedule data freshness.** The NFL releases its schedule in May. Before that, the coverage check says so and
  nothing is applied.
- **API-Sports plan refusal.** If `api_sports` rows are missing, the Rolling Insights rows (no `week`) carry the
  feature through the derivation above. If both are missing, coverage reads "not loaded".
- **Team codes.** Real-team codes go through `normalizeTeamAbbrev`. The repo has measured 67 spellings for 32
  teams, so a raw string match would miss games.

## Decisions (owner, 2026-11-18)

1. **Sports: NFL only.** NFL gets name, logo and the real schedule. NBA, NHL and MLB get name and logo only.
2. **League size: any size.** Real games where both teams are picked, pairings for the rest, and the real-game
   count shown each week.
3. **Who picks: managers.** First come, first served, one manager per real team. The commissioner can assign or
   swap, and picks lock at the draft.
4. **Team name: the real name replaces it.** The manager's own name is saved and comes back if they un-pick.
