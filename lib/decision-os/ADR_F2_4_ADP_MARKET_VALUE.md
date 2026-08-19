# ADR-DOS-F2.4 — Canonical Enrichment: ADP / Market Values

**Status:** Accepted (2026-06-30). Branch `g15-event-foundation`.
**Phase:** 2 (Canonical Enrichment), layer **F2.4** — additive. NOT cutover, NOT a redesign.
**Governed by:** `ARCHITECTURE_FREEZE.md`. **Builds on:** F2.1 player metadata (`5771a78a1`).

---

## 1. Goal

Expose deterministic ADP and market-value context as a fourth read-only derived enrichment layer,
adding to the F2.1 metadata view:

- ADP (average draft position) with format/scoring provenance
- ADP freshness (createdAt, estimated staleness based on age)
- ADP provider context (multi-provider consensus score, provider count, ADP spread, week-over-week change)
- AllFantasy market value (trade-signal-derived, where published)
- Market-value freshness (generatedAt, updatedAt, isStale)
- Market-value confidence, direction (trending up/down/stable), sample size
- Format context provenance (which format/scoring the ADP row came from)
- Honest completeness / uncertainty / warnings throughout

## 2. Source audit (P2 — never fabricate)

| Table | `playerId` key | Format dims | Freshness | Notes |
|---|---|---|---|---|
| `AdpDataRecord` (`adp_data`) | `playerId + sport` | `format` ('redraft'/'dynasty'), `scoring` ('standard'/'ppr'/'half-ppr'/'2qb'/'superflex') | `createdAt` only (no `expiresAt`) | Already used in Phase E trade enrichment (`lib/decision-os/trade/loader.ts`); same ID space as canonical roster player IDs (proven in E.5 trade conformance) |
| `AllFantasyMarketPlayerValue` (`allfantasy_market_player_values`) | `[sport, leagueConcept, playerId]` | `leagueConcept` ('redraft' — only value currently written) | `generatedAt`, `updatedAt` | AF's trade-signal-derived market values; `published` flag gates viability; `playerId` ID space inherited from trade observation sources |

**Sources NOT used in F2.4:**
- `AllFantasyAdpSnapshot` — from AF's own draft picks (different context; `playerKey` format differs from roster player IDs); deferred to future ticket
- `AiAdpSnapshot` / `AiAdpSnapshotHistory` — AI-computed (P3: AI never generates deterministic facts)
- `AiPlayerMarketMetric` — AI-produced; same P3 exclusion
- `SportsPlayerRecord.adp` — legacy table; not the authoritative source
- `DevyAdp` — devy-only table; niche use case; deferred

### 2.1 ADP format mapping (from `lib/workers/adp-importer.ts`)

The ADP importer writes these known `format` + `scoring` combinations:

| `format` | `scoring` | League type |
|---|---|---|
| `'redraft'` | `'standard'` | Standard redraft |
| `'redraft'` | `'ppr'` | PPR redraft |
| `'redraft'` | `'half-ppr'` | Half-PPR redraft (note: hyphen, not underscore) |
| `'redraft'` | `'2qb'` | Two-QB redraft |
| `'dynasty'` | `'standard'` | Standard dynasty |
| `'dynasty'` | `'superflex'` | Superflex dynasty |

Mapping from `LeagueFacts`:
- `isDynasty → format = 'dynasty' | 'redraft'`
- `scoringPresetId`:
  - `'ppr'` → `scoring = 'ppr'`
  - `'half_ppr'` → `scoring = 'half-ppr'` (note: ADR normalizes underscore to hyphen)
  - `'standard'` → `scoring = 'standard'`
  - `null/unknown` → scoring format indeterminate; carry all, warn `adp_scoring_format_unknown`

### 2.2 `AllFantasyMarketPlayerValue` ID space

The `playerId` in `allFantasyMarketPlayerValue` derives from `gatherOfficialObservations()` which
traces back to trade-signal data. The exact canonical ID alignment with roster player IDs is not
verified at F2.4 design time — the port loads by `playerId + sport + published:true` and a miss is
an honest degrade (null + warning), never fabricated.

## 3. Freeze compliance — why this is ADDITIVE

- No change to pure `CanonicalWorld`, assembler, or any Phase-1 frozen contract.
- No change to F2.1 `EnrichedCanonicalWorld` or any prior F2.x view.
- New `RawAdpRow` + `RawMarketValueRow` fact types — allowed.
- New `loadAdpRows` + `loadMarketValueRows` port functions — read-only, no writes.
- New `AdpEnrichedCanonicalWorld` derived view — additive, layers on F2.1 `EnrichedCanonicalWorld`.
- No writes, no provider branch, no cache warming, no live API calls.
- No change to Phase E trade enrichment (`lib/decision-os/trade/loader.ts`) — it continues using its
  own `loadAdpRecords()` independently; this world layer creates a parallel read path.

