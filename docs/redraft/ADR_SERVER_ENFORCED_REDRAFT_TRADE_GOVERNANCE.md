# ADR: Server-Enforced Redraft Trade Governance

## Decision

Persisted league settings are the sole authority for redraft trade review mode, vote threshold, review window, deadline, asset limits, draft-asset permission, move locks, and roster legality. Public proposal routes reject governance fields rather than silently accepting them. Responses expose the effective governance source, versions, mode, threshold, review window, deadline week, and per-side asset limit.

The Trade Analyzer, Commissioner OS, and Decision OS remain advisory. Their output cannot create, approve, reject, veto, execute, or reverse a trade.

## Effective settings

`resolveLeagueTradeSettings` centralizes the current `League` columns and canonical settings snapshot. Missing optional values receive deterministic defaults. Existing persisted custom values continue to resolve even when entitlement state later changes; settings mutation paths remain responsible for preventing unauthorized additions.

Current modes map as follows:

- `instant` or `none` becomes immediate processing and `no_veto` for native compatibility.
- `commissioner` becomes commissioner review.
- `league_vote` remains league vote.

The native proposal threshold is derived from persisted percentage and eligible roster count. Maximum assets applies independently to each sending side and counts every asset row.

## Request compatibility

The generic league route and both native redraft proposal routes return HTTP 400 when client payloads contain governance fields. This is intentionally strict because silently ignoring a client-selected threshold or deadline makes debugging and security review ambiguous.

The retired legacy redraft mutation route remains HTTP 410. Discovery, package generation, and analysis routes are non-authoritative.

## Deadline and lock semantics

Proposal and acceptance use the persisted deadline and authoritative `RedraftSeason.currentWeek`. Client week and deadline values are not trusted. A trade must be accepted by the deadline. An accepted trade already in review may complete later; an unaccepted proposal cannot first execute after the deadline.

Player ownership and persisted lock state are checked at proposal and again immediately before native settlement. Each player is evaluated independently. This slice does not infer a schedule when lock data is missing; comprehensive provider-backed postponed, cancelled, and rescheduled game resolution remains open.

## Assets and roster legality

Supported native assets are active players, FAAB, and draft assets only when persisted settings allow them. Future consideration is rejected. The generic validator rejects future-season redraft picks and conditional metadata. Player ownership, duplicate assets, direction, FAAB balance, per-side maximum, roster size, and current lock state are server validated.

Full position-slot hypothetical validation, recently-added transaction history, canonical draft-slot ownership, active-draft pick transfer, and NCAAF player-pool enforcement remain incomplete. Existing roster transaction gates continue to provide the broader saved-rule legality boundary for the generic engine.

## Transaction and lifecycle

The generic engine transfers assets and changes terminal state in a transaction. Native settlement conditionally claims the pending proposal and transfers standard roster assets in one transaction, preventing two finalizers from settling the same proposal. Native IDP cap transfer remains outside that transaction and is known atomicity debt.

Reversal is not implemented in this slice. No claim is made for physical concurrency, rollback of every asset category, or transaction-coupled member notices.

## Events and notices

Existing lifecycle events, market ledger events, audit rows, learning capture, and deduplicated post-commit fanout remain connected. Consumer execution was not verified. Advisory analysis remains separate from mutation authority.

## NCAAF limitations

The native proposal path applies the same persisted governance to NFL and NCAAF. It does not silently substitute NFL schedule assumptions. Provider-backed school transfers, FBS/FCS eligibility, conference/school filters, bowl opt-outs, defensive completeness, and irregular schedule locks require further evidence before provider certification.

## Caller audit summary

