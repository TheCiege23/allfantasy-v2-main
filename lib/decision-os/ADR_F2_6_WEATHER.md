# ADR-DOS-F2.6 — Canonical Enrichment: Weather Context

**Status:** Accepted (2026-06-30). Branch `g15-event-foundation`.
**Phase:** 2 (Canonical Enrichment), layer **F2.6** — additive. NOT cutover, NOT a redesign.
**Governed by:** `ARCHITECTURE_FREEZE.md`. **Builds on:** F2.1 player metadata (`5771a78a1`).

---

## 1. Goal

Expose deterministic game-weather context as a sixth read-only derived enrichment layer:

- Temperature, wind speed, precipitation, conditions
- Indoor/dome/roof status
- Weather risk category (deterministic from raw conditions — no projection baseline needed)
- Data source provenance
- Freshness (`expiresAt`-based)
- Honest degradation: not_applicable (indoor sport), indoor, missing team, cache miss, stale

## 2. Source audit (P2 — never fabricate)

### 2.1 Primary source: `WeatherCache` (`weather_cache`)

| Field | Type | Notes |
|---|---|---|
| `cacheKey` | `string UNIQUE` | Pattern: `weather:team-window:{TEAM}:{YYYY-MM-DD}` (team-window) or `weather:game:{sport}:{gameId}` (game-specific). See §2.2. |
| `sport` | `string?` | 'NFL', or null for older entries |
| `temperatureF` | `float?` | Current/forecast temperature °F |
| `feelsLikeF` | `float?` | Feels-like temperature |
| `windSpeedMph` | `float?` | Wind speed in MPH |
| `windGustsMph` | `float?` | Wind gusts |
| `windDirectionDeg` | `float?` | Wind direction in degrees |
| `precipChancePct` | `float?` | Precipitation probability 0–100 |
| `rainInches` | `float?` | Expected rainfall in inches |
| `snowInches` | `float?` | Expected snowfall in inches |
| `conditionCode` | `string?` | Provider condition code |
| `conditionLabel` | `string?` | Human-readable condition (e.g., 'overcast clouds') |
| `isIndoor` | `boolean` | Venue is indoors |
| `isDome` | `boolean` | Venue is a dome |
| `roofClosed` | `boolean` | Retractable roof is closed |
| `eventId` | `string?` | Optional game event link (null in team-window entries) |
| `fetchedAt` | `DateTime` | When fetched from provider |
| `expiresAt` | `DateTime` | TTL — 1 hour for team-window entries; 30 min for game entries |
| `dataSource` | `string` | Provider (e.g., `'openweathermap'`) |

**Proven on staging (2026-06-30):** 99 rows total (93 NFL, 6 null-sport). All `weather:team-window:` keyed. `eventId = null` on all staging entries. `dataSource = openweathermap` for all.

### 2.2 Cache key structure and join strategy

Team-window keys encode the team abbreviation: `weather:team-window:{TEAM}:{DATE}` where:
- `TEAM` = uppercase NFL team abbreviation (e.g., `BUF`, `KC`, `PHI`)
- `DATE` = `YYYY-MM-DD` of the game date

**Join path:** `player.metadata.team` (from F2.1 `EnrichedCanonicalWorld`) → `cacheKey startsWith 'weather:team-window:{TEAM}:'`

This means F2.6 is **independent from F2.2 schedule context** — it queries by team prefix and takes the freshest entry without needing the exact game date. The 1-hour TTL means stale entries are clearly flagged; any active game-week weather refresh will produce a fresh entry.

The freshness degradation is honest: if the cache is stale (expiresAt < now), `isStale: true` is surfaced; if no cache entry exists for the team, `weather_cache_miss` is in uncertainty.

### 2.3 Weather-sensitive sports

Imported from `lib/weather/outdoorSportMetadata.ts` (no external imports — pure metadata):
- **Weather-sensitive** (can have outdoor exposure): NFL, NCAAF, NCAAFB, MLB, MLS, NWSL, Racing
- **Not weather-sensitive** (always indoor or irrelevant): NBA, NHL, golf-specific, esports
- `isWeatherSensitiveSport(sport)` returns true for outdoor-capable sports

When `isWeatherSensitiveSport(sport) === false` → all players get `weatherRiskCategory: 'not_applicable'` without querying the DB.

### 2.4 Sources NOT used in F2.6

| Source | Reason excluded |
|---|---|
| `AFProjectionSnapshot.weatherAdjustment` | Weather-adjusted projection delta (not raw weather); projection adjustments are not in scope for this slice (ticket rule: "do not alter projections directly") |
| `lib/weather/weatherImpactEngine.ts` `calculateWeatherImpact()` | Requires a numeric projection baseline; deterministic but context-dependent — excluded to keep projections separate from weather facts |
| Any live weather API call | P2: F2.6 reads ONLY already-persisted `WeatherCache` rows; never warms the cache, never calls OpenWeatherMap |

### 2.5 Weather risk category (pure, deterministic, no baseline)

Derived from raw conditions only — not from a position-specific impact calculation:

| Category | Condition |
|---|---|
| `'not_applicable'` | Sport is not weather-sensitive |
| `'indoor'` | `isDome || isIndoor || roofClosed` |
| `'extreme'` | Wind ≥ 35 mph, OR wind ≥ 25 + (snow > 0 or heavy rain) |
| `'high'` | Wind ≥ 25 mph, OR snow > 0 + wind ≥ 15 |
| `'moderate'` | Wind ≥ 15 mph, OR rain precip > 60%, OR snow > 0, OR temp < 20°F |
| `'low'` | Wind ≥ 10 mph, OR temp < 32°F |
| `'none'` | No significant conditions |

