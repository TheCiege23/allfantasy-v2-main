# Provider fallback system (AllFantasy)

## Goals

- **Rolling Insights** is the **primary** paid data source where documented.
- **TheSportsDB** fills **gaps** for teams/players/**images**/**logos**/**schedules**/**events** (enrichment).
- **ClearSports** fills **NFL** gaps for **stats / injuries / games / teams** when JSON exists in cache (per public REST docs + internal client).
- **Sleeper** is **NFL fantasy** fallback: **IDs**, **years_exp** / rookie context, and **ADP** when your imports expose it.
- **AllFantasy internal** owns **system + AI ADP**, **waiver/trade value models**, **roster/lineup league state**, and **league settings**.

**Golden rule:** fallbacks **only fill missing, stale, or low-confidence** fields. They must **not** clobber a good Rolling Insights value with a lower-tier provider unless policy marks the current value replaceable.

## Code map

| Piece | Path |
|-------|------|
| Domain priority chains | `lib/providers/providerFallbackPolicy.ts` |
| Field merge helpers | `lib/providers/providerMerge.ts` |
| Per-provider role in chain | `lib/providers/providerDomainCapabilities.ts` |
| Static vendor evidence (TSDB/CS URL maps) | `lib/providers/clearSportsFieldMaps.ts`, `lib/providers/theSportsDbCapabilities.ts`, `lib/providers/providerCapabilities.ts` (barrel) |
| Server player orchestration (unchanged) | `lib/player-data/getPlayerDataForSurface.ts` |
| Optional diagnostics wrapper | `lib/player-data/getNormalizedPlayerData.ts` |
| Experience resolution (no age guessing) | `lib/player-data/playerExperience.ts` |

## Domain rules (summary)

| Domain | Primary | Typical fallbacks |
|--------|---------|-------------------|
| Player profile | RI | TSDB, ClearSports, Sleeper, internal |
| Player images | RI | TSDB, Sleeper, ClearSports, internal |
| Team profile / logos | RI | TSDB, ClearSports, internal |
| Player/team stats | RI | **ClearSports**, TSDB, internal |
| Live / injuries | RI | **ClearSports (NFL where cached)**, TSDB, internal |
| Schedules / games | RI | TSDB, ClearSports, internal |
| ADP | **Internal imports / system** | Sleeper, then others **only if explicit ADP field** exists in stored JSON |
| AI ADP | **Internal only** | — |
| Rookie / pro years | RI / imported fields if present | TSDB/CS only with **real** experience keys; **NFL Sleeper `years_exp`**; else unknown |
| Waiver / trade value | **Internal model** | Provider inputs (stats, injuries, projections) |
| Roster / lineup context | **Internal** + provider enrichments | — |

## What must never be guessed

- **ADP** (no inventing from generic stat lines).
- **Rookie / veteran** (no age-only or college-only inference for pro leagues).
- **Trade / waiver value** (product models — not a vendor field).
- **Projections** without a real stored projection source.

## Audits (read-only, Neon)

```bash
npm run data:audit-provider-gaps -- --sport NFL --domain stats --limit 20
npm run data:audit-provider-coverage -- --sport NFL --limit 20
npm run data:audit-player-experience -- --sport NFL --limit 20
```

## Surface migration

Product routes should keep using **one** server entry (`getPlayerDataForSurface` or `getNormalizedPlayerData` with explicit diagnostics) and merge **at import/cache time** where possible. Full UI refactors are **incremental** per surface.

### Debug visibility

- Query **`?debugPlayerData=1`** (or `true`) on routes that call `resolveIncludePlayerDataDiagnostics`, or rely on **`NODE_ENV === 'development'`** for automatic diagnostics on some APIs.
- Draft pool (`GET /api/leagues/[leagueId]/draft/pool`) can return `normalizedPlayerDataDiagnostics` for the first 10 entries; the Draft Room client **logs and discards** this field so it is not cached in React state.
- Helpers: `logPrefixForSurface`, `logNormalizedPlayerDataDiagnostics`, `redactDiagnosticsForLog` — `lib/player-data/providerFallbackDiagnostics.ts`.

### Example audits

```bash
npm run data:audit-provider-gaps -- --sport NFL --surface draft --domain stats --limit 10
npm run data:audit-provider-gaps -- --sport NFL --surface waivers --domain injuries --limit 10
npm run data:audit-provider-gaps -- --sport NFL --surface roster --domain experience --limit 10
```

### Draft room display consistency

- **Board:** Completed pick cells overlay `mergePoolPlayerIntoBoardPickDisplay` when the pick’s `playerId` exists in the live pool map — better headshot/injury/experience badge; **no** change to `DraftPickSnapshot` or submission APIs.
- **Queue:** Row chips use unified fallbacks from the same pool map; **queue JSON / order** from the draft engine is untouched.
- **Selected player:** `PlayerDetailModal` headshot/injury prefer `getDraftRoomDisplayHeadshot` / `getDraftRoomDisplayInjury` so the modal matches the pool row.

### Trade evaluator (AI context only)

- `POST /api/trade-evaluator` maps Sleeper name keys and optional explicit ids to **`SportsPlayerRecord.id`**, then calls `getNormalizedPlayerData({ surface: 'trade', leagueId, playerIds })` (read-only DB/cache).
- Prompt text includes `buildNormalizedTradeEvidencePrompt` output; response may include **`providerEvidence.summary`** (counts, capped `fallbackSources` / `missingDomains`, optional `missingDataNote`). **No raw provider blobs** and **no overwrite** of `valuationReport` or trade processing.
- Dev-only log prefix: **`[trade normalized player context]`** (summary fields only).

```bash
npm run data:audit-provider-gaps -- --sport NFL --surface trade --domain injuries --limit 10
npm run data:audit-provider-gaps -- --sport NFL --surface trade --domain stats --limit 10
```
