# ADR-DOS-F2.1 — Canonical Enrichment: Player Metadata Foundation

**Status:** Accepted (2026-06-30). Branch `g15-event-foundation`.
**Phase:** 2 (Canonical Enrichment), layer **F2.1** — the root dependency. NOT cutover, NOT a redesign.
**Governed by:** `ARCHITECTURE_FREEZE.md`. **Builds on:** D.1 metadata seam (`aa2ffef19`), `PHASE_1_COMPLETE.md`.

---

## 1. Goal

Expose deterministic player metadata (name / position / eligible positions / team / sport / status) on the
Canonical World, read-only, with provenance + freshness + honest completeness — so every downstream slice
(and later enrichment layer) can consume *who the player is* from one origin-blind place. Metadata is first
in Phase 2 because every later layer (schedule, injuries, market, projections) is keyed to a resolved player.

## 2. Freeze compliance — why this is ADDITIVE, not a redesign

The frozen substrate carries **raw player ids only**; `RosterFacts.playerMetadataEnriched` is `false` and
the pure assembler does no IO (D.2 invariant, enforced by `canonical-world-architecture.test.ts` +
`canonical-world-validation.test.ts`). F2.1 **does not change that.** It adds, alongside the pure world:

- a NEW read-only resolver that reads already-persisted data (the `SportsPlayer` cache via the existing
  D.1 `resolvePlayerMetadata` / `loadPlayerMetadataRows` seam — **no new source, no live API, no cache
  warming, no writes**), and
- a NEW derived **view type** (`EnrichedCanonicalWorld`) that projects metadata onto the world's player ids
  with honest degradation.

Per `ARCHITECTURE_FREEZE.md` §"allowed without an architectural ADR", both — "new read-only ports reading
already-persisted data" and "new deterministic facts/enrichment projected into existing contracts,
degrading honestly" — are explicitly permitted. The pure `CanonicalWorld` contract, the pure assembler,
origin-blindness, purpose-blindness, P2/P3, and the read-only guarantee are all untouched. This ADR is
written anyway because the freeze asks every Phase-2 ticket to open with one.

**What this ADR does NOT do:** mutate `RosterFacts`/the pure assembler, flip `playerMetadataEnriched` on
the pure world, branch on provider, write anything, or change any decision/cutover.

## 3. Decision

Add `lib/decision-os/world/enrichedWorld.ts` (pure projector + types) and a read-only resolver:

- **Types (new view, additive):** `EnrichedPlayer { playerId; name; position; eligiblePositions; team;
  sport; injuryStatus; resolved; source }` and `EnrichedRosterFacts = RosterFacts & { players:
  EnrichedPlayer[]; playerMetadataEnriched: boolean; metadataCompleteness: number }` and
  `EnrichedCanonicalWorld = Omit<CanonicalWorld,'rosters'> & { rosters: EnrichedRosterFacts[];
  metadata: { requested; resolved; completeness; warnings } }`.
- **Pure projector `projectEnrichedWorld(world, metadata: PlayerMetadataResult)`** — folds the resolved
  metadata onto each roster's `playerIds`, sets per-roster `playerMetadataEnriched` true ONLY when every
  player resolved required fields (name+position), computes `metadataCompleteness` = resolved/total, and
  surfaces warnings. No IO; deterministic; origin-blind (keyed by player id, never provider).
- **Read-only resolver `resolveEnrichedCanonicalWorld(leagueId, deps?)`** — `resolveCanonicalWorld` →
  gather the union of all roster player ids → `resolvePlayerMetadata(world.league.sport, ids)` →
  `projectEnrichedWorld`. NEVER throws (a miss degrades to an unenriched view); injectable deps for tests.

**Rejected alternative:** enriching inside the pure assembler / mutating `RosterFacts`. That would flip the
frozen `playerMetadataEnriched=false` invariant and put IO-derived data into the pure layer — a redesign of
a frozen contract, which the freeze forbids without an architectural ADR. The derived-view approach gets the
same capability additively.

