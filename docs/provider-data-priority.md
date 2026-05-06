# Provider data priority (AllFantasy)

See **`docs/provider-fallback-system.md`** for domain-by-domain fallback chains (Rolling Insights → TheSportsDB / ClearSports → Sleeper / internal) and merge rules.

## Rolling Insights primary strategy

For sports where vendor Markdown/docs cover feeds, **Rolling Insights** is **tier 1** for documented player profile fields, season statistics, live scoring / player boxes, teams, schedules, injuries, depth charts, and play-by-play — see `lib/providers/rollingInsightsFieldMaps.ts` and `docs/provider-docs/rolling-insights/`.

## Sport → Rolling Insights path segment

| App sport (`LeagueSport`) | RI segment (`getRollingInsightsSportCode`) |
|---------------------------|--------------------------------------------|
| NFL | NFL |
| NBA | NBA |
| MLB | MLB |
| NHL | NHL |
| NCAAF | **NCAAFB** |
| NCAAB | **NCAABB** |
| SOCCER | SOCCER |

**Euro soccer (EPL / La Liga / Serie A)** uses RI segment **`SOCCER`** with required **`league=EPL|LALIGA|SERIEA`** on every call. Mapping detail: `docs/provider-docs/rolling-insights/soccer-field-map.md`.

Do **not** call RI with `NCAAB` when the endpoint requires **`NCAABB`**.

## Tier ordering

Default chain (non-NFL): Rolling Insights → TheSportsDB → ClearSports → internal.  
**NFL** inserts **Sleeper** before internal for fantasy-ecosystem bridges (`lib/providers/providerPriority.ts`).

## NFL rookie exception

- RI is primary for NFL paid data domains.
- **`years_exp` rookie detection** uses **Sleeper** (and `SportsDataCache` compact fallback) because the RI NFL doc does **not** document rookie / draft year / experience fields.
- Policy helper: `lib/providers/nflRookieSourcePolicy.ts`.

## Experience / pro years (rookie vs veteran)

- **Resolver:** `lib/player-data/playerExperience.ts` — merges pool row + `sports_players` JSON with sport-specific priority (RI/imported fields when present → TheSportsDB/ClearSports-labeled JSON when present → NFL Sleeper `yearsExp` / policy → draft or debut year derivation → unknown).
- **Field scanner:** `lib/player-data/providerExperienceFields.ts` — only explicit keys; never infer from age or college alone for pro leagues.
- **Docs:** `docs/player-experience-source-priority.md`
- **DB audit:** `npm run data:audit-player-experience -- --sport NBA --limit 20`

## NBA / MLB / NHL / NCAABB field inventories

Summarized from owner uploads in `docs/provider-docs/rolling-insights/*-field-map.md` — mapped keys live alongside NFL in `rollingInsightsFieldMaps.ts`.

## NCAA football (`NCAAFB` codes + `class`)

RI player-info includes **`class`** (Fr / So / Jr / Sr / Gr / RS-*). Rolling Insights also exposes **schedule**, **team info**, **team season stats**, **live** player/team boxes, and **player stats** under vendor sport code **`NCAAFB`**. Used for **college** filters (freshman ≈ “rookies only” for NCAAF pools), **not** Sleeper `years_exp`. Helpers: `lib/draft-room/collegeClass.ts`.

## Enrichment vs experience

- **TheSportsDB** — images, lookups, schedules/events; not a guaranteed rookie/veteran source. See `docs/provider-enrichment-capability-matrix.md`, `lib/providers/theSportsDbCapabilities.ts`.
- **ClearSports** — NFL stats / team stats / injuries / games (per public docs); **rookie experience not documented** on those endpoints. See `lib/providers/clearSportsFieldMaps.ts`, URL builder `lib/providers/clearSportsUrls.ts`.

## Coverage audit (read-only)

```bash
npm run data:audit-provider-coverage -- --sport NFL --limit 20
npm run data:audit-provider-coverage -- --sport NFL --provider clearsports --limit 20
npm run data:audit-provider-coverage -- --sport NCAAFB --missing class --limit 10 --json
npm run data:audit-provider-coverage -- --sport NCAAFB --missing schedule --limit 10
npm run data:audit-provider-coverage -- --sport NCAAFB --missing team_stats --limit 10
```

## Product integration (normalized player row)

- **Cross-surface view model:** `buildUnifiedPlayerProductView` extends each `NormalizedDraftEntry` with `unified` metadata (sources, class/soccer league, NFL rookie policy, merged `sports_players` stats when provided) — `lib/player-data/unifiedPlayerProductView.ts`.
- **Surface resolver (DB/cache only):** `getPlayerDataForSurface` — `lib/player-data/getPlayerDataForSurface.ts` — used for Draft (`draft`), waivers (`waivers`), roster (`roster`/`lineup`), and player-card/AI-style lookups (`player_card`, `ai_context`, …).
- **Flow diagram (conceptual):** imported RI / Sleeper / SportsDB rows → `SportsPlayer` / `sports_players` / draft pool resolution → `normalizeDraftPlayer` → **optional** `buildUnifiedPlayerProductView` → **surface adapters** (`lib/player-data/adapters/*`) → DraftRoom, Waivers, Rosters, AI prompts.

See **`docs/player-data-integration-map.md`** for route/surface mapping and remaining UI wiring gaps.

## Code references

- Unified maps + RI sport code: `lib/providers/rollingInsightsFieldMaps.ts`
- NFL-only constants: `lib/providers/rollingInsightsNflFieldMap.ts`
- Tier + field ownership: `lib/providers/providerPriority.ts`
- Doc registry: `lib/providers/rollingInsightsDocsRegistry.ts`
- DB coverage aggregates: `lib/providers/providerDataCoverage.ts`
- Unified player product layer: `lib/player-data/`
