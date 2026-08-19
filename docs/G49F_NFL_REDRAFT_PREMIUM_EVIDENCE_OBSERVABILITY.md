# G49F NFL Redraft Premium Evidence Observability

## Purpose

G49F improves production readiness for NFL Redraft premium services with safe evidence snapshot hooks, deterministic backfill utilities, evidence health summaries, resolver timing metadata, access-denial diagnostics, and operational logging boundaries.

It remains facts-only. It does not build Decision OS, AI reasoning, recommendations, generated summaries, checkout, Stripe, or raw provider-payload exposure.

## Persistence And Backfill Strategy

Premium evidence snapshots use existing operational storage when explicitly available. The persistence hook writes sanitized metadata to `ApiUsageEvent`-style storage:

- canonical request IDs
- service ID and variant
- evidence packet IDs
- evidence types
- evidence counts
- evidence health summaries
- resolver status
- facts-only flags

The snapshot intentionally excludes raw provider payloads, provider secrets, provider-specific IDs, recommendation outputs, and evidence facts.

Persistence is optional and safe by default. If storage is unavailable or not enabled, the route returns `persistenceStatus: "unavailable"` and continues returning a normal facts-only premium service packet.

The deterministic backfill hook can rebuild per-league premium evidence snapshots across:

- Basic Runtime Facts
- War Room
- Commissioner Digest
- Manager Brief
- Matchup Prep
- Waiver Report
- Trade Review
- Draft Prep

Backfill reads canonical production evidence through the G49E source and G49C resolver. It does not invent data.

## Observability Fields

The premium route may now include additive metadata:

- `diagnostics`
- `evidenceSnapshotId`
- `generatedAt`
- `resolverDurationMs`
- `evidenceHealth`
- `backfillStatus`

These fields are additive and preserve the G49E response shape. Existing required fields such as `serviceName`, `requiredTier`, `accessStatus`, `canonicalIds`, `evidencePacketIds`, `resolverStatus`, and `evidenceCounts` remain unchanged.

Evidence health summarizes:

- total evidence packets
- stale evidence packet count
- fallback evidence packet count
- missing evidence packet count
- fresh/unknown freshness counts
- counts by evidence type
- counts by source provider

## Logging Boundaries

Operational logging is structured and safe:

- no raw provider payloads
- no provider secrets
- no generated advice
- no AI reasoning
- no recommendation text

Logs include only service ID, league ID, status, optional access-denial reason, snapshot ID, and aggregate evidence-health counts.

## Known Limitations

G49F does not add a new database table. Snapshot persistence depends on existing operational storage and remains safely unavailable when that storage is not supplied or enabled.

Backfill is a library hook, not a scheduler or admin UI. Future launch-hardening work can add an authenticated admin route or job runner around the hook.

The production evidence source still depends on canonical data already present in the repo. Missing provider-backed domains continue to return honest missing/fallback states.

## Remaining G50 Launch-Hardening Work

G50 should focus on launch gates:

- production admin controls for backfill
- persisted snapshot retention policy
- alert thresholds for stale/fallback/missing evidence
- authenticated operational dashboards
- rollout flags for premium persistence
- monitoring around entitlement denials and resolver latency
- continued facts-only separation until an explicit recommendation or OS milestone
