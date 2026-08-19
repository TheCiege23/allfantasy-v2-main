# Live Lineup Integration (Fantasy OS Phase 5E-b)

Injects certified sports-data evidence into the real Lineup **lock-state** and **auto-sub** paths, gated and additive, preserving the existing lock/roster authorities.

## Authority contract (unchanged)
Decision order stays: authenticate → authorize league/roster → roster ownership → slot/roster eligibility → **load certified evidence** → freshness/identity → **existing lock authority (`lineupLockService`)** → roster legality → persist → audit. The Sports Data Gateway supplies **facts only**; it is never authoritative for authorization, membership, ownership, slot/roster construction, league lock settings, commissioner overrides, or final approval. It can only make an automatic action **stricter**, never more permissive.

## Shared integration service (`lib/fantasy-os/sports-runtime/lineupIntegration.ts`)
`CertifiedLineupIntegrationService` composes: certified player + games snapshots, cross-provider team identity, player→game resolution, freshness, and the 5D-c auto-switch safety contract. It does **not** duplicate lock policy. Fails closed to `unavailable`; returns no raw provider fields. `extractPlayerRefs` defensively parses roster player ids (bounded).

## Wired routes
- **`GET /api/leagues/[leagueId]/roster/lineup/lock-state`** — after the authoritative `lock` (from `resolveFullLineupLockContext`, unchanged), when `FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED` is on, adds an **additive** `certifiedSportsEvidence` field. Wrapped in try/catch so evidence failure never turns a safe result into an error (Part 11).
- **`POST /api/lineup/auto-sub`** — after the deterministic `runAutoSubLineupEngine` (authoritative, `injuryInactiveOnly`), when the gate is on, adds a **fail-closed** `sportsDataGuard` advising callers to **hold** automatic execution when the certified schedule is stale/unavailable. Additive; the engine decides what to sub. Injury/inactivity alone never triggers a switch (no verified injury feed).

## Feature gate
`FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED` (server-only, disabled by default). **Disabled → existing behavior byte-for-byte unchanged** (no sports-data read, no provider call, no evidence field). Cannot be overridden by query/body/header/account (gates read only server env; body/query never toggle them — tested).

## Failure behavior
- Provider/repository unavailable, no snapshot, or read error → `available:false` / `unavailable` envelope; auto-sub guard advises hold; existing deterministic behavior preserved; no provider fallback; no exception to the customer.
- Stale (delayed/partial) → visible `freshnessStatus`; auto-sub guard `safe:false`.
- Identity unresolved → surfaced (`identityStatus`), no silent provider-id fallback.

## Direct-provider guard (Part 12)
The wired routes + integration service reach providers **only** through the gateway ports — enforced by test (no `sleeper-client`/`espn-client` import, no `api.sleeper.app`/`site.api.espn.com` URL).

## Proving run
The integration service ran against real certified snapshots (season 2026 wk1 ESPN games + the certified players snapshot): `available=true`, freshness propagated, **no provider fields leaked**, fail-closed on unauthorized. Player→game resolution + auto-switch are exhaustively unit-tested against real ESPN team ids (5D-c). Note: the 5B players sample is teamless (FA/practice), so end-to-end player→game against real rostered players is unit-proven, not shown in this run — a data-sample artifact, not a logic gap.

## Known limitations
No verified injury feed; no verified projection feed (Start/Sit availability/projection stay `null`/unavailable). Start/Sit + today-lineup-actions + the persisting mutation path are **not** wired in this increment (lock-state + auto-sub are).

## Disable / rollback
Unset `FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED` → routes revert to prior behavior instantly.