## 4. Field scope & honest degradation (P2 — never fabricate)

| Field | Source | Degradation |
|---|---|---|
| name, position | `SportsPlayer` cache (`name`,`position`) | null + `player_metadata_missing` when unresolved |
| team | cache (`team`) | null when absent |
| status / injury | cache (`status`) — **"if already available"** per ticket | null when absent (NOT a live injury feed — that's F2.3) |
| sport | `world.league.sport` (a fact) | always present |
| eligiblePositions | **derived** = `position ? [position] : []` | the cache carries a single `position`; true multi-slot eligibility is **not sourced** → flagged `eligible_positions_degraded` (real-data gap; a later layer or roster-slot derivation fills it) |
| provenance | per-player `source`; world `provenance` + `freshness` | source null when unresolved |
| byeWeek, projections, ADP, market, weather, news | **OUT OF SCOPE** (F2.2/F2.4/F2.5/F2.6/F2.7) | not read here; remain null elsewhere, never fabricated |

`metadataCompleteness` (0–100) is resolved/total per roster + world-level — honest, bounded, never inflated.

## 5. Deliverables

1. This ADR.
2. Additive impl: `enrichedWorld.ts` (types + pure projector + read-only resolver); re-export from
   `world/index.ts`. No change to the pure assembler/port contract.
3. Tests: metadata resolution (full), missing metadata (honest incomplete), provenance/source, freshness
   carry, eligible-positions degrade, world-level completeness, origin-blind (native≡imported shape), and
   a read-only/no-write architecture guard (the new file imports no prisma; resolver is find\*-only).
4. Re-run conformance on native + imported (world conformance unchanged-green; a new optional enriched
   probe records real coverage).
5. Document real-data gaps (eligible-positions degraded; metadata coverage on imported vs native — the
   imported lineup run already showed `scanIncomplete` until the cache resolves Sleeper ids).

## 6. Success

Canonical World exposes deterministic player metadata where available, read-only, with provenance +
freshness + honest completeness, while every Phase-1 frozen invariant is preserved (pure world unchanged,
no writes, no provider branch, no cutover).

## 7. Real-run results (non-prod `ep-winter-salad`, 2026-06-30)

`resolveEnrichedCanonicalWorld` against real leagues; `WORLD_CONFORMANCE_OK` unchanged (the pure world is
untouched). Coverage:

| League | provider | players | resolved | name | pos | team | injury |
|---|---|---|---|---|---|---|---|
| KBI Smoke Black (`50d5c56d…`) | sleeper | 192 | **192/192 (100%)** | 192 | 192 | 163 | 192 |
| `4a1853d7…` | manual | 12 | **12/12 (100%)** | 12 | 12 | 10 | 11 |
| `tc-nfl-league` | allfantasy | 40 | **0/40 (0%)** | 0 | 0 | 0 | 0 |

This is the concrete payoff: the imported lineup run (F.1) reported `scanIncomplete` because the world
carried ids only — F2.1 now resolves all 192 Sleeper ids from the cache. **Real-data gaps (documented,
honest degradation — never fabricated):**
- **Coverage depends on the `SportsPlayer` cache being populated for the league's id space.** `tc-nfl-league`
  (native AF) resolves 0/40 — its player ids are not present in the cache, so every field degrades to null
  + `player_metadata_missing`. Same class of gap as D.1; closing it is a cache-population concern (import/
  cron), NOT an enrichment-logic change.
- **`team` is partial even on resolved leagues** (Sleeper 163/192) — null team is carried honestly.
- **`eligible_positions_degraded`** everywhere — single-position-derived; multi-slot eligibility unsourced.
- **`bye_week_unavailable` / `projection_unavailable`** — out of F2.1 scope (F2.2 / F2.5).

## 8. Registry

No `DECISION_REGISTRY.md` row — substrate enrichment, not a decision slice.
