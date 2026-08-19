# Commissioner Shadow Snapshot — Schema Proposal (Phase 10)

**Status: proposal only. Not migrated. `prisma/schema.prisma` was not modified.**

Same pattern as [`docs/os/GAME_DAY_SNAPSHOT_SCHEMA_PROPOSAL.md`](GAME_DAY_SNAPSHOT_SCHEMA_PROPOSAL.md) (Phase 9) and [`docs/os/FANTASY_KNOWLEDGE_GRAPH_SCHEMA_PROPOSAL.md`](FANTASY_KNOWLEDGE_GRAPH_SCHEMA_PROPOSAL.md) (Phase 3). This document exists because [`lib/shared-services/commissioner/`](../../lib/shared-services/commissioner/README.md) currently ships an in-memory `CommissionerShadowResultStore` (explicitly disclosed as non-durable) standing in for a real table.

## Proposed model

```prisma
model CommissionerShadowEvaluationRecord {
  id              String   @id @default(cuid())
  leagueId        String
  generatedAt     DateTime @default(now())
  context         Json     // CommissionerContext
  pulse           Json     // LeaguePulse
  health          Json     // LeagueHealthAssessment
  attentionItems  Json     // CommissionerAttentionItem[]
  ranking         Json?    // CommissionerPowerRanking | null
  brief           Json     // CommissionerBrief
  divergence      Json     // CommissionerDivergenceItem[]

  @@index([leagueId, generatedAt])
  @@map("commissioner_shadow_evaluation_records")
}
```

## Why one JSON-heavy row, same reasoning as Phase 9's proposal

This table's job is to remember "what did the Commissioner Intelligence shadow evaluation look like at time T" for later comparison/audit — not to become a new source of truth for league health, rankings, or activity counts, all of which already have real, authoritative homes (`monitorLeagueHealth()`'s output via `resolveDecisionOsLeagueHealth`, `PowerRankingsOutput`, etc.). Normalizing every nested field would duplicate data this proposal has no intention of ever treating as authoritative.

## Migration checklist (do not run without approval)

- [ ] Confirm retention policy — an append-only per-league evaluation log grows unbounded.
- [ ] Confirm whether `leagueId` should be a foreign key to `League` once this is no longer proposal-only.
- [ ] Confirm which environment(s) this lands in first (a throwaway Neon test branch before production, matching established practice).
- [ ] Decide whether `divergence` records specifically deserve their own indexed table for cross-league querying ("show me every league where the Attention Queue divergence check found a missing `draft_approaching` signal this week") — the current proposal only supports "give me this league's latest/historical evaluation."
