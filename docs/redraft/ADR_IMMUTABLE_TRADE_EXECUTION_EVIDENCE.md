# ADR: Immutable Trade Execution Evidence

## Decision

Completed trades require a create-once execution snapshot stored in the same transaction as asset movement, final state, audit evidence, and the canonical executed event/outbox row. Mutable roster tables are not sufficient reversal evidence.

The additive `TradeExecutionSnapshot` model supports native and generic trade identifiers without depending on renewal persistence. Unique trade, native trade, generic trade, execution-key, and event identifiers prevent duplicate evidence.

## Preserved state

Native execution captures before and after:

- Roster IDs and FAAB balances
- Active roster-player record IDs, player IDs, ownership, slots, acquisition source/time, and lock state
- Active IDP salary record IDs, player IDs, ownership, salary, and status
- Proposal status
- Governance mode, settings version, scoring version, deadline week, and review window
- Deadline, lock, acquisition, roster-legality, and asset-limit validation results
- Player, FAAB, IDP salary, and draft-reference asset summaries
- Actor, execution timestamp, completeness, event ID, and stable execution key

Draft references remain unsupported for settlement and do not become ownership inventory merely because the snapshot can describe them.

## Transaction boundary

Native settlement now atomically performs the pending-state claim, player movement, FAAB movement, IDP salary ownership, cap ledger rows, executed event/outbox persistence, execution snapshot, trade decision evidence, audit row, and final state. An outbox or snapshot failure rolls back the business writes.

Compatibility accepted/processed events remain post-commit. They are not the authoritative executed outcome.

## Event and consumer boundary

`transaction.trade.executed` is the factual canonical outcome. Its payload contains snapshot ID, franchises, normalized asset summary, governance versions, completeness, and source. Knowledge graph and Universal OS consumers should process the outbox event idempotently by event ID. Consumer delivery is not implemented or verified in this slice.

## Reversal readiness

The read-only readiness service compares current state with the snapshot's after-state. It blocks missing or partial evidence, cross-season reversal, moved/dropped players, changed FAAB balances, changed IDP salary ownership, and finalized scoring/playoff dependencies. It never mutates state.

Atomic reversal is source-implemented for supported native player/FAAB state and generic roster JSON/FAAB state. It uses a serializable transaction, exact before-state restoration, unique trade/snapshot/event/notice/idempotency identities, canonical reversed event/outbox, audit, and one member notice. Requests are idempotent by stored reversal key. Draft assets and trades containing IDP salary transfers are blocked because the current snapshot does not contain sufficient authoritative ownership/ledger evidence for exact restoration. Physical use remains disabled until the migration and database transaction behavior are validated.

## IDP projections

The cap ledger and salary ownership remain authoritative. Derived projections are not part of the execution snapshot and still need an idempotent refresh request after commit. Projection delivery remains open work.

## Parity and validation

Native and generic execution are source-ready and create equivalent snapshot/event/audit artifacts through engine-specific adapters. Generic roster state remains JSON-shaped while native state is normalized, but both preserve before/after ownership and balances under the same canonical event contract. The migration is additive and ordered before the blocked renewal migrations, but it has not been applied to a disposable database. No physical migration, concurrency, consumer, browser, staging, or production claim is made.

Static certification found and corrected a polymorphic-integrity defect: `TradeReversal.tradeId` cannot reference only `redraft_trade_proposals`, because generic reversals identify `af_league_trades`. Snapshot identity remains the authoritative relational link and `tradeId` remains uniquely indexed. Generic readiness now compares rosters by ID instead of relying on database row order. These corrections are schema/source verified only; they do not replace disposable-database proof.

## Increment: evidence-quality corrections and IDP projection consistency

A fresh audit of the settlement paths (native `app/api/redraft/trade-votes/route.ts`, the separate `lib/trade-runtime/resolveNflRedraftTradeRuntime.ts` runtime, and the generic `lib/league-trade-engine/tradeService.ts`) confirmed the snapshot/event/reversal machinery above is real and source-correct, but found the `validations` field this ADR already claimed was captured was in fact a hardcoded `{deadline:'passed', locks:'passed', ...}` placeholder — a flat flag, not evidence. Fixed in the native path with a new `TradeValidationEvidence` type (`lib/redraft/tradeExecutionEvidence.ts`) recording each specific check (which player's lock, which franchise's roster legality, evaluated-at timestamp) as it is re-verified at settlement time, replacing the placeholder. The generic path's snapshot was corrected to honestly report `locks`/`acquisitions`/`rosterLegality` as unevaluated (`[]`) and `assetLimits` as `skipped`, since — a separate, real, disclosed finding — `finalizeAfLeagueTradeProcessing` does not actually re-check locks, recently-added restrictions, or projected roster legality before settling, unlike the native path. This is a genuine governance gap in the legacy/generic engine, left unfixed this increment (adding new validation logic to that path is a functional change, not an evidence-recording one, and is out of this increment's scope).