- `lib/league-trade-engine/tradeService.ts` is the generic mutation service for proposal, acceptance, commissioner review, voting, processing, rejection, and cancellation.
- `app/api/leagues/[leagueId]/trades/**` delegates generic mutations to that service.
- `lib/trade-runtime/resolveNflRedraftTradeRuntime.ts` is the NFL native runtime and now derives proposal governance from persisted league settings.
- `app/api/redraft/trade-runtime/route.ts` rejects client veto settings before delegation.
- `app/api/redraft/trade-proposals/route.ts` is the shared native proposal path and now resolves persisted governance for NFL and NCAAF.
- `app/api/redraft/trade-votes/route.ts` performs native acceptance/voting/settlement and now rechecks deadline, settings, ownership, locks, asset class, and limits before settlement.
- `app/api/redraft/trades/route.ts` is retired for mutation and returns 410.
- Draft trade proposal routes use separate active-draft models and were not converted into future redraft inventory.
- Trade discovery, package, review, and analyzer routes are advisory/read-oriented and do not receive execution authority in this slice.

## Validation boundary

Focused deterministic and source-contract suites passed. Browser, provider, database concurrency, staging, production, complete NCAAF schedule behavior, full reversal, and full hypothetical position legality were not validated.

## Legality, acquisition, and settlement completion slice — 2026-07-11

`validateProjectedRedraftRoster` now constructs each side after outgoing and incoming players, uses the canonical saved roster configuration, and returns structured franchise-scoped violations for total size, duplicate players, unresolved identity, invalid IR assignment, sport mismatch, and configured NCAAF pool restrictions. It deliberately does not require a complete weekly starting lineup. FLEX, Superflex, and IDP players remain legal bench assets; position-specific maximums are enforced only when a future persisted construction rule defines an actual cap rather than treating required starter slots as caps.

`evaluateRecentAcquisition` uses persisted `addedAt` and `acquisitionType`. Waiver, free-agent, trade, and commissioner additions inside the saved restriction window are blocked at proposal and settlement. Imported and drafted baseline players are exempt when no later authoritative acquisition exists. Other missing acquisition timestamps block with `ACQUISITION_TIME_UNAVAILABLE` rather than inventing a date.

Native settlement now evaluates projected rosters and acquisition restrictions before claiming a proposal. IDP salary ownership and cap transaction rows are moved through the same Prisma transaction as the pending-state claim, player ownership, and FAAB balances. A cap write, FAAB write, player write, or final state failure therefore rolls back the shared transaction. Derived cap projections remain post-settlement maintenance debt.

Atomic reversal remains blocked by missing immutable before-state evidence. Current completed proposals do not retain before-FAAB balances, salary-record ownership snapshots, slot ownership snapshots, or dependency links sufficient to prove restoration. A reversal endpoint must not be added until execution persists that evidence transactionally.

Provider-aware lock resolution also remains incomplete. Runtime uses persisted per-player `isLocked`; it does not yet prove kickoff, postponement, cancellation, reschedule, opt-out, or provider completeness from a canonical schedule adapter. Automatic settlement is therefore not represented as provider-certified.

The five knowledge-graph test failures describe a direct callback that the current service never invokes. The intended boundary is factual canonical events through the transactional outbox, but native execution does not yet persist every required outcome in the same transaction. Tests remain visible until that outbox contract and consumer are implemented; no fragile callback was added merely to satisfy them.

## Immutable execution evidence slice — 2026-07-11

Native and generic execution now write immutable before/after snapshots and `transaction.trade.executed` through `emitInTx` alongside business state and audits. The event is the intended knowledge-graph and Universal OS boundary; compatibility callbacks are not authoritative. A deterministic read-only reversal readiness service detects missing/partial evidence and later player, FAAB, salary, season, scoring, or playoff dependencies. Consumer delivery, physical migration proof, and reversal mutation remain blocked.

Atomic reversal is now source-implemented through a commissioner-only endpoint for snapshot-supported player and FAAB state. Reversal-blocked evidence, reversed evidence, audit, outbox, and notice are transactional and idempotent. Unsupported draft and IDP cap assets block without partial mutation. Physical migration, contention, rollback injection, and consumer delivery remain unverified.
