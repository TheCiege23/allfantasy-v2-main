# ADR F2.8 — Canonical Enrichment: League Intelligence Foundation

**Status:** Accepted  
**Date:** 2026-06-30  
**Phase:** 2 — Canonical Enrichment  
**Ticket:** F2.8 — League Intelligence Foundation  
**Follows:** F2.7 News Signals (`05a4610a7`)

---

## 1 — Goal

Add deterministic league-intelligence enrichment as a read-only derived view layering on
`EnrichedCanonicalWorld` (F2.1). Expose league-level health, manager participation, roster
completeness, activity signals, commissioner workload, and honest degradation — all without AI
summaries, live API calls, or any writes.

---

## 2 — Source Audit

### 2.1 — Candidate sources

| Source | Model / Table | Join Key | Decision |
|---|---|---|---|
| CanonicalWorld facts | `CanonicalWorld` (already loaded) | n/a (in-memory) | **PRIMARY — zero new reads** |
| Waiver activity | `WaiverClaim` (`waiver_claims`) | `leagueId`, `createdAt` | **INCLUDED — count query, read-only** |
| Trade activity | `AfLeagueTrade` (`af_league_trades`) | `leagueId`, `createdAt` | **INCLUDED — count query, read-only** |
| Lineup/roster-move activity | `AfRosterMoveHistory` (`af_roster_move_history`) | `leagueId`, `createdAt` | **INCLUDED — count query, read-only** |
| League reputation | `LeagueReputation` (`league_reputations`) | `leagueId` (unique) | **CARRY — precomputed, read-only** |
| Commissioner health snapshot | `buildCommissionerHealthSnapshot` | (function call) | **EXCLUDED** — pulls server-only imports (P1 substrate purity); same data available from activity counts above |
| LifecycleTelemetryRecord | `lifecycle_telemetry` | `leagueId` | **EXCLUDED** — event log, no guaranteed schema contract; covered by activity counts |
| RedraftLeagueTransaction | `redraft_league_transactions` | `leagueId` | **EXCLUDED** — subset of activity already captured via AfRosterMoveHistory |
| RedraftWaiverClaim | `redraft_waiver_claims` | `leagueId` | **EXCLUDED** — covered by WaiverClaim (platform-level waiver table) |
| AI tables (ChimmyContextRun, AILeagueContext, etc.) | various | leagueId | **EXCLUDED** — P3: AI-generated signals are never canonical facts |

### 2.2 — Canonical World signals (zero additional DB reads)

All signals below are derived purely from the already-loaded `CanonicalWorld` in-memory:

- **Orphan detection**: `team.isOrphan` → `orphanCount`, `orphanRate`
- **Active managers**: non-orphan, non-null `managerUserId` teams
- **Roster completeness**: `roster.playerCount` vs `leagueFacts.rosterSettings.rosterSize`
- **Empty rosters**: `roster.playerCount === 0`
- **Commissioner workload**: `team.isCommissioner`, `team.isCoCommissioner`, commissioner team orphan status
- **Competitive balance**: range of `team.pointsFor` across teams (spread)
- **FAAB utilization**: `team.faab.remaining / team.faab.budget` (when available)
- **Sync staleness**: `world.provenance.freshness.isStale`
- **Current week**: `leagueFacts.currentWeek`

### 2.3 — Activity signals (new port reads — counts only)

| Signal | Table | Query |
|---|---|---|
| `waiverClaimCount` | `WaiverClaim` | `_count` where `leagueId`, `createdAt >= since` |
| `tradeCount` | `AfLeagueTrade` | `_count` where `leagueId`, `createdAt >= since` |
| `rosterMoveCount` | `AfRosterMoveHistory` | `_count` where `leagueId`, `createdAt >= since` |

Count queries only — no row data fetched. Lookback: 30 days (configurable via deps).

### 2.4 — LeagueReputation carry (precomputed, read-only)

`LeagueReputation` (`leagueId` unique) carries `overallScore`, `tier`, `completionRate`,
`retentionRate`, `stabilityScore`, `longevityScore`, `competitivenessScore`, `totalSeasons`,
`lastComputedAt`. These are **carried as provenance only** — never branched on in health logic.
The health score is computed independently from the canonical signals above (§3).

---

## 3 — Health Score Algorithm

The health score (0–100) is a transparent deduction formula, fully deterministic. All inputs are
from the canonical world or activity counts. No AI, no ML.

```
score = 100

orphanPenalty  = Math.round(orphanRate * 30)        // 0–30 pts
rosterPenalty  = Math.round((1 - rosterCompleteRate) * 20)  // 0–20 pts
stalePenalty   = isWorldStale ? 10 : 0               // 0–10 pts

score = Math.max(0, 100 - orphanPenalty - rosterPenalty - stalePenalty)
```

**Health tier**:
- `healthy`: score ≥ 80 and orphanRate < 0.20
- `at_risk`: score ≥ 50 or orphanRate < 0.40
- `inactive`: score < 50 or orphanRate ≥ 0.40
- `unknown`: teams array is empty (no data to score)

**Basis labels** (for transparency/explainability):
- `orphan_teams`: when orphanPenalty > 0
- `incomplete_rosters`: when rosterPenalty > 0
- `sync_stale`: when stalePenalty > 0

