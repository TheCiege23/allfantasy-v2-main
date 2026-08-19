# ADR-DOS-F2.3 — Canonical Enrichment: Injury Status / Availability

**Status:** Accepted (2026-06-30). Branch `g15-event-foundation`.
**Phase:** 2 (Canonical Enrichment), layer **F2.3** — additive. NOT cutover, NOT a redesign.
**Governed by:** `ARCHITECTURE_FREEZE.md`. **Builds on:** F2.1 player metadata (`5771a78a1`).

---

## 1. Goal

Expose deterministic player injury / availability context as a third read-only derived enrichment
layer, adding to the F2.1 metadata view:

- player availability category (available / uncertain / unavailable — derived from status string)
- injury status freshness (fetchedAt, expiresAt, updatedAt, isStale, staleReason)
- source / provenance
- honest completeness / uncertainty
- warnings when unavailable or stale

## 2. Source audit (P2 — never fabricate)

Three tables carry injury data keyed by player:

| Table | ID key | Fields | Freshness |
|---|---|---|---|
| `SportsPlayer` (Prisma) | `externalId` / `sleeperId` | `status`, `source`, `fetchedAt`, `expiresAt`, `updatedAt` | `expiresAt` |
| `InjuryReportRecord` (`injury_reports`) | `playerId` (API-Sports ID) | `status`, `bodyPart`, `practice`, `gameStatus`, `notes`, `reportDate` | `reportDate` only |
| `InjuryReport` (`sports_core_injury_reports`) | `playerId` (uncertain ID space) | `status`, `practiceStatus`, `gameStatus`, `bodyPart`, `description`, `fetchedAt`, `expiresAt` | `expiresAt` |

**Critical finding:** `InjuryReportRecord.playerId` and `InjuryReport.playerId` store **API-Sports
player IDs** (from `injury.player?.id` in `lib/workers/providers/api-sports.ts`). These are a
DIFFERENT ID space from `SportsPlayer.externalId` (Sleeper ID) and `SportsPlayer.sleeperId`. There
is no canonical cross-table join key between the injury tables and the roster player IDs carried by
the canonical world without a fuzzy name-based match, which would violate P2.

**Decision:** Use `SportsPlayer` (same seam as F2.1) as the **sole player-id-keyed injury source**
for F2.3. It carries the authoritative injury status string (Sleeper-sourced, e.g. "Q", "O", "IR",
"Active", "Healthy") plus proper freshness timestamps (`expiresAt`, `fetchedAt`, `updatedAt`).
F2.1 already reads this table — F2.3 adds a NEW port function that selects the freshness fields
(`fetchedAt`, `expiresAt`, `updatedAt`) not currently read by F2.1.

**Richer fields (practiceStatus, gameStatus, bodyPart, description) are HONESTLY NULL** — no
player-id-keyed read-only source carries them in a joinable namespace. They are documented as
uncertainty, never fabricated (P2). This is the structural gap; closing it requires either a
canonical cross-reference table or a name-based identity bridge (future work, not F2.3).

## 3. Freeze compliance — why this is ADDITIVE

- No change to pure `CanonicalWorld`, assembler, or any Phase-1 frozen contract.
- No change to F2.1 `EnrichedCanonicalWorld` or `EnrichedPlayer` (new derived view layers ON TOP).
- New `RawInjuryContextRow` fact type — allowed: "new fact types for new enrichment seams".
- New `loadInjuryContextRows` port function — allowed: "new read-only ports reading already-persisted
  data".
- New `InjuryEnrichedCanonicalWorld` derived view — allowed: "new deterministic facts/enrichment
  projected into existing contracts, degrading honestly".
- No writes, no provider branch, no cache warming, no live API calls.

## 4. Availability category derivation (P2 — deterministic, not fabricated)

A pure mapping from the Sleeper-sourced status string to an availability category:

