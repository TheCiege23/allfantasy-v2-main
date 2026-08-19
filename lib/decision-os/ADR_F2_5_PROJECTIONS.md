# ADR-DOS-F2.5 — Canonical Enrichment: Projections

**Status:** Accepted (2026-06-30). Branch `g15-event-foundation`.
**Phase:** 2 (Canonical Enrichment), layer **F2.5** — additive. NOT cutover, NOT a redesign.
**Governed by:** `ARCHITECTURE_FREEZE.md`. **Builds on:** F2.1 player metadata (`5771a78a1`).

---

## 1. Goal

Expose deterministic weekly projection context as a fifth read-only derived enrichment layer:

- Projected fantasy points (format-matched, week-aware)
- Scoring format provenance (which `scoringPresetId` the projection used)
- Format-match tier (exact vs. fallback)
- Projection source identifier
- Freshness (`expiresAt`-based, direct — not age-based)
- Week/season context
- Honest completeness / uncertainty / warnings throughout

## 2. Source audit (P2 — never fabricate)

### 2.1 Primary source: `FantasyProjection` (`fantasy_projections`)

| Field | Type | Notes |
|---|---|---|
| `playerId` | `string` | Canonical AF player IDs — same namespace as `RedraftRosterPlayer.playerId` and canonical roster player IDs. Confirmed by `lib/trade-discovery/assembleRosters.ts` and `app/api/redraft/roster/route.ts` which join FantasyProjection by these same IDs. |
| `sport` | `string` | Matches `LeagueFacts.sport` |
| `season` | `string` | Stored as a string (e.g. `'2026'`); must compare with `String(LeagueFacts.season)` |
| `week` | `number` | NFL week number; matched against `LeagueFacts.currentWeek` |
| `scoringPresetId` | `string` | Matches `LeagueFacts.scoringPresetId` directly (`'ppr'`, `'half_ppr'`, `'standard'`, `'2qb'`, etc.) |
| `projectedPoints` | `number` | The single-point projection value — primary output |
| `stats` | `Json` | Raw stat breakdown blob; carried as provenance, never parsed for decisions |
| `source` | `string` | Provider/importer identifier (e.g. `'fantasypros'`, `'clear_sports'`, `'runtime-seed'`) |
| `fetchedAt` | `DateTime` | When the row was imported |
| `expiresAt` | `DateTime` | Direct TTL — use as `isStale = expiresAt < now` (no age estimation needed, unlike ADP) |
| Unique | `[playerId, sport, season, week, scoringPresetId, source]` | Multiple sources may exist per player+week+scoring |

Comment from schema: *"Canonical fantasy projection cache. Importers must write provider-backed values only."*
→ P2-safe by design (importers must write real values, no heuristic generation).

### 2.2 Sources NOT used in F2.5 (with rationale)

| Source | Reason excluded |
|---|---|
| `AFProjectionSnapshot` | Weather-adjusted AF snapshot; has no `scoringPresetId` (format-blind); `validUntil` instead of `expiresAt`. Deferred to **F2.6 (Weather)** where weather context is in scope. |
| `AiAdpSnapshotHistory`, `AiProjectionSnapshot` | AI-generated — P3 exclusion (AI never provides deterministic facts). |
| `lib/redraft/projectionEngine.ts` position baselines | Heuristic/position-baseline fallbacks (P3-adjacent); generates synthetic estimates not real provider values. |
| `PlayerCareerProjection` | Multi-year dynasty career projection, not weekly fantasy points. |
| `DynastyProjectionSnapshot` | Dynasty team strength projections, not player-level weekly scoring. |
| `AllFantasyAdpSnapshot.draftProjectionScore` | Draft-context projection, not in-season weekly. |

### 2.3 Week context: `LeagueFacts.currentWeek`

`LeagueFacts.currentWeek` is derived from team performance data (`currentWeekBasis: 'team_performance' | 'unavailable'`). When `currentWeek` is null, there is no canonical current week to match projections against — the projection layer degrades honestly to null + `projection_week_unknown` without attempting to infer a week.

## 3. Freeze compliance — why this is ADDITIVE

- No change to pure `CanonicalWorld`, assembler, or any Phase-1 frozen contract.
- No change to F2.1–F2.4 views.
- New `RawProjectionRow` fact type — allowed.
- New `loadProjectionRows` port function — read-only, no writes.
- New `ProjectionEnrichedCanonicalWorld` derived view — additive, layers on F2.1 `EnrichedCanonicalWorld`.
- No writes, no provider branch, no cache warming, no live API calls.

## 4. Format-contextual projection selection (pure, deterministic)

The port loads ALL `FantasyProjection` rows for the player IDs + sport + season + week.
The projector selects the best row per player by priority:

1. **Exact match**: `scoringPresetId === leagueFacts.scoringPresetId` (and same week+season)
2. **Any-scoring fallback**: any row for that player+week+season + `projection_scoring_format_mismatch` warning
3. **No rows**: null + `projection_unavailable` warning

Within each tier, prefer freshest by `expiresAt DESC`. When multiple sources exist at the same tier+freshness, take the first (deterministic port ordering).

### 4.1 Freshness (expiresAt-based)

Unlike ADP (`createdAt`-only, requires age estimation), `FantasyProjection` carries an explicit TTL:
- `expiresAt > now` → `isStale: false`
- `expiresAt <= now` → `isStale: true`, `staleReason: 'projection_expired'`
- `expiresAt` absent (null row) → `isStale: null`, `staleReason: 'projection_freshness_unavailable'`

