# G41 NFL Redraft Player Data Pipeline

## Scope

G41 standardizes player data for AllFantasy NFL redraft surfaces. The pipeline is intentionally internal to AF redraft: it does not build new external Sports OS consumers, and it keeps scoring, waivers, trades, draft, roster, matchup, and playoff runtimes on cached/DB-backed provider evidence.

## Canonical Flow

1. Provider and pool rows enter the player-data foundation through `normalizePoolRowToUnified` or draft-pool normalization.
2. `buildUnifiedPlayerProductView` creates a sport-aware `UnifiedProductMeta` with identity, media, stats, projections, injury, ADP, rookie, and experience fields.
3. `serializeUnifiedPlayerForApi` adds the NFL-only `nflRedraft` canonical snapshot by calling `buildNflRedraftCanonicalPlayer`.
4. Surface adapters project the same wire row into draft, waiver, roster, trade, matchup, scoring, and AI-friendly shapes.

## Canonical Player Contract

`NflRedraftCanonicalPlayer` is versioned as `nfl-redraft-player-v1` and includes:

- Provider identity: AF id, provider id, Sleeper id, ESPN/Yahoo/GSIS/Sportradar/FantasyCalc/Rolling Insights placeholders.
- Football identity: display name, team, position, fantasy position, roster eligibility, jersey, bye week.
- Media: player headshot and team logo with explicit fallback kind and `safeToRenderImage`.
- Player context: age, years of experience, college, depth chart role/rank.
- Historical stats: previous season and season rows, including football stat lines and freshness.
- Projections: weekly, season, rest-of-season, floor, ceiling, rank, positional rank, source, freshness, unavailable flag.
- Injury/status/news: provider designation, practice/game status, news summary, timestamps, freshness.
- Fallbacks and data quality: missing fields, stale warnings, last-updated timestamp.

## Projection Semantics

G41 keeps historical FPPG separate from true projection values. `unified.projectedPoints` now comes from explicit projection keys or NFL draft projection splits. `unified.fantasyPointsPerGame` remains historical/observed FPPG. If no explicit projection exists, the canonical projection is marked unavailable instead of inventing a weekly projection from FPPG.

## Fallbacks And Freshness

Missing media, stats, projections, injury, news, and provider IDs are represented as structured fallbacks. Stale checks are deterministic:

- Stats: 7 days.
- Projections: 3 days.
- Injury: 2 days.
- News: 3 days.

The app should render the best available field, display degraded UI safely, and use `dataFreshness.staleWarnings` for provider-quality messaging.

## Surface Wiring

- Draft: unified product view carries explicit projection splits into the canonical row.
- Players: `/api/redraft/players` returns normalized rows and supports `playerId` detail payloads with projections, injury, news, and media.
- Waivers: both `/api/redraft/players` and the legacy waiver pool route serialize available players through the unified player API shape.
- Roster/team: `/api/redraft/roster` hydrates roster players with canonical media, status, projection, ranks, ADP, warnings, and the full `canonicalNflRedraft` object.
- Trade: roster asset selection receives the enriched roster payload; trade evidence adapters read canonical media, injury, projection, fallbacks, and staleness.
- Matchup: `/api/redraft/matchup` exposes unified NFL matchup player contexts by roster using cached normalized rows.
- Live scoring: scoring math remains stat/rules based, while score rows carry optional canonical display metadata.
- Playoffs: playoff qualification/bracket logic remains team-based; player data is available through roster/scoring/matchup contexts used around playoff views.

## Events

`buildNflRedraftPlayerDataEvents` emits canonical runtime events for:

- `player.data.refreshed`
- `player.status.changed`
- `player.injury.status_changed`
- `player.projection.updated`
- `player.team.changed`
- `player.data.fallback_used`

These events are designed for internal AF runtime trails and future provider refresh observability.

## Guardrails

The pipeline must not call live providers from user-facing routes. User-facing routes consume DB/cache rows through `getNormalizedPlayerData`, draft-pool entries, or existing roster/score tables. Missing provider data should degrade into explicit fallbacks rather than fabricated player facts.
