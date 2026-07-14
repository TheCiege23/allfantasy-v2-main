# G17 Core Trade Engine Hardening Audit

Readiness hold:

- NFL Engine: 93%
- Overall Platform: 90%

## 1. Current Architecture Map

The repo currently has three separate trade domains:

1. `lib/league-trade-engine/*` is the closest Core Trade Engine candidate. It uses platform `League` and `Roster` rows, stores trades in `AfLeagueTrade`, stores items in `AfLeagueTradeItem`, supports status history, votes, processing events, FAAB movement, roster-player movement, and JSON-backed pick/specialty assets.
2. Redraft still has a legacy proposal/settlement path through `app/api/redraft/trade-proposals/route.ts`, `app/api/redraft/trade-votes/route.ts`, `app/api/redraft/trades/veto/route.ts`, and `lib/redraft/tradeSettlement.ts`. It stores `RedraftTradeProposal` and `RedraftTradeAsset` rows, then settles `player` and `faab` assets against `RedraftRosterPlayer` / `RedraftRoster`.
3. Live draft pick trading is a draft-room subsystem, not the in-season trade engine. `app/api/leagues/[leagueId]/draft/trade-proposals/*` creates/responds to `DraftPickTradeProposal` rows and accepted proposals append overlay records to `DraftSession.tradedPicks` via `lib/live-draft-engine/DraftPickTradeService.ts`.

The older `lib/trade-engine/*` namespace is mainly trade analysis/recommendation logic. It enforces candidate-building constraints like `maxAssetsPerSide`, but it does not own transactional trade mutation.

## 2. Route Map

| Surface | Routes | Current role |
| --- | --- | --- |
| Core league trades | `app/api/leagues/[leagueId]/trades/*` | Create, list, accept, reject, cancel, vote, commissioner decision, counter, process `AfLeagueTrade` records. |
| Redraft trade center | `app/api/redraft/trade-proposals/route.ts`, `app/api/redraft/trade-votes/route.ts`, `app/api/redraft/trades/*` | Legacy Redraft proposal, vote/veto, commissioner review, settlement, market/AI events. |
| Redraft settings | `app/api/redraft/trade-settings/route.ts` | Read-only UI settings and FAAB balances. Does not enforce proposal legality. |
| Live draft picks | `app/api/leagues/[leagueId]/draft/trade-proposals/*`, `trade-builder/*` | Draft-room pick swap proposals, pick-owner resolution, AI review, UI inventory. |
| AI / Decision OS | `app/api/ai/trade-*`, `app/api/app/leagues/[leagueId]/trades/analyze-ai/route.ts`, `app/api/leagues/[leagueId]/trade/ai-decision/route.ts` | Read/evaluate/analyze trades. Should remain read-only unless explicitly wired to proposal creation. |
| Format-specific checks | `app/api/leagues/[leagueId]/zombie/can-trade/route.ts`, tournament safety helpers | Plugin-style eligibility gates that should become extension hooks. |

## 3. Settings Enforcement Table