### 4.2 Week gate

When `LeagueFacts.currentWeek` is null, the projection layer sets `projectedPoints: null` +
`projection_week_unknown` uncertainty without querying at all (week is required for a meaningful
projection; projecting without a week would mix stale rows from arbitrary weeks).

## 5. Decision

Add `lib/decision-os/world/projectionEnrichedWorld.ts` (pure projectors + types + read-only resolver),
plus additive additions to `facts.ts` and `port.ts`.

**`facts.ts` addition:**
```typescript
interface RawProjectionRow {
  playerId: string
  sport: string
  season: string       // stored as string in DB e.g. '2026'
  week: number
  scoringPresetId: string
  projectedPoints: number
  source: string
  fetchedAt: Date
  expiresAt: Date
}
```

**`port.ts` addition:**
- `loadProjectionRows(sport, ids, season, week)` — reads `FantasyProjection` for given player IDs, sport, season (string), week. Returns ALL scoring-preset variants (projector applies tier selection). Ordered by `expiresAt desc`. Read-only, no writes.

**`projectionEnrichedWorld.ts` (new file):**
- Types: `ProjectionFreshness`, `ProjectionContext`, `ProjectionEnrichedPlayer`,
  `ProjectionEnrichedRosterFacts`, `ProjectionEnrichmentSummary`, `ProjectionEnrichedCanonicalWorld`,
  `ProjectionContextResult`, `ProjectionPort`, `ProjectionEnrichedWorldDeps`.
- Pure: `selectBestProjectionRow(rows, scoringPresetId)` — tiered selection as per §4.
- Pure: `projectProjectionFreshness(row, now)` — expiresAt-based staleness.
- Pure: `projectProjectionContext(rows, scoringPresetId, now)` — builds `ProjectionContext`.
- Pure: `projectProjectionEnrichedWorld(world, contextResult, leagueFacts)` — folds onto F2.1.
- Read-only: `resolveProjectionRows(sport, ids, season, week, port?)`.
- Read-only: `resolveProjectionEnrichedCanonicalWorld(leagueId, deps?)` — chains F2.1, never throws.

## 6. Field scope

| Field | Source | Degradation |
|---|---|---|
| `projectionContext.projectedPoints` | `FantasyProjection.projectedPoints` | null + `projection_unavailable` |
| `projectionContext.source` | `FantasyProjection.source` | null |
| `projectionContext.scoringPresetId` | `FantasyProjection.scoringPresetId` | null |
| `projectionContext.matchTier` | derived from tier selection | null |
| `projectionContext.week` | `FantasyProjection.week` | null when week unknown |
| `projectionContext.season` | `FantasyProjection.season` | null |
| `projectionContext.freshness.isStale` | `expiresAt < now` | null when no row |
| `projectionContext.freshness.expiresAt` | `FantasyProjection.expiresAt` | null when no row |

## 7. Deliverables

1. This ADR.
2. `facts.ts` — add `RawProjectionRow`.
3. `port.ts` — add `loadProjectionRows`.
4. `projectionEnrichedWorld.ts` — new derived view.
5. `world/index.ts` — re-exports.
6. Tests: scoring-match exact, scoring fallback, no projection, stale, freshness, week-gate, no-mutation, origin-blind shape, resolver-never-throws, architecture guard.
7. Non-prod conformance re-run (all 5 scripts GREEN).
8. Real-data coverage probe (`scripts/probe-projection-coverage.ts`) + results documented here (§10).

## 8. Success

Canonical World exposes deterministic weekly projections where available, with scoring-format
provenance, freshness, and honest degradation, while every Phase-1 frozen invariant and all
conformance checks remain GREEN.

## 9. Registry

No `DECISION_REGISTRY.md` row — substrate enrichment, not a decision slice.

## 10. Real-data results (non-prod `ep-winter-salad`, 2026-06-30)

**Projection coverage probe (`scripts/probe-projection-coverage.ts`):**

| Metric | Value |
|---|---|
| Total `FantasyProjection` rows | 43 |
| Fresh (expiresAt > now) | 43 (all fresh — expiresAt 2026-07-20) |
| By scoringPresetId | ppr: 43 |
| By source | runtime-seed: 43 |
| By season/week | 2026 / week 5 (22 rows), week 6 (21 rows) |
| `AFProjectionSnapshot` total | 0 |

**FINDING F2.5-1 (synthetic IDs — expected, benign):**
All 43 rows are from `runtime-seed` (seeded for war-room testing) with synthetic player IDs
(`rwr-member-qb-1`, etc.). These IDs will not match canonical roster player IDs in real leagues.
Honest degrade (`projection_unavailable`) expected for all real players on staging. Production
projections are imported by the `import-players`/`import-scores` cron against real provider APIs.

**FINDING F2.5-2 (single scoring preset on staging):**
All staging rows use `scoringPresetId: 'ppr'`. Other preset coverage (half_ppr, standard, 2qb)
cannot be verified on non-prod — will be present in production from provider imports.

**FINDING F2.5-3 (AFProjectionSnapshot empty on staging):**
0 rows on non-prod. Confirmed this source is not applicable for F2.5 (deferred to F2.6 weather).

**Five conformance scripts — all GREEN on both origins:**
`WORLD_CONFORMANCE_OK` / `LINEUP_CONFORMANCE_OK` / `WAIVER_CONFORMANCE_OK` / `COMMISSIONER_CONFORMANCE_OK` / `TRADE_CONFORMANCE_OK` — every Phase-1 frozen invariant intact after F2.5 additions.
