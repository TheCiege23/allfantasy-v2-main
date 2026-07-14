# Trade Context Assembler — Provider-Neutrality Fix (Phase 4)

Implements the Fantasy OS Migration Plan's single highest-leverage Trade OS blocker: `lib/trade-engine/league-context-assembler.ts` no longer hardcodes trade evaluation to Sleeper. Follows Phase 1 ([Identity Service](../shared-services/identity/README.md)), Phase 2 ([Sleeper import hardening](../league-import/sleeper/README.md)), and Phase 3 ([Knowledge Graph foundation](../shared-services/knowledge-graph/README.md)).

## What audit found before any code changed

`buildLeagueDecisionContext` imported five functions directly from `lib/sleeper-client.ts` (`getAllPlayers`, `getLeagueInfo`, `getLeagueRosters`, `getLeagueTransactions`, `getLeagueUsers`) and built its entire internal model from Sleeper's raw response shapes — a Sleeper roster's numeric `roster_id`, its own player-ID dictionary, raw `scoring_settings`/`roster_positions` fields. Two real, previously-unflagged findings surfaced during the audit:

1. **A genuine naming collision**: `lib/league-decision-context.ts` exports its *own*, entirely different `buildLeagueDecisionContext` function (different signature, different `LeagueDecisionContext` type) — a sixth trade-context-building implementation, not counted in the original five-competing-trade-systems audit. It's Sleeper-hardcoded too, but is a separate file this phase does not touch (its three real callers — `season-strategy`, `trade-evaluator`, `trade-finder` routes — all import from it, not from the file this phase fixes). Flagged for a future consolidation pass, not fixed here.
2. **A real cross-provider format gap**: ESPN, Yahoo, and MFL's adapters all emit `roster_positions` as `"SLOT:COUNT"` pairs (e.g. `"SUPER_FLEX:1"`), not Sleeper's flat one-token-per-slot list (e.g. `"SUPER_FLEX"`). The assembler's original superflex/bench/starter detection did exact string equality checks that would have silently failed against the other format — confirmed by reading each adapter's real source, not assumed.

## What is now provider-neutral

- **Fetching.** The assembler now calls `runImportedLeagueNormalizationPipeline` (the same real, resilient, Phase-2-hardened entry point every import route already uses) instead of raw `sleeper-client` calls. Works for any of the six registered providers (`sleeper`, `espn`, `yahoo`, `mfl`, `fantrax`, `fleaflicker`).
- **Roster/team data.** Built from `NormalizedRoster` (`source_team_id`, `source_manager_id`, `owner_name`, `wins`/`losses`/`ties`/`points_for`, `player_ids`/`starter_ids`/`reserve_ids`/`taxi_ids`) — the same shape every adapter already produces.
- **Player identity.** Built from `player_map` (name/position/team, keyed by the provider's own source player id) — populated by all six adapters, not just Sleeper's.
- **Trade history stats.** Built from `NormalizedTransaction[]` (`type === 'trade'`, `created_at`, `roster_ids`) instead of raw Sleeper transaction objects.
- **Roster position format.** New `rosterPositionFormat.ts` normalizes both Sleeper's flat-token list and ESPN/Yahoo/MFL's `"SLOT:COUNT"` pairs into one shape before superflex/bench/starter classification — verified to produce identical starter/bench counts for equivalent Sleeper- and ESPN-shaped rosters (see the test suite).
- **Team identity.** `LeagueTeamSnapshot.teamId` is now always the provider's true `source_team_id` (a real, stable identifier, e.g. Yahoo's compound `"423.l.116.t.4"` team key) — previously it was always derived from a Sleeper-style small integer `roster_id`. A separate, internal-only numeric `rosterId` is still synthesized (existing type contracts throughout `trade-decision-context.ts` require a number) via a stable index fallback when the real id isn't a clean integer — but nothing outside this file should ever reference that synthetic number for cross-system identity; `teamId` is the real one.
- **`leagueConfig.platform`** now reflects the actual resolved provider, not a hardcoded `'sleeper'` fallback assumption.