| Setting / behavior | Core `AfLeagueTrade` status | Redraft legacy status | Draft-room pick-trade status | Severity | Recommended fix |
| --- | --- | --- | --- | --- | --- |
| Trades allowed / league locks | Enforced through `resolveLeagueTradeSettings`, `assertLifecycleActionAllowed`, and `assertRosterTransactionsAllowed`. | Partially enforced; proposal route is not consistently wired through shared resolver/gates. | Enforced through draft access/session status and tournament/draft UI gates. | High | Route Redraft proposals through a shared trade legality adapter before creation. |
| Trade deadline | Partially enforced by `validateTradeAssets`, but only when a caller passes trusted `currentWeek`. | Mostly UI/advisory; Trade Center blocks visually, proposal route does not enforce with shared helper. | Not applicable to live draft pick swaps. | High | Resolve current week server-side and make deadline validation route-independent. |
| Review/veto mode | Enforced in core accept flow: `instant`, `commissioner`, `league_vote`. | Partially enforced; proposal creation accepts body `vetoMode` instead of resolving league settings. | Receiver accept/reject only; no commissioner/veto queue. | High | Store review mode from resolver only; keep request body from selecting governance. |
| Review hours | Resolved in core settings, but `createAfLeagueTrade` uses `expiresInHours` request/default for offer expiration. It is not a review-window processor. | UI surfaces it and Redraft proposal expiration uses body/default rather than canonical resolver. | Not applicable. | Medium | Split "offer expiration" from "review window" and enforce review windows in processing/vote jobs. |
| Commissioner approval | Core service requires elevated commissioner for `commissionerAfTradeDecision`; G17 added route-level elevated-commissioner gate to public process route. | Dedicated veto/review routes check commissioner/co-commissioner. | Not integrated. | Fixed / Medium residual | Keep process/finalize endpoints commissioner-only unless called internally by accept flow. |
| League vote threshold | Core stores percent and vetoes when veto count reaches roster-count threshold. It does not require review-window elapsed for allow votes. | Uses Redraft-specific vote route and proposal fields. | Not applicable. | Medium | Add deterministic vote-window and threshold service before processing votes. |
| Draft pick trading | Core blocks `rookie_pick` / `future_pick` when disabled. `devy_pick` uses devy flag. | Proposal route allows `draft_pick` assets as reference-only and does not block when disabled. | Enforced by `isDraftPickTradingAllowedForLeague` and `getDraftUISettingsForLeague().pickTradeEnabled`. | High | Distinguish reference-only draft assets from owned picks; block disabled pick assets in Redraft proposal route. |
| Pick ownership / double-trade | Core validates pick ownership against sender `Roster.playerData` at validation and execution. No global season bounds or double-trade table exists. | Redraft picks are reference-only and not settled. | Current owner resolved from `DraftSession.tradedPicks`; picked slots are blocked; latest accepted overlay wins. | Medium | Introduce a canonical pick inventory for in-season future picks before Dynasty/Keeper cutover. |
| FAAB trades | Core validates positive FAAB and sufficient balance; processor applies deltas atomically. | Settlement validates positive/sufficient FAAB at execution; proposal creation is thinner. | Not applicable. | Medium | Use shared FAAB asset validator in proposal route and settlement. |
| Max assets | Not enforced by transactional core. Enforced only in analysis engine constraints. | Not enforced. | Pick swap is effectively one-for-one pick pair. | Medium | Add optional `maxAssetsPerSide` to resolver/settings and validate in `validateTradeAssets`. |
| Roster legality | Core validates roster size deltas only; it does not run full roster slot/IR/taxi/IDP legality. | Settlement moves players and FAAB but relies on limited checks. | Not applicable to players. | High | Inject the Core Roster Engine legality validator into trade validation/processing. |
| Lineup/game locks | Core uses lifecycle and roster transaction gates; no per-player lock validation was found in asset validation. | Not clearly enforced in proposal route. | Picked picks are blocked in draft-room route. | High | Add player lock/game-window checks at proposal and execution time. |
| Atomic execution | Core roster/FAAB/pick movement and status update are inside a Prisma transaction, but status history/processing event/audit helpers use global Prisma inside that transaction block. | Redraft settlement is designed to run in a Prisma transaction. | Draft pick accept appends records, then updates proposal; not one combined transaction. | Medium | Pass transaction client into audit/status helpers and wrap draft-pick accept update + append together. |
| Cancellation | Core pending/scheduled cancel with proposer/elevated commissioner gate. | Redraft routes exist, but legacy coverage is thinner. | Proposer-only pending delete. | Low | Standardize cancellation event/audit vocabulary. |
| Duplicate execution | Core rejects `processed` trades and rechecks possession/FAAB during processing. | Redraft settlement should be status-gated by vote route. | Draft-room accepted proposals reject non-pending. | Medium | Add regression coverage for process idempotency and route permissions. |
| Multi-team trades | Not supported by transactional core; validator expects exactly two rosters. | Not supported. | Not supported. | Future | Keep two-team core first; expose plugin extension point later. |
| AI review flags | Decision OS / AI layers are read-only or advisory. They do not mutate trade state. | Redraft proposal route writes snapshots and shadow/live Decision OS metadata. | Draft pick proposals can trigger AI review/DM. | Low | Preserve read-only boundary; route accepted AI flags into review metadata only. |

