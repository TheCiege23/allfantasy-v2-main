# Sports Provider Capability Matrix (Fantasy OS Phase 5)

Source of truth: each adapter's `getCapabilities()` declaration + `lib/sports-data-gateway/inventory.ts`.
The gateway rejects any (provider, sport, capability) not declared here — it never silently returns `[]`.

| Provider | Sports | Declared capabilities | Auth | Status |
|---|---|---|---|---|
| sleeper | NFL | players, rosters, transactions, draft_data | none (public) | **production_connected (verified)** |
| rolling_insights | NFL/NBA/MLB/NHL/NCAAF/NCAAB/SOCCER | players, teams, schedules, games, live_scores, statistics, injuries, depth_charts | oauth/api_key | configured_not_verified |
| cfbd | NCAAF | college_players, teams, schedules, games, statistics | api_key | configured_not_verified |
| thesportsdb | NFL/NBA/MLB/NHL/SOCCER | players, teams, team_branding, player_headshots | api_key | configured_not_verified |
| api_sports | NFL/NBA/MLB/NHL/SOCCER | players, teams, games, live_scores, statistics | api_key | configured_not_verified |
| espn | NFL/NCAAF | games, schedules, live_scores, team_branding | none | partial |
| yahoo | NFL | league_data, rosters, transactions | oauth | configured_not_verified |
| openweathermap | NFL | weather | api_key | configured_not_verified |
| newsapi | NFL/NBA/MLB/NHL | news | api_key | configured_not_verified |
| clearsports | NFL | players, statistics | api_key | configured_not_verified (no consumer) |

**Provider priority (fallback is capability-specific):** define `ProviderPriorityRule`s per (sport, capability).
A provider suitable for `team_branding` (thesportsdb) is not suitable for `injuries` (rolling_insights) or
`live_scores` (api_sports/rolling_insights) — fallback chains must not blend unsuitable providers.

**Known gaps:** projections have no verified provider yet; weather/news/injuries are configured-not-verified;
Sleeper injuries are a coarse `injury_status` only (not a full availability feed).
