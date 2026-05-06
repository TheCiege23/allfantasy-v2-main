# Rolling Insights — NFL field map (documented fields only)

## 1. Source

- **Vendor:** Rolling Insights NFL API Documentation (owner-uploaded reference; see `NFL_Documentation_20251202.md`).
- **Auth:** `RSC_token` query parameter.
- **Sport path value:** `NFL` (path segment in `/api/v1/.../NFL`).

---

## 2. Endpoint inventory

| Logical name | Path pattern |
|--------------|----------------|
| Season schedule | `/api/v1/schedule-season/<DATE>/NFL` |
| Weekly schedule | `/api/v1/schedule-week/<DATE>/NFL` |
| Daily schedule | `/api/v1/schedule/<DATE>/NFL` |
| Live feed | `/api/v1/live/<DATE>/NFL` |
| Team information | `/api/v1/team-info/NFL` |
| Team season stats | `/api/v1/team-stats/<DATE>/NFL` |
| Player information | `/api/v1/player-info/NFL` |
| Player season statistics | `/api/v1/player-stats/<DATE>/NFL` |
| Player injuries | `/api/v1/injuries/NFL` |
| Team depth charts | `/api/v1/depth-charts/NFL` |
| Play-by-play | `/api/v1/play-by-play/NFL` |

---

## 3. Canonical AllFantasy mapping (documented fields only)

### Player profile (`player-info`)

| AllFantasy field | Rolling Insights field |
|------------------|-------------------------|
| `providerPlayerId` | `player_id` |
| `fullName` | `player` |
| `teamName` | `team` |
| `providerTeamId` | `team_id` |
| `jerseyNumber` | `number` |
| `status` | `status` |
| `position` | `position` |
| `positionCategory` | `position_category` |
| `height` | `height` |
| `weight` | `weight` |
| `birthDateRaw` / `ageText` | `age` (labeled “age” in docs; samples read like birthdate strings, e.g. “April 10, 1992”) |
| `college` | `college` |
| `headshotImageId` | `img` |
| `allStar` | `all_star` |

**Not documented** in the reviewed NFL Rolling Insights doc (do **not** treat as RI-authoritative in mapping code):

- `draftYear`, `draftRound`, `draftPick`
- `yearsExperience`, `experience`, `years_exp`
- `rookie`, `isRookie`

---

### Player season stats (`player-stats`)

Assume season buckets such as `regular_season` where the vendor doc places aggregates.

| AllFantasy field | Rolling Insights field |
|------------------|-------------------------|
| `gamesPlayed` | `regular_season.games_played` |
| `fantasyPoints` | `regular_season.DK_fantasy_points` |
| `fantasyPointsPerGame` | `regular_season.DK_fantasy_points_per_game` |
| `completions` | `completions` |
| `passingAttempts` | `passing_attempts` |
| `passingYards` | `passing_yards` |
| `passingTouchdowns` | `passing_touchdowns` |
| `passingInterceptions` | `passing_interceptions` |
| `passerRating` | `passer_rating` |
| `rushingAttempts` | `rushing_attempts` |
| `rushingYards` | `rushing_yards` |
| `rushingTouchdowns` | `rushing_touchdowns` |
| `receptions` | `receptions` |
| `receivingYards` | `receiving_yards` |
| `receivingTouchdowns` | `receiving_touchdowns` |
| `fumbles` | `fumbles` |
| `fumblesLost` | `fumbles_lost` |
| `tackles` | `tackles` |
| `sacks` | `sacks` |
| `interceptions` | `interceptions` |
| `fieldGoalsAttempted` | `field_goals_attempted` |
| `fieldGoalsMade` | `field_goals_made` |
| `fieldGoalsLong` | `field_goals_long` |
| `extraPointsAttempted` | `extra_points_attempted` |
| `extraPointsMade` | `extra_points_made` |
| `puntReturns` | `punt_returns` |
| `puntReturnYards` | `punt_return_yards` |
| `puntReturnTouchdowns` | `punt_return_touchdowns` |
| `kickReturns` | `kick_returns` |
| `kickReturnYards` | `kick_return_yards` |
| `kickReturnTouchdowns` | `kick_return_touchdowns` |

---

### Live (`live`)

| AllFantasy field | Rolling Insights field |
|------------------|-------------------------|
| `gameId` | `game_ID` |
| `gameStatus` | `game_status` |
| `currentGameState` | `full_box.current` |
| `playerLiveStats` | `player_box` |
| `teamLiveStats` | `full_box.home_team.team_stats`, `full_box.away_team.team_stats` |

---

### Injuries (`injuries`)

| AllFantasy field | Rolling Insights field |
|------------------|-------------------------|
| `providerPlayerId` | `player_id` |
| `playerName` | `player` |
| `injury` | `injury` |
| `returnStatus` | `returns` |
| `dateInjured` | `date_injured` |
| Team context | Parent object `team` / `team_id` when present in payload |

---

### Depth charts (`depth-charts`)

Structure is team → position key (e.g. `QB`, `WR1`, `OLB`) → rank (`"1"`, `"2"`, …) → player object.

| AllFantasy field | Rolling Insights field |
|------------------|-------------------------|
| `providerPlayerId` | `id` |
| `playerName` | `player` |
| `depthPosition` | Position object key under team |
| `depthRank` | Rank key under position |
| `providerTeamId` | `team_id` on parent team object |

---

### Schedules / team info (documented fragments)

**Schedule-style identifiers**

- `game_ID`, `game_time`, `season`, `season_type`, `week`, `status`
- `home_team`, `away_team`, `home_team_ID`, `away_team_ID`

**Team info**

- `team_id`, `team`, `abbrv`, `mascot`, `conf`
- Location / venue style fields when documented: `city`, `state`, `arena`, `country`, `field`, `dome`

---

## 4. NFL rookie source rule (operational)

**NFL rookie detection order:**

1. Use verified Rolling Insights **or** imported DB rookie/experience/draft fields **only when present on stored/imported rows** (future RI payloads may add them; until then the standalone NFL doc does not define them).
2. Otherwise use **Sleeper `years_exp`** (cross-linked Sleeper player id or name/position lookup).
3. **Rookie** when Sleeper `years_exp === 0`.
4. Use **`SportsDataCache` key `sleeper:nfl:yearsexp:compact:v1`** when live Sleeper fetch is unavailable (same numeric semantics).
5. If neither verified imported fields nor Sleeper `years_exp` exists, **rookie status is unknown** — do not guess from undocumented Rolling Insights profile fields.

---

## 5. Provider posture (summary)

- Rolling Insights is **primary** for NFL paid data domains documented above (profile, stats, live, injuries, depth charts, schedules, team info, play-by-play).
- **Sleeper `years_exp`** remains the **explicit NFL fallback** for rookie detection because the reviewed NFL Rolling Insights documentation does **not** define rookie / experience / draft-year fields.
- TheSportsDB / ClearSports remain **enrichment** tiers behind Rolling Insights where applicable; see `docs/provider-data-priority.md`.
