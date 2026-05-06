# Trade evaluator (API)

## Scope

- **Route:** `POST /api/trade-evaluator` — implementation `app/api/trade-evaluator/route.ts`
- **Business logic:** Accept / reject / counter / veto and roster transactions are **out of scope** for this route; it **evaluates** a hypothetical trade and returns AI + deterministic summaries.
- **Trade value:** `valuationReport`, composite scores, and fairness math remain **AllFantasy internal**. Provider imports are **evidence for explanations** only.

## Request (unchanged contract)

- `sender` / `receiver`: `gives_players` as `string` (display name) or object with at least `name`, optional `position`, `team`, `age`, `value_notes`.
- **Optional ids on player objects** (non-breaking): `playerId`, `sportsPlayerId`, `sports_player_id`, `player_id`, `internalPlayerId`, `sleeperPlayerId`, `sleeper_id`, `externalSourceId`, `external_source_id`, `providerPlayerId`, `provider_player_id` — used to resolve `sports_players` rows when Sleeper name → key mapping is insufficient.
- `league_id`: Sleeper platform league id **or** internal `League.id` (for resolving AF league + normalized trade surface).
- `league`: sport, format, scoring, etc. (existing).

## Normalized provider context (new)

1. **`resolveTradeEvaluatorInternalLeagueId`** — maps `league_id` to Prisma `league.id` (direct UUID or user-owned Sleeper `platformLeagueId`).
2. **`resolveTradePlayerAssets`** — resolves each player asset to `SportsPlayerRecord.id` when possible (explicit ids, Sleeper id, or name → Sleeper pid map from `getPlayersBySport`).
3. **`buildNormalizedTradeContext`** — `getNormalizedPlayerData({ surface: 'trade', leagueId, playerIds })`, then `tradeEvidenceFromUnifiedWire` / prompt builder.

**Guardrails**

- **ADP** vs **AI ADP** stay separate in evidence (see `unifiedPlayerProductView` meta + `tradePlayerContextAdapter`).
- **No invented ADP** from non-ADP vendor fields (policy unchanged).
- **Missing data:** explicit `missingDomains` / `missingDataNote` on response summary and in prompt when applicable.
- **Sources** in evidence lines: `statsSrc`, `projSrc`, `injurySrc`, `adpSrc`, `aiAdpSrc`, `expSrc` where the unified row exposes them.

## Response additions

- **`providerEvidence`** (optional): `{ summary: { totalAssets, resolvedPlayers, unresolvedPlayers, fallbackSources[], missingDomains[] }, missingDataNote? }`
- Core fields (`success`, `evaluation`, `valuationReport`, `tradeInsights`, …) unchanged.

## Manual QA

1. Open trade evaluator with a league linked in AF (same user, Sleeper `league_id` or internal id).
2. Evaluate a trade with known NFL players (names only) and confirm narrative / quant paths still run.
3. When imports have injury/ADP/stats cache, confirm the AI narrative can reference provider lines (prompt includes evidence block).
4. Confirm **ADP** and **AI ADP** appear as distinct numbers in evidence text when both exist.
5. Remove or break player ids (unknown names, no map) and confirm evaluation still returns with **no** `providerEvidence` or with `missingDataNote` only — no hard failure.

## Related code

- `lib/trades/tradePlayerIdentityResolver.ts`
- `lib/trades/buildNormalizedTradeContext.ts`
- `lib/trades/resolveTradeEvaluatorInternalLeagueId.ts`
- `lib/player-data/adapters/tradePlayerContextAdapter.ts`
- `lib/player-data/getNormalizedPlayerData.ts`
