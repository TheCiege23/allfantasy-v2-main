# Provider enrichment capability matrix

Purpose: separate **what each vendor is good for** from **rookie/veteran** signals. Source priority for fantasy gameplay remains in `docs/provider-data-priority.md` and `docs/player-experience-source-priority.md`.

## Rolling Insights

- **Primary** paid feeds where documented: stats, live, schedules, injuries (sport-dependent), depth charts, player boxes — see `lib/providers/rollingInsightsFieldMaps.ts`.

## TheSportsDB

- **Docs:** `https://www.thesportsdb.com` — v1 key-in-path (`/api/v1/json/{key}/…`), v2 premium with `X-API-KEY`.
- **Strengths:** player/team/league lookup, schedules/events, **images** (`strCutout`, `strRender`, `strThumb`, team badges/logos), former teams, contracts, milestones — see `lib/providers/theSportsDbUrls.ts`, `lib/providers/theSportsDbFieldMaps.ts`, `lib/workers/providers/thesportsdb.ts`.
- **Rookie/veteran:** not guaranteed by the excerpted docs used here; only treat as an experience source when imported JSON contains explicit keys — `hasTheSportsDbExperienceSignal`, `THE_SPORTS_DB_CAPABILITIES.rookie_experience === 'unknown'`.

## ClearSports

- **Public REST base (screenshots):** `https://api.clearsportsapi.com`
- **Doc portal:** `https://www.clearsportsapi.com/docs`
- **NFL endpoints captured from screenshots:**

| Area | Path |
|------|------|
| Player stats | `GET /api/v1/nfl/player-stats` |
| Team stats | `GET /api/v1/nfl/team-stats` |
| Injuries | `GET /api/v1/nfl/injury-stats` |
| Team by id | `GET /api/v1/nfl/teams/:teamId` |
| Games / schedule | `GET /api/v1/nfl/games` |

- **Strengths:** NFL player/team stats fallbacks, injury reports, team lookup, schedule/games — `CLEARSPORTS_NFL_CAPABILITIES` in `lib/providers/clearSportsFieldMaps.ts`.
- **Ingestion note:** `lib/workers/providers/clearsports.ts` uses the internal `lib/clear-sports` client paths (e.g. `leagues/{league}/players`); the table above is the **documented REST** surface for URL builders (`lib/providers/clearSportsUrls.ts`).
- **Rookie/veteran:** **not documented** on those screenshot endpoints; use **only** if stored payloads contain explicit experience/draft/debut fields — `hasClearSportsExperienceSignal`.

## Sleeper (NFL)

- **Fantasy ids**, roster ecosystem, and **`years_exp`** as the usual NFL **rookie/veteran fallback** when RI/TSDB/ClearSports JSON lacks experience fields.

## Audits (read-only DB)

```bash
npm run data:audit-provider-coverage -- --sport NFL --provider clearsports --limit 20
npm run data:audit-player-experience -- --sport NFL --provider clearsports --limit 20
npm run data:audit-provider-coverage -- --sport NFL --provider thesportsdb --limit 20
```
