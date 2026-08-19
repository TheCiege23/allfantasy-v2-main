# Second Provider Selection (Fantasy OS Phase 5D-b, Stop-gate 2)

Selected **ESPN** (public NFL API, no key) as the verified second provider for **schedules/games** — the smallest safe path that unlocks Lineup/Matchup game-state and Trade/Waiver schedule enrichment.

## ProviderSelectionEvidence — espn
| Field | Value |
|---|---|
| provider | espn |
| sport | NFL |
| capabilities | schedules, games, team_branding |
| credentialPresent | n/a (public, no key) |
| authenticationVerified | **true** (public reachable, HTTP 200) |
| endpointVerified | **true** (`site.api.espn.com/.../nfl/scoreboard`) |
| payloadSchemaVerified | **true** (16 games; event id/date, `status.type.state/name`, competitors `team.id`+abbr, venue, season/week) |
| rateLimitKnown | false (undocumented public limits) |
| sourceUpdateTimestampAvailable | **true** (`event.date`, status) |
| canonicalIdentityFieldsAvailable | **true** (game id, team id + abbreviation) |
| limitations | scoreboard does **not** expose player injuries/availability; undocumented rate limits |

## Decision
ESPN is verified for **games/schedules only** this increment. **Injuries/availability** are NOT available from this endpoint and remain `configured_not_verified` (a future increment: a real injury feed via Rolling Insights / API-Sports). Cross-provider **team identity** (Sleeper team abbreviation ↔ ESPN team id) is required before player→game mapping enriches Lineup — a follow-up.

## Why not the others (this increment)
Rolling Insights / API-Sports (keyed, OAuth/rate-limits unverified) and TheSportsDB/ClearSports were not the smallest safe path; ESPN needs no credential and was verified with one request. A credential being present is not verification.