Also fixed: `executedByActorRole` on the native snapshot was hardcoded to `'user'` even when a commissioner executed the trade via `commissioner_approve`; it now derives from the already-threaded `terminalEventType` parameter. `dependencies.sourceTransactionIds` was always empty; `applyRedraftTradeCapTransfersInTransaction` (`lib/idp/capEngine.ts`) now returns the created `IDPCapTransaction` row IDs so the snapshot can link its cap-ledger dependencies (return type changed from `Promise<number>` to `Promise<RedraftTradeCapTransferResult>`; the one production caller and two test-file mocks were updated).

**IDP cap projection consistency (closes the "Projection delivery remains open work" gap above)**: `refreshCapProjections` (the `IDPCapProjection` derived-view recompute, keyed by `leagueId_rosterId_projectionYear`, already idempotent via upsert) was never called by the native trade-votes settlement path at all — confirmed by direct comparison with the non-transactional `applyRedraftTradeCapTransfers` used elsewhere, which does call it post-commit. Every trade executed through `trade-votes` left `IDPCapProjection` rows stale. Fixed with a post-commit, best-effort refresh call plus a new durable signal, `EVENT.IDP_CAP_PROJECTION_REFRESH_REQUESTED` (`idp.cap_projection_refresh_requested`), added to the event catalog and emitted alongside it — the ledger (`IDPCapTransaction`) stays authoritative and transactional; the projection refresh is retry-safe and failure-isolated (a failed refresh logs and leaves the projection stale rather than corrupting the ledger or failing the trade).

**Knowledge graph signal wiring**: the five pre-existing failing tests in `__tests__/trade-service-knowledge-graph-signal-wiring.test.ts` expected `lib/shared-services/knowledge-graph/TradeSignalHook.ts::recordTradeOutcomeSignal` to be called directly from `lib/league-trade-engine/tradeService.ts` at its five real accept/reject/cancel/veto transition points — mirroring the already-shipped Waiver OS equivalent (`WaiverSignalHook`, wired into `process-engine.ts`) and the pre-existing Trade Learning capture convention (`captureLiveTradeOffer`/`captureLiveTradeOutcome`) already present at those exact call sites. This is a direct-hook pattern, not yet the outbox-consumer boundary described earlier in this ADR — evaluated against the repository's actual architecture, no outbox-based Knowledge Graph consumer exists yet for ANY domain (waiver included), so treating the direct-hook expectation as "stale" would have meant inventing a consumer this increment did not build. The five tests' expectation was judged correct-but-missing, not stale, and closed by wiring the hook in at the same five points `captureLiveTradeOutcome` already uses. The outbox-consumer boundary remains the intended target architecture and is unbuilt; this increment closes the gap between the code and its own tests without pretending the larger architectural migration happened.

Two adjacent test files (`__tests__/league-trade-engine-live-capture-wiring.test.ts` and the KG signal wiring test above) had a pre-existing, unrelated mock gap — their `$transaction` mock's `tx` object did not include `roster`/`iDPSalaryRecord`/`redraftSeason`/`tradeExecutionSnapshot`/`leagueAuditLog`, which the already-shipped snapshot capture code in `finalizeAfLeagueTradeProcessing` (lines ~349-379, present before this increment) requires. Confirmed via read-only `git diff`/`git log` that this gap predates this increment. Fixed by completing the mock `tx` object; no production behavior changed by this fix.

All fixes verified via real re-run: 99/99 tests pass across the ten redraft trade-governance test files, plus 22/22 across the six trade-service-adjacent files touched, plus `npx prisma validate` (schema valid), targeted ESLint (clean), and `git diff --check` (clean, read-only throughout — no `git stash`/`reset`/`checkout` used at any point).