This is position-agnostic; it reflects venue/game conditions, not player-specific impact.

## 3. Freeze compliance — why this is ADDITIVE

- No change to pure `CanonicalWorld`, assembler, or any Phase-1 frozen contract.
- No change to F2.1–F2.5 views.
- New `RawWeatherRow` fact type — allowed.
- New `loadWeatherRows` port function — read-only, no writes, no live API calls.
- New `WeatherEnrichedCanonicalWorld` derived view — additive, layers on F2.1.
- No writes, no provider branch, no cache warming.

## 4. Team-level weather grouping

Weather is a **team-level** fact: all players on the same team share the same game weather. The projector groups by team and maps the result back to each player.

- `WeatherContext.teamAbbrev` carries the team abbreviation used for the lookup
- Players on the same team share the same `WeatherContext`
- Players with no team in metadata (team is null) → `weather_team_unknown` uncertainty

## 5. Decision

**`facts.ts` addition:** `RawWeatherRow`

**`port.ts` addition:** `loadWeatherRows(sport, teamAbbrevs)` — queries `WeatherCache` by `cacheKey startsWith 'weather:team-window:{TEAM}:'` for each team using Prisma `OR`. Ordered `expiresAt desc`. Takes first per team in JS. Read-only, no writes.

**`weatherEnrichedWorld.ts` (new file):**
- `deriveWeatherRiskCategory(row)` — pure tier derivation from raw conditions
- `projectWeatherFreshness(row, now)` — `expiresAt`-based staleness
- `projectWeatherContext(row, team, sport, now)` — builds `WeatherContext` with honest degrade
- `projectWeatherEnrichedWorld(world, contextResult, leagueFacts, now)` — folds on F2.1
- `resolveWeatherContext(sport, teamAbbrevs, port?)` — read-only resolver
- `resolveWeatherEnrichedCanonicalWorld(leagueId, deps?)` — chains F2.1, never throws

## 6. Field scope

| Field | Source | Degradation |
|---|---|---|
| `weatherContext.temperatureF` | `WeatherCache.temperatureF` | null |
| `weatherContext.windSpeedMph` | `WeatherCache.windSpeedMph` | null |
| `weatherContext.windGustsMph` | `WeatherCache.windGustsMph` | null |
| `weatherContext.precipChancePct` | `WeatherCache.precipChancePct` | null |
| `weatherContext.rainInches` | `WeatherCache.rainInches` | null |
| `weatherContext.snowInches` | `WeatherCache.snowInches` | null |
| `weatherContext.conditionLabel` | `WeatherCache.conditionLabel` | null |
| `weatherContext.isIndoor` | `WeatherCache.isIndoor \| isDome \| roofClosed` | null |
| `weatherContext.weatherRiskCategory` | derived (pure) | 'not_applicable' when non-outdoor sport |
| `weatherContext.freshness.isStale` | `expiresAt < now` | null when no row |
| `weatherContext.dataSource` | `WeatherCache.dataSource` | null |
| `weatherContext.teamAbbrev` | from player metadata | null when team unknown |

## 7. Deliverables

1. This ADR.
2. `facts.ts` — add `RawWeatherRow`.
3. `port.ts` — add `loadWeatherRows`.
4. `weatherEnrichedWorld.ts` — new derived view.
5. `world/index.ts` — re-exports.
6. Tests: weather present, indoor/dome, missing team, cache miss, stale, risk categories, not_applicable sport, no-mutation, origin-blind shape, resolver-never-throws, architecture guard.
7. Non-prod conformance re-run (all 5 scripts GREEN).
8. Real-data probe + results documented in §10.

## 8. Success

Canonical World exposes deterministic game-weather context where available, with risk categorization, freshness, and honest degradation, while every Phase-1 frozen invariant and all conformance checks remain GREEN.

## 9. Registry

No `DECISION_REGISTRY.md` row — substrate enrichment, not a decision slice.

## 10. Real-data results (non-prod `ep-winter-salad`, 2026-06-30)

**Weather coverage probe (`scripts/probe-weather-coverage.ts`):**

| Metric | Value |
|---|---|
| Total `WeatherCache` rows | 99 |
| Fresh (expiresAt > now) | **0** — all stale (fetched 2026-06-27, 1h TTL expired) |
| By sport | NFL: 93, null: 6 |
| By dataSource | openweathermap: 99 |
| Cache key pattern | `weather:team-window:{TEAM}:{DATE}` confirmed |
| `eventId` | null on all staging entries |

**FINDING F2.6-1 (all stale on staging — expected, benign):**
All 99 rows expired ~3 days ago (1h TTL, last fetched 2026-06-27). Weather cache is populated by the lineup-signal cron which runs in production. Honest degrade (`weather_stale`) expected for all teams on non-prod. Production weather refreshes every 30–60 min during game weeks.

**FINDING F2.6-2 (null sport on 6 rows — benign):**
6 older entries have `sport = null`. The port queries without a sport filter when needed to catch these. The `cacheKey` prefix (`weather:team-window:`) still uniquely identifies them.

**FINDING F2.6-3 (team abbreviations confirmed):**
Staging has NFL team abbreviations in the `weather:team-window:` keys (CAR, SEA, PHI, etc.) matching the uppercase abbreviations from `NFL_TEAM_VENUES`. These match F2.1 player metadata `team` field for NFL players.

**Five conformance scripts — all GREEN on both origins:**
`WORLD_CONFORMANCE_OK` / `LINEUP_CONFORMANCE_OK` / `WAIVER_CONFORMANCE_OK` / `COMMISSIONER_CONFORMANCE_OK` / `TRADE_CONFORMANCE_OK` — every Phase-1 frozen invariant intact after F2.6 additions.