## 4. Trade Lifecycle Map

Core lifecycle:

`POST /trades`
-> `createAfLeagueTrade`
-> `validateTradeAssets`
-> `AfLeagueTrade.status = pending`
-> receiver `accept`
-> `instant` finalizes, `commissioner` moves to `awaiting_commissioner`, `league_vote` moves to `awaiting_votes`
-> commissioner/vote/process path
-> `applyTradeAssetsInTransaction`
-> `processed`
-> audit/status/event rows

Redraft lifecycle:

`POST /api/redraft/trade-proposals`
-> create `RedraftTradeProposal` / `RedraftTradeAsset`
-> value snapshot + market event + Decision OS shadow/live metadata
-> `trade-votes` / commissioner veto/review
-> `settleRedraftTradeAssets`
-> proposal status updated

Live draft pick lifecycle:

proposal create
-> pending `DraftPickTradeProposal`
-> receiver accept/reject/counter
-> accept appends two `TradedPickRecord` overlays to `DraftSession.tradedPicks`
-> `PickOwnershipResolver.resolvePickOwner` uses latest overlay for future draft board ownership.

## 5. Asset Model Map

Core `TRADE_ITEM_TYPES`:

- `player`: moves IDs inside `Roster.playerData.players`.
- `faab`: transfers `Roster.faabRemaining`.
- `rookie_pick`, `future_pick`, `devy_pick`: transfer pick-like records inside roster JSON arrays.
- `specialty_asset`: moves JSON specialty assets with minimal ownership validation.

Redraft `RedraftTradeAsset`:

- `player`: settled by updating `RedraftRosterPlayer.rosterId`.
- `faab`: settled by changing `RedraftRoster.faabBalance`.
- `draft_pick`, `future_consideration`: recorded only; no owned Redraft pick inventory exists.

Draft-room picks:

- `DraftPickTradeProposal` stores round/slot/original roster IDs.
- Accepted proposals append `TradedPickRecord` overlays to `DraftSession.tradedPicks`.
- This is current-draft board ownership, not in-season Dynasty future-pick ownership.

## 6. Draft Pick Trading Map

The draft-room path is the most deterministic pick-trading path today:

- Proposal creation checks tournament safety and draft UI `pickTradeEnabled`.
- Proposal creation confirms the offered pick is currently owned by proposer and the requested pick is currently owned by receiver.
- Proposal creation blocks picks whose overall pick has already been made.
- Acceptance rechecks pick-trading settings before appending overlays.

The in-season core path supports pick-like assets but does not yet have a canonical season pick inventory, future-year bounds, double-traded pick ledger, or draft-board integration. The Redraft path explicitly treats picks as reference-only, which is honest but must not be inherited by Dynasty/Keeper/Devy/C2C.

## 7. Commissioner Control Map

Working:

- Core commissioner approval path uses `isElevatedCommissioner`.
- Core cancel path permits proposer or elevated commissioner.
- Core vote path prevents trading parties from voting.
- Redraft veto route requires commissioner/co-commissioner.
- Draft-room pick proposal response is receiver-owned, with settings gates.

G17 bounded hardening:

- `app/api/leagues/[leagueId]/trades/[tradeId]/process/route.ts` now requires elevated commissioner access before calling `finalizeAfLeagueTradeProcessing`. This closes a public member-only process route that could otherwise reach privileged trade statuses.

Remaining gaps:

- Core reject path uses `league.userId` for commissioner-style rejection, while other routes use elevated commissioner. Co-commissioner parity should be standardized.
- League vote processing lacks a deterministic "review window elapsed" gate.
- Redraft proposal creation can still choose governance from request body instead of saved commissioner settings.

## 8. AI / Decision OS Hook Map

Decision OS trade modules are correctly positioned as read-only evaluators:

- `lib/decision-os/trade/*` loads worlds, checks rules, builds memos, emits shadow parity, and does not execute trades.
- `lib/decision-os/trade/rules.ts` has deadline and injected legality categories that can later consume the Core Trade Engine validator.
- Redraft proposal creation currently captures snapshots and may append Decision OS metadata.
- AI analysis routes and trade discovery routes should remain advisory/plugin consumers, not transaction owners.

