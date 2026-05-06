# Player data integration map

Single orchestration layer connects **imported / cached provider rows** (Rolling Insights primary where documented, plus TheSportsDB / ClearSports / Sleeper fallbacks) to product surfaces.

## Normalized core

| Piece | Path |
|-------|------|
| Draft canonical row | `NormalizedDraftEntry` + `PlayerDisplayModel` — `lib/draft-sports-models/types.ts` |
| Raw → draft normalize | `normalizeDraftPlayer` — `lib/draft-sports-models/normalize-draft-player.ts` |
| Cross-surface augmentation | `buildUnifiedPlayerProductView` — `lib/player-data/unifiedPlayerProductView.ts` |
| Pool row bridge | `poolPlayerRecordToRawDraftLike` — `lib/player-data/normalizeProviderPlayer.ts` |
| Server orchestration | `getPlayerDataForSurface` — `lib/player-data/getPlayerDataForSurface.ts` |
| Normalized wrapper + optional diagnostics | `getNormalizedPlayerData` — `lib/player-data/getNormalizedPlayerData.ts` |
| Surface adapters (non-destructive) | `lib/player-data/adapters/*` — draft / waiver / roster / trade context / AI / matchup helpers |
| Fallback policy / merge | `lib/providers/providerFallbackPolicy.ts`, `lib/providers/providerMerge.ts` |

## Surfaces (this pass)

| Surface | `getPlayerDataForSurface.surface` | Data path |
|---------|-----------------------------------|-----------|
| Draft room / board / pool | `draft` | `getResolvedDraftPoolForLeague` (same as `GET /api/.../draft/pool`) |
| Waiver add list | `waivers` | `getPlayerPoolForLeague` + exclude rostered ids; optional `sports_players` merge by id |
| Roster / lineup | `roster` / `lineup` | Roster `playerData` ids → `SportsPlayerRecord` hydration |
| Trade / card / AI / matchup | `trade` / `player_card` / `matchup` / `ai_context` | By `playerIds` + league sport, or fall back to waiver-style pool when ids missing |

**Rule:** route handlers and jobs **do not** call Rolling Insights live; they read **Prisma** / materialized cache only.

## Source policy (reminder)

- **NFL rookie / experience:** Sleeper `years_exp` (and cache) when RI omits documented rookie fields — `lib/providers/nflRookieSourcePolicy.ts`.
- **NCAAF class / devy:** Rolling Insights `class` — `lib/draft-room/collegeClass.ts` — **not** Sleeper `years_exp`.
- **SOCCER:** `SPORT=SOCCER` and `league=EPL|LALIGA|SERIEA` for RI — `lib/providers/rollingInsightsSoccerLeague.ts`.

## APIs / routes (reference)

- Draft pool: `getResolvedDraftPoolForLeague` — `lib/draft-room/getResolvedDraftPoolForLeague.ts` — `app/api/leagues/[leagueId]/draft/pool/route.ts` (and related).
- Waiver free agents: `app/api/waiver-wire/leagues/[leagueId]/players/route.ts` — `getPlayerDataForSurface` + `serializeUnifiedPlayerForApi` (full `UnifiedPlayerWireDto` per row; legacy `id` / `name` / `position` / `team` preserved on each object).
- Roster (DB/native leagues): `app/api/league/roster/route.ts` includes `unifiedRoster: UnifiedPlayerWireDto[]` alongside `roster` JSON. Sleeper platform responses are unchanged.
- Trade evaluator: `app/api/trade-evaluator/route.ts` resolves trade assets to `sports_players` ids (`lib/trades/tradePlayerIdentityResolver.ts`), batches `getNormalizedPlayerData` with `surface: 'trade'`, and adds **provider evidence** to AI prompts plus a small `providerEvidence` summary on the JSON response. **Internal `valuationReport` / fairness math is unchanged**; provider rows are context only.

## Wired in this pass (client)

- **Draft room:** `mapNormalizedDraftEntryToPlayerEntry` builds each `PlayerEntry` with `unifiedProductView`; `DraftPlayerCard` / `SleeperPoolTable` prefer unified headshot/injury fallbacks. Pool API diagnostics are logged in dev and **not** stored in `draftPool` state.
- **Draft board & queue (display):** `lib/player-data/adapters/draftRoomDisplayFields.ts` centralizes name/team/headshot/injury/experience for UI. `DraftBoard` receives `poolPlayerById` and **merges** pool unified fields into pick tiles only (identity + session picks unchanged). `QueuePanel` uses the same pool lookup for avatars, **ADP vs AI ADP** chips, injury, and experience — queue **order** and **entries** are unchanged.
- **Waiver wire:** rows use `adaptWaiverWirePlayer` for display aliases + experience chip; `formatWaiverWireUnifiedForPrompt` delegates to `buildAiUnifiedPlayerBullets` for richer AI lines.
- **Roster board (native DB):** `useRosterManager` merges `unifiedRoster` into row display fields (`headshotUrl`, etc.); movement logic unchanged.

## Known gaps (next wiring)

- **Sleeper-backed** `/api/league/roster` responses do not include `unifiedRoster` until AF player ids are mapped consistently for those leagues.
- **Draft board pick tiles / queue** — further polish can thread `unifiedProductView` where those components render avatars by name only.
- **Start/sit / lineup optimizer** — `matchupPlayerAdapter` is ready; wire where engine exposes `UnifiedPlayerWireDto`.

## Audit scripts (read-only)

```bash
npm run data:audit-provider-coverage -- --sport NFL --limit 20
npm run data:audit-provider-gaps -- --sport NFL --domain stats --limit 20
npm run data:audit-player-surfaces -- --surface draft --sport NFL --limit 10
```

Set `AF_AUDIT_LEAGUE_ID` or pass `--leagueId` for surface audits that need a real league.

Environment: `npm run data:audit-player-surfaces` loads `.env` (see `package.json` script) for `DATABASE_URL`.
