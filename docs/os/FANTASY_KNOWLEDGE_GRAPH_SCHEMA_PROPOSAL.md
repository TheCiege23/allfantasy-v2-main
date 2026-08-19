# Fantasy Knowledge Graph — Schema Proposal (Phase 3)

**Status: proposal only. Not migrated. `prisma/schema.prisma` was not modified.**

This follows the same pattern already established in this codebase's own history for schema changes (see `docs/SLEEPER_IMPORT_SCHEMA_PROPOSAL.md` and project memory `sleeper-import-hardening`): a schema proposal document, reviewed and approved, before any migration runs against a real database. This document exists because [`lib/shared-services/knowledge-graph/`](../../lib/shared-services/knowledge-graph/README.md) currently ships an in-memory `SignalStore`/`SnapshotStore` (explicitly disclosed as non-durable) standing in for these real tables.

## Proposed models

```prisma
model KnowledgeGraphSignal {
  id                String   @id @default(cuid())
  signalType        String   // 'trade_accepted' | 'trade_rejected' | 'trade_cancelled' | 'trade_vetoed' | 'waiver_claim_won' | 'waiver_claim_lost'
  leagueId          String
  managerKey        String   // Roster.platformUserId today — see README on reconciling with the Identity Service's FantasyUser later
  occurredAt        DateTime @default(now())
  payload           Json     // signal-specific evidence (tradeId, claimId, playerIds, etc.)
  sourceAttribution Json     // { source, emittedFrom, recordedAt }
  createdAt         DateTime @default(now())

  @@index([managerKey, signalType])
  @@index([leagueId, signalType])
  @@index([occurredAt])
  @@map("knowledge_graph_signals")
}

model ManagerBehaviorProfileSnapshot {
  id                 String   @id @default(cuid())
  managerKey         String
  asOf               DateTime
  computedAt         DateTime @default(now())
  metrics            Json     // ManagerBehaviorMetrics
  confidenceEnvelope Json     // ConfidenceEnvelope

  @@index([managerKey, asOf])
  @@map("manager_behavior_profile_snapshots")
}

model PlayerExposureSnapshot {
  id                 String   @id @default(cuid())
  managerKey         String
  playerId           String
  asOf               DateTime
  computedAt         DateTime @default(now())
  metrics            Json     // PlayerExposureMetrics
  confidenceEnvelope Json     // ConfidenceEnvelope

  @@index([managerKey, playerId, asOf])
  @@map("player_exposure_snapshots")
}
```

## Why JSON columns for `metrics`/`confidenceEnvelope` rather than one column per field

The `ConfidenceEnvelope` and metrics shapes are still actively evolving (this is a foundation phase — the other ~13 derived-intelligence types in the Knowledge Graph spec aren't built yet, and their metrics shapes aren't finalized). A JSON column avoids a migration every time a field is added or a heuristic changes, at the cost of losing column-level query/index granularity on the metric values themselves — an acceptable tradeoff for a foundation-phase proposal. `managerKey`, `asOf`, `leagueId`, and `signalType` stay first-class indexed columns since those are the actual query patterns (`findByManager`, `distinctLeagueCount`, `latestManagerBehaviorProfile`).

## Migration checklist (do not run without approval)

- [ ] Confirm `managerKey` naming/typing against wherever the Identity Service's `FantasyUser` reconciliation lands — today it's a bare `Roster.platformUserId` string, matching what `TradeSignalHook.ts`/`WaiverSignalHook.ts` actually read; a future migration might want a foreign key once a canonical identity table exists.
- [ ] Confirm retention policy for `KnowledgeGraphSignal` rows — this proposal has no TTL/archival plan yet; an append-only signal log grows unbounded.
- [ ] Confirm which environment(s) this lands in first (matches the existing precedent: a throwaway Neon test branch before production, per `sleeper-import-hardening`'s established practice).
- [ ] Once approved: run `npx prisma migrate dev` against a real (non-production) database, then swap `InMemorySignalStore`/`InMemorySnapshotStore` for Prisma-backed implementations of the same `SignalStore`/`SnapshotStore` interfaces — no caller-side change required, per the interface boundary already in place.
