# Game Day Snapshot — Schema Proposal (Phase 9)

**Status: proposal only. Not migrated. `prisma/schema.prisma` was not modified.**

Same pattern as [`docs/os/FANTASY_KNOWLEDGE_GRAPH_SCHEMA_PROPOSAL.md`](FANTASY_KNOWLEDGE_GRAPH_SCHEMA_PROPOSAL.md) (Phase 3): a proposal document, reviewed and approved, before any migration runs against a real database. This document exists because [`lib/shared-services/game-day/`](../../lib/shared-services/game-day/README.md) currently ships an in-memory `GameDaySnapshotStore` (explicitly disclosed as non-durable) standing in for these real tables.

## Proposed models

```prisma
model GameDaySnapshotRecord {
  id                   String   @id @default(cuid())
  userId               String
  generatedAt          DateTime @default(now())
  includedLeagueIds    Json     // string[]
  leagueContexts       Json     // LeagueGameDayContext[] — see lib/shared-services/game-day/types.ts
  exposures            Json     // UserPlayerExposure[]
  attentionItems       Json     // LineupAttentionItem[]
  gameWindows          Json     // GameWindow[]
  managerTendency      Json     // ManagerTendencyContext
  dataQuality          Json     // { leagueCount, unavailableLeagueCount, staleMatchupCount }
  freshnessSummary     Json     // { oldestFetchedAt, newestFetchedAt }
  divergence           Json     // GameDayDivergenceItem[]

  @@index([userId, generatedAt])
  @@map("game_day_snapshot_records")
}
```

## Why one JSON-heavy row rather than normalized child tables

A `GameDaySnapshot` is, by design, an **immutable point-in-time capture** of a cross-league view that already gets its authoritative, queryable data from real existing tables (`TeamWeekResult`, `WeeklyScore`, `FantasyProjection`, `FantasyStatLine`, `Roster`, `DraftPick`, etc. — see the module's own README for the full list). This table's job is only to remember "what did the user's Game Day view look like at time T," not to be a new source of truth for matchup/scoring/lineup facts — those already have real, versioned homes. Normalizing every nested field into its own table would duplicate data this proposal has no intention of ever treating as authoritative. A JSON snapshot column keeps the write path simple and matches the same reasoning the Knowledge Graph proposal already used for its `metrics`/`confidenceEnvelope` columns.

## Migration checklist (do not run without approval)

- [ ] Confirm retention policy — an append-only per-user snapshot log grows unbounded; likely needs a TTL/archival job before this ships for real (e.g. keep only the last N snapshots per user, or last N days).
- [ ] Confirm whether `userId` should be a foreign key to `AppUser` once this is no longer proposal-only.
- [ ] Confirm which environment(s) this lands in first (a throwaway Neon test branch before production, matching established practice).
- [ ] Decide whether attention items specifically (not the whole snapshot) deserve their own indexed table for querying "show me all critical attention items across users this week" — the current proposal only supports "give me this user's latest/historical snapshot," not cross-user querying.