## 4. Format-contextual ADP selection (pure, deterministic)

The projector selects the best ADP row for each player by priority:

1. **Exact match**: rows where `format === derivedFormat` AND `scoring === derivedScoring`
2. **Same-format fallback**: rows where `format === derivedFormat` (any scoring) + `adp_scoring_format_mismatch` warning
3. **Any-format fallback**: any row + `adp_format_mismatch` warning
4. **No rows**: null + `adp_unavailable` warning

Within each tier, pick the freshest by `createdAt DESC`. Carry `format` and `scoring` as provenance
(never stripped — consumers can audit which format the ADP came from).

### 4.1 Staleness (createdAt-based, no expiresAt)

`AdpDataRecord` has no `expiresAt`. Staleness is estimated from age:
- `createdAt` > 7 days ago → `isStale: true`, `staleReason: 'adp_age_exceeded_7_days'`
- `createdAt` within 7 days → `isStale: false`
- `createdAt` null → `isStale: null`, `staleReason: 'adp_freshness_unavailable'`

## 5. Decision

Add `lib/decision-os/world/adpEnrichedWorld.ts` (pure projectors + types + read-only resolver),
plus additive additions to `facts.ts` and `port.ts`:

**`facts.ts` additions:**
```typescript
interface RawAdpRow {
  playerId: string
  adp: number
  adpChange: number | null
  adpSpread: number | null
  confidenceScore: number | null
  providerCount: number | null
  format: string
  scoring: string
  season: number
  week: number
  source: string
  createdAt: Date
}
interface RawMarketValueRow {
  playerId: string
  marketValue: number
  baseValue: number
  adjustmentPercent: number
  confidence: number
  sampleSize: number
  direction: string
  leagueConcept: string
  scoringFormat: string | null
  generatedAt: Date
  updatedAt: Date
}
```

**`port.ts` additions:**
- `loadAdpRows(sport, ids)` — reads `AdpDataRecord` by `playerId + sport`, ordered by `createdAt desc`.
  Returns ALL format/scoring rows (format selection happens in the projector). Single `findMany`, read-only, no writes.
- `loadMarketValueRows(sport, ids)` — reads `AllFantasyMarketPlayerValue` by `playerId + sport + published:true`.
  Returns freshest row per player (ordered by `generatedAt desc`). Single `findMany`, read-only.

**`adpEnrichedWorld.ts` (new file):**
- Types: `AdpFreshness`, `AdpContext`, `MarketValueContext`, `AdpMarketContext`, `AdpEnrichedPlayer`,
  `AdpEnrichedRosterFacts`, `AdpEnrichmentSummary`, `AdpEnrichedCanonicalWorld`.
- Pure: `deriveAdpFormat(isDynasty)` — 'dynasty' | 'redraft'.
- Pure: `deriveAdpScoring(scoringPresetId)` — maps known presets; null for unknown.
- Pure: `selectBestAdpRow(rows, format, scoring)` — tiered selection as per §4.
- Pure: `projectAdpFreshness(row, now)` — age-based staleness computation.
- Pure: `projectAdpContext(adpRows, format, scoring, now)` — builds `AdpContext`.
- Pure: `projectMarketValueContext(row, now)` — builds `MarketValueContext`.
- Pure: `projectAdpEnrichedWorld(world, adpResult, marketResult, leagueFacts)` — folds onto F2.1.
- Read-only: `resolveAdpRows(sport, ids, port?)` + `resolveMarketValueRows(sport, ids, port?)`.
- Read-only: `resolveAdpEnrichedCanonicalWorld(leagueId, deps?)` — chains F2.1 → gather ids →
  resolve both seams → project. Never throws.

## 6. Field scope