## What is still Sleeper-only

- **`taxiSlots`** (the league-configured taxi squad *size*, not which players are on it — that part, `taxi_ids`, is already provider-neutral). No provider's normalized `NormalizedLeagueSettings` carries this field yet. Preserved with full fidelity for Sleeper via the raw payload Phase 2B already threads through (`ImportedLeagueNormalizationResult.rawPayload`); every other provider gets an honest `0` plus a `dataQuality.warnings` entry — never a silent guess.
- **The manager-tendency pre-analysis cache** (`lib/trade-pre-analysis.ts`, via `getPreAnalysisStatus`) is entirely Sleeper-specific (keyed on `sleeperUsername`/`sleeperLeagueId` in its own tables) and is out of this phase's scope. It's now explicitly gated to `provider === 'sleeper'` — previously it would have been called with a non-Sleeper username too, which could only ever return nothing useful (or, worse, an incorrect match) for another provider.
- **`lib/league-decision-context.ts`'s own separate `buildLeagueDecisionContext`** — the naming-collision file described above. Still fully Sleeper-hardcoded, still used by three other routes. Not touched.

## What data gaps remain for ESPN / Yahoo / Fantrax / MFL

| Gap | Affected providers | Notes |
|---|---|---|
| `taxiSlots` (configured squad size) | ESPN, Yahoo, MFL, Fantrax, Fleaflicker | Defaults to 0 + a disclosed warning. Closing this requires adding the field to `NormalizedLeagueSettings` and each adapter — a schema/adapter change, out of this phase's scope. |
| `roster_positions` entirely absent | Fantrax | Fantrax's adapter (confirmed by reading it directly) does not construct a `roster_positions` field at all — consistent with its documented CSV-only, lower-fidelity import path from the pivot audit. Superflex/bench/starter detection will show all-zero/false for Fantrax leagues until this is added. |
| `player_map` frequently sparse or empty | Fantrax (CSV-dependent), potentially Fleaflicker | The assembler now degrades honestly (falls back to raw player ids as display names, adds a `dataQuality.warnings` entry) rather than crashing — but real player names/positions are genuinely unavailable until the adapter's own data fidelity improves. |
| Manager tendency data | Every non-Sleeper provider | `managerPreferences` will be `null` for every team on a non-Sleeper league today — there's no equivalent pre-analysis cache for other providers yet. Already reflected honestly via the existing `missingData.managerTendenciesUnavailable` flag, which every provider already populates correctly. |

## What future Trade OS consolidation will consume

Per the Migration Plan's Milestone 4, this fix was deliberately scoped to the assembler alone — **not** the five (now confirmed six, counting the `league-decision-context.ts` collision) competing trade-evaluation/grading systems this feeds into. Those systems can now be consolidated onto a genuinely provider-neutral context builder instead of one that only ever worked for Sleeper. Concretely, Trade OS consolidation should:
1. Point every consumer at *this* file's `buildLeagueDecisionContext`, not `lib/league-decision-context.ts`'s duplicate — or reconcile the two deliberately, not accidentally.
2. Read `LeagueTeamSnapshot.teamId` (the true provider identifier) for all cross-system references, never the synthetic `rosterId`.
3. Treat the documented ESPN/Yahoo/MFL/Fantrax gaps above as known, disclosed inputs to the mutual-benefit scoring model — not silently assume full data parity with Sleeper.
4. Reuse `rosterPositionFormat.ts` for any other place in the trade/waiver stack that still does Sleeper-only roster-position string matching (a quick grep for literal `'SUPER_FLEX'`/`'BN'` string equality checks elsewhere in `lib/trade-engine/` and `lib/waiver-*` would find them — not audited in this phase, since it was scoped to the assembler alone).