The Core Trade Engine should expose read-only hook payloads for AI review and collusion/tanking detection, then require explicit commissioner/user action for mutation.

## 9. Severity-Ranked Gap Table

| Severity | File / area | Issue | Future impact |
| --- | --- | --- | --- |
| Critical fixed | `app/api/leagues/[leagueId]/trades/[tradeId]/process/route.ts` | Public process route was member-gated while service can finalize privileged statuses. | Member could bypass commissioner/vote workflow on core trade records. Fixed by requiring elevated commissioner at the API edge. |
| High | `app/api/redraft/trade-proposals/route.ts` | Redraft proposal route bypasses `resolveLeagueTradeSettings`, `isPastTradeDeadline`, pick-trading disabled checks, and max-asset rules. | Future formats inheriting this path would get cosmetic settings instead of enforced settings. |
| High | `lib/league-trade-engine/tradeValidationService.ts` | Roster legality is limited to player count; no full Core Roster Engine legality, IR/taxi/IDP, or slot validation. | Dynasty/IDP/Keeper trades can produce illegal post-trade rosters. |
| High | Trade deadline inputs | Core deadline validation depends on caller-supplied `currentWeek`; Redraft route lacks server-side enforcement. | Deadlines can be bypassed when routes omit or trust client week. |
| High | Player lock/game lock checks | No clear per-player game/lineup-lock validation in core asset validation. | Trades could move locked players unless blocked elsewhere. |
| Medium | `lib/league-trade-engine/tradeService.ts` / audit helpers | Transaction block updates trade and rosters, but status/audit helpers use global Prisma. | Audit/history may drift from transactional mutation on partial failures. |
| Medium | `lib/league-trade-engine/tradeSettingsResolver.ts` | `faabTradingAllowed` falls back through `draftPickTrading`; devy/C2C flags default true in a way that needs plugin clarity. | Plugin settings can be misread as generic league defaults. |
| Medium | `lib/league-trade-engine/tradeValidationService.ts` | `future_pick` C2C comment does not enforce a C2C gate; specialty assets have minimal ownership checks. | Plugin-specific assets may be accepted before the plugin owns validation. |
| Medium | Core vote processing | Veto threshold exists, but no deterministic allow-quorum/review-window elapsed processor was found. | League-vote mode can be processed inconsistently. |
| Medium | Live draft pick accept route | Accepted pick overlay append and proposal status update are separate writes. | Rare partial state if append succeeds and status update fails. |
| Medium | In-season pick model | Core pick-like assets are JSON roster records, not a canonical pick ledger. | Dynasty/Keeper future picks need season bounds, double-trade prevention, and draft-board consumption. |
| Low | Redraft settings route | Read-only settings are surfaced accurately, but naming can imply enforcement. | Commissioner trust issue if UI says setting exists but route does not enforce it. |
| Future | Multi-team trades | Transactional core and deterministic evaluator are two-team oriented. | Tournament/complex formats need later plugin extension, not hidden partial support. |

## 10. Minimal-Risk Migration Plan

1. Keep `lib/league-trade-engine` as the transactional core candidate and make Redraft an adapter, not the owner.
2. Add server-side current-week resolution to core trade creation so `isPastTradeDeadline` never depends on request body.
3. Introduce a shared `validateTradeProposalRequest` adapter that Redraft proposal creation must call before writing `RedraftTradeProposal`.
4. Move `tradeReviewMode`, `tradeReviewHours`, `tradeDeadlineWeek`, `draftPickTrading`, and future `maxAssetsPerSide` into a single resolver output used by every trade route.
5. Inject Core Roster Engine legality into proposal validation and execution revalidation.
6. Add plugin asset validators for `devy_pick`, C2C future picks, salary cap contracts, specialty assets, and format-specific trade bans.
7. Create a canonical pick inventory before Dynasty/Keeper pick trading cutover. Do not reuse Redraft reference-only picks for future formats.
8. Pass Prisma transaction clients into audit/status/event helpers so audit rows commit with the trade mutation.
9. Wrap draft-pick proposal accept overlay append and proposal status update in one transaction.
10. After Redraft is adapter-backed, deprecate direct Redraft settlement logic behind compatibility tests.

