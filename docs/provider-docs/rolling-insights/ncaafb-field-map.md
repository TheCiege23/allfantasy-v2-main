# NCAAFB Rolling Insights — field maps

## Sport code

Rolling Insights path segment: **`NCAAFB`**.

Aliases accepted in **`getRollingInsightsSportCode`**: `NCAAF`, `NCAAFB`, `CFB`, `NCAA_FOOTBALL`, `COLLEGE_FOOTBALL`, `NCAA_FB`, `NCAA_F`, `NCAAFOOTBALL`.

App **`LeagueSport`** remains **`NCAAF`** (`normalizeToSupportedSport('NCAAFB')` → `NCAAF`).

## Endpoints (documented)

| Feed | Pattern |
|------|---------|
| Player info | `GET /api/v1/player-info/NCAAFB?RSC_token=…` |
| Player stats | `GET /api/v1/player-stats/<YYYY-MM-DD>/NCAAFB?RSC_token=…` |
| Live | `GET /api/v1/live/<YYYY-MM-DD>/NCAAFB?RSC_token=…` |
| Season schedule | `GET /api/v1/schedule-season/<YYYY>/NCAAFB?RSC_token=…` |
| Weekly schedule | `GET /api/v1/schedule-week/<YYYY-MM-DD>/NCAAFB?RSC_token=…` |
| Daily schedule | `GET /api/v1/schedule/<YYYY-MM-DD>/NCAAFB?RSC_token=…` |
| Team info | `GET /api/v1/team-info/NCAAFB?RSC_token=…` |
| Team season stats | `GET /api/v1/team-stats/<YYYY>/NCAAFB?RSC_token=…` |

Optional: `team_id`; daily schedule may include `game_id`.

See **`ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT.NCAAFB`** for placeholder keys (`scheduleSeason`, `scheduleWeek`, `scheduleDay`, `teamStats`).

**Nullable venue fields** on schedule rows (`arena`, `city`, `state`, `country`, `postal_code`, `latitude`, `longitude`, `field`, `dome`) are valid — preserve nulls and enrich from **team-info** when available.

Canonical maps live in **`lib/providers/rollingInsightsFieldMaps.ts`** under vendor sport **`NCAAFB`**.

## Profile (`profile`)

| Canonical | RI field |
|-----------|--------|
| providerPlayerId | player_id |
| fullName | player |
| teamName | team |
| providerTeamId | team_id |
| jerseyNumber | number |
| status | status |
| position | position |
| positionCategory | position_category |
| height | height |
| weight | weight |
| collegeClass | **class** |

## Player stats (`player_stats`)

Season aggregates under **`regular_season.*`** — see **`NCAAFB_STATS`** (includes two-point conversion attempts/success fields).

## Live — game shell (`ncaaf_live`)

| Canonical | RI field |
|-----------|----------|
| week | week |
| sport | sport |
| season | season |
| status | status |
| gameId | game_ID |
| gameTime | game_time |
| eventName | event_name |
| gameStatus | game_status |
| seasonType | season_type |
| gameLocation | game_location |
| awayTeamName | away_team_name |
| homeTeamName | home_team_name |

## Live — current situation (`ncaaf_live_current`)

Uses **`full_box.current.*`** (Down, poss, Quarter, etc.) — see **`NCAAFB_LIVE_CURRENT`**.

## Live — team shell (`ncaaf_live_team`)

Home/away split: **`full_box.home_team.*`** / **`full_box.away_team.*`** (score, abbrv, mascot, record, team_id, division_name, quarter_scores).

## Live — team stats (`ncaaf_live_team_stats`)

Aggregates under **`team_stats.*`** (sacks, penalties, turnovers, special-teams TD breakdowns, points_against_defense_special_teams, …).

## Live — player box (`ncaaf_live_player_box`)

Pass/rush/rec, defense (`tackles`, `sacks`, `fumbles_recoveries`), kicking, punting, returns — see **`NCAAFB_LIVE_PLAYER_BOX`**.

## Schedule (`schedule`)

Daily schedule fields: teams, IDs, game_ID, week, venue/geo (`arena`, `city`, `state`, `latitude`, `longitude`), `field`, `dome`, `postal_code` — see **`NCAAFB_SCHEDULE`**.

## Team info (`team`)

| Canonical | RI field |
|-----------|--------|
| teamId | team_id |
| teamName | team |
| abbreviation | abbrv |
| mascot | mascot |
| rank | rank |
| conferenceId | conf_ID |
| conference | conf |
| … | city, state, arena, country, lat/long, field, postal_code, dome |

## Team season stats (`ncaaf_team_season_stats`)

Under **`regular_season.*`** on the team-stats endpoint — defense/ST TD categories, points, yards, PA-D/ST, etc. — see **`NCAAFB_TEAM_SEASON_STATS`**.

## Class handling

**`class`** from player-info powers **`collegeClass`** metadata, **`normalizeCollegeClass`**, and NCAA football filters — **not** Sleeper **`years_exp`**.