---

## 4 — Activity Tier Classification

For each activity signal (waiver / trade / lineup):

```
perWeekRate = count / (lookbackDays / 7)

tier:
  'high'     if perWeekRate >= 3
  'moderate' if perWeekRate >= 1
  'low'      if perWeekRate > 0
  'inactive' if perWeekRate === 0
  'unknown'  if data unavailable
```

---

## 5 — Engagement Tiers (league-level)

```
engagementTier (derived from waiverActivity + tradeActivity + lineupActivity):
  'high'     if any individual tier is 'high'
  'moderate' if any individual tier is 'moderate'
  'low'      if all tiers are 'low' or 'inactive'
  'inactive' if all tiers are 'inactive'
  'unknown'  if all tiers are 'unknown'
```

---

## 6 — Inactivity and Engagement Warnings

**Inactivity warnings** (added to `inactivityWarnings[]`):
- `orphan_teams_detected`: orphanCount > 0
- `majority_orphan`: orphanRate >= 0.5
- `empty_rosters_detected`: emptyRosters > 0
- `all_rosters_empty`: all rosters have 0 players
- `orphan_commissioner`: commissioner team is also orphan

**Engagement warnings** (added to `engagementWarnings[]`):
- `no_waiver_activity`: waiverActivity.tier === 'inactive'
- `no_trade_activity`: tradeActivity.tier === 'inactive'
- `no_lineup_activity`: lineupActivity.tier === 'inactive'
- `all_activity_low`: all three tiers are 'low' or worse

---

## 7 — Honest Degradation

All uncertainty tokens surface in `uncertainty[]`:
- `activity_data_unavailable`: port threw when loading activity counts
- `reputation_unavailable`: LeagueReputation row not found for this league
- `sync_stale`: world.provenance.freshness.isStale
- `empty_league`: teams array is empty (cannot score)
- `no_rosters`: rosters array is empty (roster completeness unavailable)
- `activity_partial`: activity port succeeded but lookback may be less than requested

---

## 8 — Architecture Freeze Invariants

All frozen invariants are preserved:

1. **No mutation** — base `EnrichedCanonicalWorld` is never modified. League intelligence lives
   on the new derived view only.
2. **Origin-blind** — health score never branches on `provider`. Orphan/roster signals come from
   canonical facts, not provider-specific fields.
3. **Purpose-blind** — no commissioner-specific logic. Health score is the same regardless of
   viewer (no role branching).
4. **P1 substrate purity** — no server-only imports (no commissioner hub, no time-engine).
5. **P2 enrichment-as-truth** — null + uncertainty[], never fabricate. Activity counts unavailable
   → `'unknown'` tier, not a guess.
6. **P3 AI governance** — no AI summaries. All signals are deterministic arithmetic on persisted rows.
7. **NEVER throws** — `resolveLeagueIntelEnrichedCanonicalWorld` catches all errors internally.
8. **Read-only port** — three `_count` queries + one `findFirst`. No writes, no cache warming,
   no live API calls.

---

## 9 — Real-Data Coverage Findings (staging `ep-winter-salad`)

**FINDING F2.8-1: WaiverClaim activity** — Staging leagues may have 0 WaiverClaim rows (native
redraft leagues use `RedraftWaiverClaim`, not `WaiverClaim`). Activity count will be 0 / tier
`inactive`. Expected on staging; honest degrade. No logic gap.

**FINDING F2.8-2: AfLeagueTrade activity** — `AfLeagueTrade` is native AF only. Imported Sleeper
leagues have no `AfLeagueTrade` rows. Activity count will be 0 / tier `inactive`. Expected;
honest degrade.

**FINDING F2.8-3: AfRosterMoveHistory** — Roster-move history is written only when lineups are
changed via the AF roster move engine. Staging leagues with no in-season moves will have 0 rows.
Expected; honest degrade.

**FINDING F2.8-4: LeagueReputation** — `league_reputations` rows are computed by the reputation
engine on a schedule. Staging leagues without a reputation row will degrade to `null` reputation
carry with `reputation_unavailable` uncertainty.

---

## 10 — Alternatives Considered

### A — Delegate to buildCommissionerHealthSnapshot (rejected)
The commissioner health snapshot already computes many of these signals. However: (a) it pulls
`server-only` dependencies through the commissioner hub assembler — importing it would break the
P1 substrate purity rule (no server-only in the world layer); (b) it is designed for the
commissioner viewer, not an origin-blind world signal; (c) it is a complete computation pipeline,
not a port seam.

### B — LifecycleTelemetryRecord for activity (rejected)
Would provide richer activity signals, but: no guaranteed row-per-league index for cheap count
queries at scale; schema lacks a canonical `leagueId`-indexed, stable activity contract. Covered
by WaiverClaim + AfLeagueTrade + AfRosterMoveHistory counts which are indexed on `leagueId`.

### C — Include WeeklyScore for scoring activity (deferred)
`WeeklyScore` rows signal lineup submission. Deferred to F2.8+ (not Foundation scope). Honest
degrade: lineup activity falls back to `AfRosterMoveHistory` counts, which captures explicit
roster/lineup changes rather than weekly score imports.