## 11. Tests Run And Results

Focused G17 verification passed:

```text
npx vitest run __tests__/league-trade-engine-validation.test.ts __tests__/league-trade-process-route-auth.test.ts __tests__/redraft/trade-settlement.test.ts __tests__/redraft/trade-veto-route.test.ts __tests__/redraft-trade-playoff-routes-contract.test.ts __tests__/trade-review/commissioner-review.test.ts __tests__/live-draft-engine/draft-pick-trades.transaction.test.ts __tests__/decision-os/trade-rules.test.ts __tests__/decision-os/trade-architecture.test.ts __tests__/decision-os/trade-decision.test.ts __tests__/decision-os/trade-shadow.test.ts __tests__/decision-os/trade-canonical-shadow.test.ts __tests__/decision-os/trade-memo.test.ts __tests__/decision-os/trade-enrichment.test.ts __tests__/trade-discovery/trade-discovery.test.ts __tests__/trade-market/trade-market-events.test.ts __tests__/trade-market/market-aggregates.test.ts __tests__/trade-market/adaptive-value-preview.test.ts __tests__/trade-market/allfantasy-market-values.test.ts __tests__/trade-league-analyze-hardening.test.ts __tests__/trade-evaluator-route-contract.test.ts __tests__/trade-analyzer-ai-service.test.ts __tests__/trade-analyzer-ai-route-contract.test.ts __tests__/trade-analyzer-intel.test.ts __tests__/trades/normalized-trade-context.test.ts __tests__/trades/provider-fallback-trade-context.test.ts __tests__/trades/trade-player-identity-resolver.test.ts __tests__/api/trade-evaluator-normalized-context.test.ts
```

Result: 28 test files passed, 251 tests passed.

Additional targeted checks:

```text
npx vitest run __tests__/league-trade-process-route-auth.test.ts __tests__/league-trade-engine-validation.test.ts
```

Result: 2 test files passed, 4 tests passed.

```text
npx vitest run __tests__/redraft-trade-playoff-routes-contract.test.ts
```

Result after stale mock cleanup: 1 test file passed, 6 tests passed.

G17B legacy analyzer blocker resolved:

```text
npx vitest run __tests__/trade-league-analyze-api.test.ts
```

Result: 1 test file passed, 17 tests passed.

Fix summary:

- `server/api-route-modules/legacy/trade/league-analyze/route.ts` now restores bounded legacy-route guardrails: `requireAuthOrOrigin`, `consumeRateLimit`, and explicit invalid-JSON `400` handling before any provider, AI, cache, or valuation work.
- `__tests__/trade-league-analyze-api.test.ts` now mocks the route's current dependencies: trade feedback/preferences/history Prisma reads, comprehensive learning context, AI result cache, confidence-risk async helpers, deterministic trade engine output shape, and LeagueDecisionContext conversion.
- Stale expectations were aligned to the current route contract: upstream Sleeper league fetch failure returns `502`, missing league user returns `User not found in league: ...`, and successful responses expose `tradeSuggestions`.

Broader trade signal passed using an explicit Windows-safe file list equivalent to `__tests__/*trade* __tests__/redraft/*trade*`:

```text
$files = rg --files __tests__ | Where-Object { (($_ -like '*trade*') -or ($_ -like '__tests__/redraft/*trade*')) -and ($_ -match '\.test\.(ts|tsx)$') }; cmd /c npx vitest run $files
```

Result: 40 test files passed, 381 tests passed.

## 12. Readiness Assessment

Do not raise readiness from G17 alone.

The safe process-route fix makes the core trade route more trustworthy, and the audit clarifies the Core Trade Engine candidate. The engine is not yet materially reusable across Dynasty/Keeper/IDP/Devy/C2C because Redraft still has a separate proposal path, trade deadlines are not route-independent, roster legality is shallow, and future-pick ownership needs a canonical ledger.

Readiness remains:

- NFL Engine: 93%
- Overall Platform: 90%
