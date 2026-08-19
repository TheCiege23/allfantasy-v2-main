# ADR: Canonical Redraft Lifecycle and Settings Boundaries

- Status: Accepted incrementally
- Date: 2026-07-11
- Scope: NFL and NCAAF redraft foundation

## Context

Lifecycle truth is currently distributed across `League.status`, `League.lifecycleState`, `DraftSession.status`, `RedraftSeason.status`, playoff records, renewal records, and current-week derivation. Settings are distributed across league columns, JSON documents, dedicated settings tables, defaults, entitlement checks, and some request payloads.

The persisted lifecycle vocabulary is narrower than the Product Constitution. It does not directly represent registration, preseason, regular-season naming, renewed, or next-season setup. Adding those states now would require a database migration, caller inventory, historical mapping, rollback plan, and compatibility policy. That work is intentionally deferred.

## Decision

1. `League.lifecycleState` remains the persisted league-phase authority during the bounded migration.
2. `League.status` remains a legacy availability/display field and must not be used as a substitute for lifecycle authorization.
3. New NFL and NCAAF redraft leagues explicitly persist `setup` in every creation path.
4. Compatibility reads may normalize missing or historical values. Mutation boundaries use strict parsing and reject unknown values.
5. `server/services/leagueLifecycleService.ts` is the coordinator direction. No additional parallel lifecycle service will be introduced.
6. Draft, season, playoff, and renewal states remain artifact states. They must be coordinated with, but must not independently redefine, league lifecycle truth.
7. Saved server-side settings are authoritative. Request bodies may express user intent but may not choose governance policy.
8. Completed-season history must become immutable through versioned settings/scoring snapshots and additive corrections.

## Why permissive mutation normalization is unsafe

Converting a typo or unsupported value to `in_season` changes the meaning of the request, can open transactions prematurely, and can produce audit and notification records for an action the caller did not request. Strict parsing returns 400 before mutation or fanout.

## Compatibility strategy

- Preserve `normalizeLifecycleState()` for legacy reads.
- Use `parseLifecycleStateForWrite()` at mutation boundaries.
- Do not bulk-update existing leagues in this slice.
- Inventory stored lifecycle/status/season/draft/playoff/renewal combinations before migration.
- Define explicit mappings, invalid combinations, historical impact, rollback SQL, and repair reporting before changing the enum.

## Settings direction

A future versioned snapshot must separate universal, sport, league-type, entitlement-gated, organization-enforced, setup-editable, in-season, locked, approval-required, recalculation-required, and next-season-only settings. Engines must resolve a server-side snapshot and version. Client-supplied veto rules, deadlines, locks, scoring, playoffs, waiver order, or asset limits cannot override it.

## Consequences

- Creation and lifecycle mutation safety improve without a schema migration.
- Existing read compatibility is preserved.
- `status: active` may coexist with `lifecycleState: setup`; callers must interpret status as availability, not season phase.
- Draft and playoff completion remain known coordinator bypasses and are not represented as fixed.

## Next migration slices

1. Draft completion through the transaction-aware coordinator.
2. Playoff completion and champion finalization through the same coordinator.
3. Offseason entry.
4. Renewal and next-season creation with immutable history.
5. Canonical week advancement.

Each slice must include authorization, idempotency, transaction semantics, canonical events, immutable audit evidence, member-visible system messages where required, and OS ingestion context.
## Completion boundary implementation note — 2026-07-11

The coordinator now exposes a transaction port used by draft completion and both native champion persistence paths. It validates the existing transition graph, updates lifecycle metadata, writes immutable lifecycle audit evidence, and enqueues a canonical lifecycle event in the caller transaction.

Temporary compatibility edges allow `setup -> post_draft` and `pre_draft -> post_draft` only for a verified completed draft. The completion helper rejects any result that would require a forced transition. Mock sessions never invoke the real-league transition.

Champion persistence writes championship history, season/bracket completion, lifecycle transition, audit evidence, and canonical outbox events in one transaction. Post-commit member fanout remains a separate durable-service call and is explicitly not part of that transaction.

Draft completion still has a two-stage boundary: draft/lifecycle/audit/outbox commit first, followed by idempotent roster, season, and schedule materialization. Moving those artifact writers behind transaction-aware ports is deferred rather than hidden.
## Offseason snapshot decision — 2026-07-11

`LeagueSeason` is the current immutable season-summary boundary. Canonical offseason entry creates it once and never updates it. Renewal compatibility code may create a missing historical summary but may not rewrite one.

The summary freezes the values supported by the current schema and `teamRecords` JSON. Rich historical facts remain in season-scoped redraft tables; this is documented as a limitation rather than represented as a full snapshot.

`completed -> offseason` uses the transaction coordinator and commits snapshot/audit/outbox evidence together. Member fanout remains post-commit.

The current renewal POST route is not canonical: it bypasses `LeagueRenewal`/slots, advances the season, resets rosters and standings, and changes settings through separate writes. It remains compatibility debt until replaced by a transaction-aware service built on persistent franchise identity and versioned next-season settings.

## Renewal persistence recovery decision — 2026-07-11

Migration history did not contain the renewal tables represented by Prisma. Recovery therefore uses two ordered migrations: Stage 1 exactly materializes the existing manager-scoped foundation; Stage 2 adds nullable franchise and manager lineage, confirmation/replacement linkage, next-season linkage, backward-compatible states, and active redraft-season uniqueness. The old manager unique key is retained until all compatible runtimes and historical rows have been reviewed.

Backfill accepts only a unique same-league mapping from a slot manager to `LeagueTeam.id`. Ambiguous or missing mappings remain null and will block later completion. No completed summary or historical manager ownership is rewritten. Deployment is prohibited until migration-history divergence is reconciled and both stages pass against a disposable live-equivalent database.

Exact recovery of the four database-only migration files failed across local refs, fetched remotes, and both authoritative repositories. Therefore production checksum history is not considered repaired. A disposable physical clone may validate the renewal stages under Strategy B, but cannot by itself authorize production deployment.

## Trade settings authority — 2026-07-11

Redraft trade governance resolves from persisted league columns and the canonical settings snapshot. Proposal clients cannot override veto mode, threshold, review window, deadline, processing mode, maximum assets, commissioner approval, or draft-asset permission. Existing advisory analysis remains informational and is not a lifecycle actor.