| Field | Source | Degradation |
|---|---|---|
| `adpContext.adp` | `AdpDataRecord.adp` | null + `adp_unavailable` |
| `adpContext.adpChange` | `AdpDataRecord.adpChange` | null (optional field) |
| `adpContext.adpSpread` | `AdpDataRecord.adpSpread` | null (optional field) |
| `adpContext.confidenceScore` | `AdpDataRecord.confidenceScore` | null (optional field) |
| `adpContext.providerCount` | `AdpDataRecord.providerCount` | null (optional field) |
| `adpContext.format` | `AdpDataRecord.format` | null + `adp_format_unknown` |
| `adpContext.scoring` | `AdpDataRecord.scoring` | null + `adp_scoring_unknown` |
| `adpContext.freshness.isStale` | age-based (`createdAt > 7d`) | null when `createdAt` absent |
| `marketValueContext.marketValue` | `AllFantasyMarketPlayerValue.marketValue` | null + `market_value_unavailable` |
| `marketValueContext.direction` | `AllFantasyMarketPlayerValue.direction` | null |
| `marketValueContext.confidence` | `AllFantasyMarketPlayerValue.confidence` | null |
| `marketValueContext.freshness.isStale` | `generatedAt > 24h` | null when `generatedAt` absent |

## 7. Deliverables

1. This ADR.
2. `facts.ts` — add `RawAdpRow`, `RawMarketValueRow`.
3. `port.ts` — add `loadAdpRows`, `loadMarketValueRows`.
4. `adpEnrichedWorld.ts` — new derived view.
5. `world/index.ts` — re-exports.
6. Tests: ADP format selection tiers, missing ADP, stale ADP, market value, no-mutation, origin-blind
   shape, resolver-never-throws, read-only architecture guard.
7. Non-prod conformance re-run (all 5 scripts GREEN).
8. Real-data coverage probe (`scripts/probe-adp-coverage.ts`) + results documented here (§10).

## 8. Success

Canonical World exposes deterministic ADP and market values where available, with format/scoring
provenance, freshness, and honest degradation, while every Phase-1 frozen invariant and all
conformance checks remain GREEN.

## 9. Registry

No `DECISION_REGISTRY.md` row — substrate enrichment, not a decision slice.

## 10. Real-data results (non-prod `ep-winter-salad`, 2026-06-30)

**ADP coverage probe (`scripts/probe-adp-coverage.ts`):**

| Metric | Value |
|---|---|
| Total `AdpDataRecord` rows | 23,716 |
| Fresh (<7 days) | **0** (all stale — newest from 2026-06-23, 7+ days ago) |
| Top format/scoring | redraft/standard (14,030), dynasty/standard (3,326), redraft/2qb (2,879), dynasty/superflex (1,704), redraft/ppr (682), redraft/halfPPR (574), standard/ppr (521 — csv_import) |
| Top sources | consensus (10,159), espn (5,088), sleeper (4,612), ffc (1,720), fantrax (934), mfl (682) |
| Season | 2026 (23,195), 2025 (521) |
| `AllFantasyMarketPlayerValue` total | **0** (no published market values on non-prod) |

**FINDING F2.4-1 (scoring normalization, corrected pre-commit):**
The `AdpDataRecord` has `halfPPR` (camelCase) as the scoring value for half-PPR — not `half-ppr` (hyphen)
as initially documented. This is written by the FFC importer: `['half-ppr', 'redraft', 'halfPPR']`.
`deriveAdpScoring` was updated to map `'half_ppr'` / `'half-ppr'` → `'halfPPR'` to match the DB.

**FINDING F2.4-2 (ADP staleness — expected, benign):**
All 23,716 ADP rows are stale by the 7-day threshold on non-prod (newest from 2026-06-23). The
`isStale: true` + `adp_age_exceeded_7_days` warning surfaces correctly — this is a cache-population
gap not a logic gap. Production ADP runs daily from the cron.

**FINDING F2.4-3 (market values — staging gap):**
`AllFantasyMarketPlayerValue` has 0 published rows on non-prod. The market-value enrichment will
return `market_value_unavailable` for all players on staging — honest degrade (P2 compliant).
Market values are computed from trade signals in production; the recalculation job has not run on
the staging branch.

**FINDING F2.4-4 (ADP ID space — coverage on imported Sleeper league):**
The Sleeper ADP source (4,612 rows) uses Sleeper player IDs. The imported KBI Smoke Black league
player IDs are Sleeper numeric IDs. Coverage for the imported league depends on whether those
specific player IDs exist in the Sleeper-sourced ADP rows. On staging, ADP was last refreshed
2026-06-23 — the imported Sleeper roster playerIds may or may not match. Any miss is an honest
degrade (`adp_unavailable`), never fabricated.

**Five conformance scripts — all GREEN on both origins:**
`WORLD_CONFORMANCE_OK` / `LINEUP_CONFORMANCE_OK` / `WAIVER_CONFORMANCE_OK` / `COMMISSIONER_CONFORMANCE_OK` / `TRADE_CONFORMANCE_OK` — every Phase-1 frozen invariant intact after F2.4 additions.