| Status | Category |
|---|---|
| null / empty | `'unknown'` |
| "Active" / "Healthy" / "ACT" | `'available'` |
| "Q" / "Questionable" / "D" / "Doubtful" | `'uncertain'` |
| "O" / "Out" / "IR" / "PUP" / "Sus" / "Suspended" / "NA" / "Inactive" / "NFI" / "COV" | `'unavailable'` |
| unrecognized non-empty string | `'unknown'` (honest: don't fabricate meaning) |

This is a pure deterministic mapping. No AI. No inference. When the status maps to `'unknown'`,
the `uncertainty` list records `'availability_category_unrecognized'`.

## 5. Decision

Add `lib/decision-os/world/injuryEnrichedWorld.ts` (pure projectors + types + read-only resolver),
plus additive additions to `facts.ts` and `port.ts`:

**`facts.ts` addition (additive):**
```typescript
interface RawInjuryContextRow {
  externalId: string
  sleeperId: string | null
  status: string | null
  source: string | null
  fetchedAt: Date | null
  expiresAt: Date | null
  updatedAt: Date | null
}
```

**`port.ts` addition (read-only):**
`loadInjuryContextRows(sport, ids)` — reads `SportsPlayer` by the same OR filter as F2.1 but selects
`fetchedAt`, `expiresAt`, `updatedAt`, `status`, `source`, `externalId`, `sleeperId`. Single
`findMany`, no writes, never throws.

**`injuryEnrichedWorld.ts` (new file):**
- Types: `InjuryAvailabilityCategory`, `InjuryStatusFreshness`, `InjuryContext`,
  `InjuryEnrichedPlayer extends EnrichedPlayer`, `InjuryEnrichedRosterFacts`,
  `InjuryEnrichmentSummary`, `InjuryEnrichedCanonicalWorld extends Omit<EnrichedCanonicalWorld, 'rosters'>`.
- Pure: `deriveAvailabilityCategory(status)` — deterministic, no IO.
- Pure: `projectInjuryContext(row, now)` — builds `InjuryContext` from a `RawInjuryContextRow`,
  computing staleness, setting richer-field slots to null + uncertainty.
- Pure: `projectInjuryEnrichedWorld(world, contextResult)` — folds `InjuryContext` onto each player
  in the F2.1 `EnrichedCanonicalWorld`. Never mutates the base view. Computes per-roster
  `injuryCompleteness` (resolved / total) and `InjuryEnrichmentSummary`.
- Read-only: `resolveInjuryContext(sport, ids, port?)` — loads `RawInjuryContextRow[]`, projects.
  Never throws.
- Read-only: `resolveInjuryEnrichedCanonicalWorld(leagueId, deps?)` — chains F2.1 resolver →
  gather player ids → `resolveInjuryContext` → project. Never throws (misses degrade). Injectable
  deps for tests.

## 6. Field scope & honest degradation

| Field | Source | Degradation |
|---|---|---|
| status | `SportsPlayer.status` (F2.1 seam, same row) | null + `injury_status_unavailable` |
| availabilityCategory | Derived from status | `'unknown'` + `availability_category_unrecognized` |
| freshness.fetchedAt | `SportsPlayer.fetchedAt` | null (F2.1 port currently doesn't select) |
| freshness.expiresAt | `SportsPlayer.expiresAt` | null + `injury_freshness_unavailable` |
| freshness.updatedAt | `SportsPlayer.updatedAt` | null |
| freshness.isStale | `expiresAt < now` | null when expiresAt absent |
| provenance.source | `SportsPlayer.source` | null when unresolved |
| practiceStatus | **NO player-id-keyed source** (API-Sports ID space mismatch) | null + `practice_status_unavailable` |
| gameStatus | Same — no joinable source | null + `game_status_unavailable` |
| bodyPart | Same | null + `body_part_unavailable` |
| description | Same | null + `injury_description_unavailable` |

`injuryCompleteness` (0–100) = players with resolved status / total per roster.

## 7. Deliverables

1. This ADR.
2. `facts.ts` — add `RawInjuryContextRow`.
3. `port.ts` — add `loadInjuryContextRows`.
4. `injuryEnrichedWorld.ts` — new derived view.
5. `world/index.ts` — re-exports.
6. Tests (canonical-world-injury-enrichment.test.ts): full resolution, missing status, freshness /
   staleness, availability category mapping, no-mutation, origin-blind shape (imported ≡ native),
   resolver-never-throws, read-only architecture guard, world/slice conformance unchanged.
7. Non-prod conformance re-run: all 5 scripts GREEN.
8. Real-data coverage documented.

## 8. Success

Canonical World exposes deterministic injury/availability context where available, with freshness
and honest degradation, while every Phase-1 frozen invariant and F2.1 shape is preserved.

## 9. Registry

No `DECISION_REGISTRY.md` row — substrate enrichment, not a decision slice.

## 10. Real-data results (non-prod `ep-winter-salad`, 2026-06-30)

**SportsPlayer coverage probe (`scripts/probe-injury-coverage.ts`):**
- Total rows: 95,839
- Rows with status: 93,620 (97.7%)
- Rows with `expiresAt`: 95,839 (100%)
- Rows with `fetchedAt`: 95,839 (100%)
- Sample source: `rolling_insights`
- Sample `sleeperId`: null (rows keyed by `externalId` only)
- Sample `expiresAt`: 2026-05-01 range → **all rows stale** relative to 2026-06-30 (cache not refreshed in staging — expected)

**Injury status freshness finding (F2.3-FINDING-1 — expected, benign):**
All SportsPlayer rows in staging have proper `expiresAt` and `fetchedAt`, but `expiresAt` dates are from ~May 2026 — they are all stale on non-prod. The F2.3 view surfaces `isStale: true` and `staleReason: 'expired'` for all resolved players, which is the honest-degrade behavior (P2 compliant). This is a **cache population gap**, not a logic gap — production caches refresh continuously. The `uncertainty` array will include `'injury_status_stale'` for every player on staging.

**Completeness prediction for the imported Sleeper league (50d5c56d):**
F2.1 resolved 192/192 players via `externalId` OR `sleeperId`. Since `loadInjuryContextRows` uses the same OR filter on the same table (selecting freshness fields additionally), F2.3 is expected to resolve 192/192 status rows — but all marked stale. `injuryCompleteness` per roster: 0% (resolved = status AND expiresAt non-null; expiresAt is present but stale. Note: `resolved` is set to `status != null && row.expiresAt != null`, which is true — so completeness should reflect resolved even when stale; staleness is a freshness warning, not a resolution failure).

**Five conformance scripts — all GREEN on both origins:**
`WORLD_CONFORMANCE_OK` / `LINEUP_CONFORMANCE_OK` / `WAIVER_CONFORMANCE_OK` / `COMMISSIONER_CONFORMANCE_OK` / `TRADE_CONFORMANCE_OK` — every Phase-1 frozen invariant intact after F2.3 additions.
