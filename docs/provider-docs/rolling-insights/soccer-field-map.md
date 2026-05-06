# Rolling Insights — SOCCER (EPL / LALIGA / SERIEA)

## Sport code

Path segment: **`SOCCER`**.

## Required query parameters

All SOCCER endpoints require:

- `RSC_token` (required)
- `league` = **`EPL`** | **`LALIGA`** | **`SERIEA`**

Optional filters are documented per endpoint (e.g. `team_id`, `relegated`, `game_id`).

## Endpoints (documented)

| Feed | Path |
|------|------|
| Team info | `GET /api/v1/team-info/SOCCER?RSC_token=…&league=…` |
| Player info | `GET /api/v1/player-info/SOCCER?RSC_token=…&league=…` |
| Season schedule | `GET /api/v1/schedule-season/<YYYY>/SOCCER?RSC_token=…&league=…` |
| Daily schedule | `GET /api/v1/schedule-daily/<YYYY-MM-DD>/SOCCER?RSC_token=…&league=…` |
| Daily schedule (observed alias) | `GET /api/v1/schedule/<YYYY-MM-DD>/SOCCER?RSC_token=…&league=…` |
| Weekly schedule | `GET /api/v1/schedule-weekly/<YYYY-MM-DD>/SOCCER?RSC_token=…&league=…` |
| Live | `GET /api/v1/live/<YYYY-MM-DD>/SOCCER?RSC_token=…&league=…` |
| Team season stats | `GET /api/v1/team-stats/<YYYY>/SOCCER?RSC_token=…&league=…` |

Canonical path placeholders also appear on **`ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT.SOCCER`** in code (`scheduleDayAlias` documents the `/schedule/…` variant).

## Team info map

See **`ROLLING_INSIGHTS_FIELD_MAPS.SOCCER.team`** — `team_id`, `team`, `abbrv`, `league`, venue/geo fields.

**Relegated:** `relegated=TRUE|FALSE` narrows current vs relegated squads; omitting returns combined samples per docs.

## Schedule map

See **`schedule`** domain — `away_team`, `home_team`, IDs, `game_ID`, `season`, `status`, venue/geo fields.

**Status:** includes `replaced` for duplicate/incorrect rows — **do not expect live scoring** for those instances (`shouldExpectSoccerLiveData` treats **`replaced`** as no live feed).

**Nullable venue fields:** `city`, `country`, `postal_code`, `arena`, coordinates may be null — imports must not fail the row.

## Player info map

See **`profile`** — `player_id`, `player`, `team`/`team_id`, `number`, `status`, `position`, `height`, `weight`, **`age`** (often a birthdate-style string → **`birthDateRaw`** in maps).

## Live maps

- **`soccer_live`** — shell fields (`game_status`, team names, `game_ID`, …).
- **`soccer_live_team_shell`** — `full_box.*_team.score`, `quarter_scores`.
- **`soccer_live_team_stats`** — documented `team_stats.*` soccer metrics.
- **`soccer_live_player`** / **`soccer_live_goalkeeper`** — player-box keys (goalkeepers add saves / goals conceded / clean sheets / penalties).

## Team season stats

See **`soccer_team_season_stats`**. Vendor may emit **`ties`** and **`draws`** — use **`normalizeRollingInsightsSoccerDraws`** for a canonical draws value while preserving raw payloads.

**Relegated teams** may return `relegated: true` and `regular_season: null` — **valid**, not an import failure.

## Helpers

- League normalization: `lib/providers/rollingInsightsSoccerLeague.ts`
- Status / replaced: `lib/providers/rollingInsightsSoccerStatus.ts`
- Draws / relegated stats: `lib/providers/rollingInsightsSoccerTeamStats.ts`
- URL builder (no token logging): `lib/providers/rollingInsightsSoccerUrl.ts`
