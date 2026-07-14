# Trade Identity Mechanism Audit (Phase 17)

**Status: audit only (Phase 17). No canonical resolver integration performed then. Confirms and extends Phase 14's findings with routes traced then.**

**Phase 19 update:** real validation confirmed `PlayerIdentityMap` is 100% NFL (0 rows for any other sport) via a direct query — the canonical resolver's real, quantified sport coverage. A real, narrow fallback was added in `TradeValueConsoleShadowService.ts` (not the canonical resolver itself) to query `SportsPlayer` by name for non-NFL sports — `SportsPlayer` was confirmed to have real, substantial multi-sport data (MLB 7,295 / NBA 1,756 / NCAAB 18,209 / NCAAF 44,897 / NFL 17,257 / NHL 4,115 / Soccer 2,310 rows) that the canonical resolver's own name-match step never reached before this fix. See [`FANTASY_OS_TRADE_EXPANDED_REAL_VALIDATION.md`](FANTASY_OS_TRADE_EXPANDED_REAL_VALIDATION.md).

## Does Trade still have fragmented identity logic like Waiver had before Phase 14?

**Yes — and more fundamentally, because the primary live route's *input itself* is unstructured text, not a provider id.** This is a structurally different, and in some ways harder, problem than Waiver's (Waiver received real Sleeper roster ids that simply weren't resolved against the right table; Trade's primary route never receives a provider id for most assets at all).

## Every identity mechanism found (this phase + Phase 14, consolidated)

| Mechanism | File | Used by | Resolution method |
|---|---|---|---|
| `findPlayerByName` / `findPlayerBySleeperId` | `lib/fantasycalc.ts` | `hybrid-valuation.ts`'s `priceAssets()`, used by `assembleTradeDecisionContext` — **the live `/dynasty-trade-analyzer` path** | Name-match against FantasyCalc's own dataset only. `findPlayerBySleeperId` exists but is not called from this path — the input is free text, no Sleeper id is ever available here. |
| Structured `assetSchema` with optional `playerId` | `app/api/trade-value/analyze/route.ts` | `runTradeConsoleAnalysis` (`lib/trade-value-console/`) — **the live `/trade-value/analyze` path** | Not deep-audited this phase (out of scope) — the only live route with a real provider-id-shaped input field at all. |
| Draft-pick ownership (not player identity, but the analogous concept for this route) | `lib/live-draft-engine/PickOwnershipResolver.ts`, `resolveOverallForRoundSlot` | `/trade-builder/analyze` | Structural (round/slot → roster id via `slotOrder`/`tradedPicks`), not name/id matching — this route trades picks, not players, so "player identity" doesn't directly apply. |
| `convertSleeperToAssets.ts`'s name-keyed lookup | `lib/trade-engine/convertSleeperToAssets.ts` | Unclear live caller — not traced to a confirmed live route this phase (flagged, not resolved) | `fantasyCalcValues[player.name]` — raw name-string key, no id at all. |
| `sideARosterId`/`sideBRosterId` (provider `source_team_id`) | `lib/shared-services/trade/TradeShadowService.ts` (Phase 5, shadow-only) | No live caller — shadow-only, never called by any route | Requires `Roster.playerData.source_team_id`, a THIRD distinct roster-identifier concept alongside `Roster.id` and `Roster.platformUserId` (see Phase 17 audit doc). |
| `lib/player-identity/playerIdentityResolution.ts` (strict/loose key builders) | Draft domain (`getResolvedDraftPoolForLeague.ts`, confirmed live in Phase 14's audit) | Draft only, not Trade | Not used anywhere in the Trade call graphs traced this phase. |
| `PlayerIdentityResolver` (Phase 14, canonical) | `lib/shared-services/player-identity/` | **Not called anywhere in Trade** — only `WaiverContextAssembler.ts` uses it | N/A |

## Real, disclosed finding: Trade has no equivalent of Waiver's "raw provider id that just needs the right table" problem

Waiver's Phase 13 bug was: real Sleeper roster ids existed but weren't resolved against `PlayerIdentityMap`/`SportsPlayer`. Trade's primary live route (`/dynasty-trade-analyzer`) never receives a provider id in the first place for most inputs — the user types free text ("Justin Jefferson, 2025 1st"), and `extractPlayerNames`/`priceAssets`/`findPlayerByName` must resolve that text to a real player by NAME ALONE, with no id-based cross-check possible. **The Phase 14 canonical `PlayerIdentityResolver` cannot be applied here as-is** — its entire design (steps 1-3: direct id lookup against `PlayerIdentityMap`/`SportsPlayer`) assumes a provider id is available. Step 4 (name/team/position fallback) is the *only* step that could apply, and even then, `/dynasty-trade-analyzer`'s free text carries no team/position hint to disambiguate with — a real, harder disambiguation problem than anything Waiver faced.

`/trade-value/analyze`'s structured `playerId` field is the one real, promising exception — a future integration could route it through the canonical resolver directly, since it's shaped correctly (a real provider id, when present).

## Duplication found, not replaced (per this phase's explicit instruction)

At least 3 independent player-valuation/name-resolution code paths exist across the Trade surface (`hybrid-valuation.ts`'s `priceAssets`, `convertSleeperToAssets.ts`'s name-keyed lookup, and whatever backs `trade-value-console`'s `runTradeConsoleAnalysis`, not traced this phase). None were touched. This mirrors, and is somewhat worse than, the fragmentation Phase 14 found in Waiver before consolidation — documented here as a real finding for a future phase's explicit scope, not fixed now.

## Recommendation (design guidance only, not built this phase)

Any future Trade shadow-comparison seam should NOT assume the Waiver pattern of "resolve a client-supplied provider id" applies uniformly. Two real, different sub-problems exist:
1. For `/trade-value/analyze`'s structured `playerId` field: directly reusable by the Phase 14 `PlayerIdentityResolver`, no new resolver logic needed.
2. For `/dynasty-trade-analyzer`'s free-text names: would need a genuinely new fuzzy-name-resolution capability (or acceptance that this route's inputs cannot be canonically resolved with confidence, and any shadow comparison against it must expect a real, structural `unresolved`/`name_match_ambiguous` rate far higher than Waiver's 100%).
