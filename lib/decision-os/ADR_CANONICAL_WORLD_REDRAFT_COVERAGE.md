# ADR — Canonical World Redraft Roster Coverage

- **Status:** Accepted (architecture only — **no implementation in this change**)
- **Date:** 2026-06-29
- **Scope:** Decision OS · Phase 2 Canonical World substrate (`lib/decision-os/world/`)
- **Deciders:** AllFantasy (product owner) + Decision OS architecture
- **Supersedes / relates to:** `PHASE_2_CANONICAL_BRIDGE_ARCHITECTURE.md`, `PHASE_E_TRADE_BRIDGE_ARCHITECTURE.md`
- **Registry:** No new `DECISION_REGISTRY.md` row — this is a **substrate** change, not a new decision slice. It increases the input coverage of the existing four slices.

---

## 1. Context

The Canonical World (`lib/decision-os/world/`) is the origin-blind fact layer every Decision OS slice
(lineup, waiver, trade, commissioner) builds on. Its read-only data-access port
([`port.ts`](world/port.ts)) resolves a league's rosters from exactly one table:

```
defaultCanonicalWorldPort.loadRosters →  prisma.roster.findMany({ where: { leagueId } })
                                          → reads Roster.playerData (JSON blob)
```

The pure assembler ([`assemble.ts`](world/assemble.ts)) then projects `Roster.playerData` into
starter/bench/reserve/taxi slots via [`projectRosterSlots`](world/derive.ts), which expects the
canonical blob shape `{ players, starters, reserve, taxi }` (or a legacy `string[]`).

AllFantasy persists roster ownership in **two** stores, depending on league origin:

| Storage location | Used by |
|---|---|
| `Roster.playerData` (JSON blob) | imported/provider leagues + some native AF leagues |
| `RedraftRoster` + `RedraftRosterPlayer` (relational rows) | native AF **redraft** leagues |

The canonical port reads **only the first**. Any native redraft league whose players live in
`RedraftRosterPlayer` therefore resolves to an **empty canonical roster** — not an error, a clean but
false "this league has no players." This is a **substrate coverage gap**, not a Decision OS engine
defect: the rules engine, TradeWorld, parity, and telemetry are all correct; they are simply being
handed empty rosters for a class of real leagues.

This ADR resolves the gap. It does **not** implement it.

---

## 2. Real-data evidence

From the first real-data Decision OS validation (2026-06-29, commit `63732511a`, non-prod staging host
`ep-winter-salad`):

- **World conformance GREEN** (`WORLD_CONFORMANCE_OK`) for 5 real leagues whose players live in
  `Roster.playerData` — origin-blind shape identical across `allfantasy` / `manual` /
  `allfantasy_test_adp_seed`, no provider leak, bounded completeness, zero fabrication.
- **Trade conformance GREEN** (`TRADE_CONFORMANCE_OK`) — but a 55-league read-only probe found only
  **7/55 leagues trade-stageable** (two rosters holding players). The rest resolved empty.
- The empties are **not** dataless leagues. Spot-checked native redraft leagues hold players in the
  redraft store: e.g. `rwr-runtime-nfl-redraft-league` = **21 `RedraftRosterPlayer` rows but 0 canonical
  roster players**; `tc-nfl-league` = **5 `RedraftRoster` rows but 0 `Roster` rows**. The data exists;
  the substrate cannot see it.
- The lineup path already side-steps this by reading `RedraftRoster` directly (see §13), which is why
  lineup behaves while the canonical World does not — confirming the gap is **isolated to the World
  port's read surface**, nothing downstream.

Conclusion supported by the data: *the engine is correct; the substrate's read coverage is incomplete.*

---

## 3. Options considered

### Option A — Port-side read adapter (read-only, additive)
Teach the Canonical World port to **also** read `RedraftRoster` + `RedraftRosterPlayer`, projecting
those rows into the **same `RawRosterRow` shape** the existing pure assembler already consumes. The
orchestrator unions the two roster sources. The pure assembler and `projectRosterSlots` are unchanged.

- Read-only · additive · no migration · no backfill · no dual-write · no league-creation change.
- Preserves the origin-blind contract (a redraft-sourced world has the **identical** fact shape).
- Directly raises real-data validation coverage (more leagues resolve non-empty).
- Validatable with the **existing** conformance scripts.

### Option B — Storage unification / backfill (write-bearing)
Eliminate the split at the source: dual-write `Roster.playerData` whenever a native redraft league
mutates, and backfill every existing redraft league into `Roster.playerData`.

- Write-bearing · requires a data migration · touches league creation / draft finalization /
  trade settlement / waiver processing paths.
- Higher risk, broader blast radius, and introduces a **dual-store consistency obligation** (two
  sources of truth that can diverge).
- May still be desirable **later** purely as a data-model simplification — but it is **not** required
  to close the Decision OS coverage gap.

---

## 4. Decision

**Adopt Option A now.** Specifically (architecture; implementation is a separate ticket):

1. Extend [`CanonicalWorldPort`](world/port.ts) so `loadRosters(leagueId)` returns rosters from **both**
   `Roster` and `RedraftRoster`/`RedraftRosterPlayer`, each projected into the existing `RawRosterRow`
   contract. `Roster` rows win on owner-identity conflict; redraft rows fill the gap where no canonical
   `Roster` exists for that owner. (See §7 for the mapping and the union/dedupe rule.)
2. Add a **provenance-only** per-roster source tag (`RawRosterRow.sourceModel?: 'Roster' | 'RedraftRoster'`)
   so [`assembleProvenance`](world/assemble.ts) reports `RedraftRoster` / `RedraftRosterPlayer` in
   `provenance.sourceModels` when it actually read them — honest provenance, never a decision input
   (preserves purpose-blindness / P1).
3. **No change** to the pure assembler's fact-producing logic, to `projectRosterSlots`, to the
   origin-blind `RosterFacts` shape, or to any slice.

**Defer Option B** as a separate, explicitly-scoped data-model migration, undertaken only if/when the
dual-store maintenance cost justifies it. It is out of scope here.

---

## 5. Why Option A now

- **It matches what we just proved.** Validation showed the engine is correct and the gap is purely a
  read-surface omission. The minimal correct fix is to widen the read surface, not to migrate data.
- **It is consistent with the substrate's load-bearing invariants.** The World is read-only-as-structure
  (the port has no write methods; `assemble.ts` imports no prisma), origin-blind (origin lives only in
  `provenance`), and purpose-blind (P1). A read adapter that projects redraft rows into the same
  `RawRosterRow` and tags provenance honors all three. A backfill (Option B) would inject writes into
  the very layer whose read-only guarantee we just validated.
- **Precedent + reference mapping already exist.** The lineup world resolves redraft rosters today
  (`resolveRedraftRosterConfig`; `lib/redraft/*` read `RedraftRosterPlayer` with the `slotType`
  vocabulary in §7). Option A copies a known-safe read mapping — no new data semantics invented.
- **Lowest blast radius.** One module (the port) plus one provenance-only field. The pure assembler,
  the four slices, and all parity/telemetry are untouched.
- **Immediately measurable.** Re-running the existing conformance scripts will show stageable-league
  coverage rise and trade conformance stop skipping native redraft leagues — empirical proof on the
  same harness, no new test infrastructure.

---

## 6. Why Option B is deferred

- It is **write-bearing** and requires a **migration/backfill** — exactly the risk class this validation
  effort has deliberately stayed clear of (the hard rules across this work are: no writes, no backfill,
  no league-creation changes).
- It creates a **two-sources-of-truth** obligation (`Roster.playerData` *and* `RedraftRoster` both
  authoritative) that must then be kept consistent on every draft finalize / trade settle / waiver
  process — new, ongoing correctness surface for zero additional Decision OS capability beyond what
  Option A already delivers.
- Its only genuine benefit is **data-model tidiness** (one store), which is a legitimate but
  independent motivation. It should stand on its own cost/benefit, not ride in on a coverage fix.
- Option A does not block Option B. If unification is later chosen, the read adapter simply finds
  everything in `Roster` and the redraft branch becomes a no-op — Option A degrades gracefully into the
  unified world.

---

## 7. Data flow

**Today (single source):**
```
resolveCanonicalWorld(leagueId)
  └─ port.loadRosters → prisma.roster.findMany           → RawRosterRow[]   (Roster.playerData only)
        └─ assembleCanonicalWorld → projectRosterSlots(playerData) → RosterFacts[]
```

**After Option A (additive union; assembler unchanged):**
```
resolveCanonicalWorld(leagueId)
  └─ port.loadRosters
        ├─ A. prisma.roster.findMany           → RawRosterRow[] (sourceModel:'Roster')
        └─ B. prisma.redraftRoster.findMany({ include: { players: true } })
                                               → project → RawRosterRow[] (sourceModel:'RedraftRoster')
        └─ union(A, B) deduped by owner identity; A wins on conflict
  └─ assembleCanonicalWorld → projectRosterSlots(playerData) → RosterFacts[]   (UNCHANGED)
```

**Mapping B → `RawRosterRow`** (so the existing pure assembler consumes it with zero changes):

| `RawRosterRow` field | Source from `RedraftRoster` / `RedraftRosterPlayer` |
|---|---|
| `id` | `RedraftRoster.id` |
| `platformUserId` | `RedraftRoster.ownerId` → drives the existing native team-join (`matchTeamIdForRoster` path #2/#3: `platformUserId` → `LeagueTeam.platformUserId` / `claimedByUserId`) |
| `playerData` | **synthesized** canonical blob `{ players: [...ids], starters: [...], reserve: [...], taxi: [...] }` from `RedraftRosterPlayer` rows (droppedAt = null), grouped by `slotType` (below) |
| `faabRemaining` | `RedraftRoster.faabBalance` (a stored remaining → `deriveFaab` returns `remainingDerived:false`) |
| `waiverPriority` | `RedraftRoster.waiverPriority` (Int; **note** default `0` — see Risks §11 for 0-vs-null honesty) |
| `settings` | `null` (no equivalent blob; honest absence) |
| `sourceModel` *(new, provenance-only)* | `'RedraftRoster'` |

**`RedraftRosterPlayer.slotType` → `RosterSlotProjection`** (vocabulary already used across `lib/redraft/`):

| Projection section | `slotType` tokens (case-insensitive) |
|---|---|
| `reserve` | `IR`, `RESERVE` |
| `taxi` | `TAXI`, `DEVY` |
| `bench` | `BENCH`, `BN` |
| `starters` | anything else (a position token like `QB`/`RB`/… or `starter`/`starters`) |
| `players` | every non-dropped row's `playerId` (union of all of the above) |

Because the synthesized `playerData` is the **canonical blob shape**, `projectRosterSlots` slots it
identically to an imported league — the resulting `RosterFacts` are shape-identical regardless of which
store the players came from. **Raw ids only**: the richer columns `RedraftRosterPlayer` carries
(`position`, `injuryStatus`, `byeWeek`, `team`) are **deliberately not** folded into `RosterFacts`
(`playerMetadataEnriched` stays `false`) — see §11. They remain available to the downstream enrichment
seam (`world/playerMetadata.ts`) on its own terms.

---

## 8. Read-only guarantee

Option A preserves the substrate's structural read-only property:

- The new read uses `prisma.redraftRoster.findMany(... include players ...)` — a **`findMany` only**.
  No `create`/`update`/`upsert`/`delete` is added to the port. The port's interface stays read-only by
  construction.
- It **must not** call `resolveRedraftRosterLookup` — that legacy resolver performs **owner repair via
  `prisma.redraftRoster.update` (a WRITE)**. The port already forbids this (see the note in
  [`port.ts`](world/port.ts) and [`index.ts`](world/index.ts)); the adapter reads `RedraftRoster`
  rows directly with the same pure, write-free `matchTeamIdForRoster` join the assembler already uses.
- The pure assembler (`assemble.ts`) continues to import **no prisma** and perform **no IO**. The only
  assembler-adjacent change is reading a provenance-only `sourceModel` tag — a label, never a write,
  never a decision input.
- No cache warming, no live provider API call, no backfill, no dual-write.

The read-only guarantee therefore remains **structural, not conventional**: nothing the assembler can
reach can write.

---

## 9. Testing strategy (for the future implementation — not built here)

The implementation ticket must prove, with hermetic fixtures + unit tests:

1. Canonical World resolves rosters from `Roster.playerData` (existing behavior preserved — regression).
2. Canonical World resolves rosters from `RedraftRoster` / `RedraftRosterPlayer` (new coverage).
3. Both sources project into the **same `RawRosterRow`** and therefore the **same origin-blind
   `RosterFacts` shape** (key-equality assertion across a `Roster`-sourced and a `RedraftRoster`-sourced
   world — the §1 universal origin-blindness invariant must still hold).
4. `slotType` → starter/bench/reserve/taxi projection is correct (incl. position-token starters, `BN`,
   `IR`/`RESERVE`, `TAXI`/`DEVY`; dropped players excluded).
5. The owner-identity **union/dedupe** rule: a league with both stores does not double-count; `Roster`
   wins on conflict; a redraft-only league surfaces its redraft rosters.
6. **No writes occur** — assert via a port test double / spy that only `findMany`/`findUnique` are
   invoked and `resolveRedraftRosterLookup` / `redraftRoster.update` are never called.
7. **No owner repair occurs** — the write-free `matchTeamIdForRoster` join is the only identity path.
8. The **pure assembler is unchanged** behaviorally (its existing test suite stays green; the only new
   surface is the provenance `sourceModel` tag).
9. `provenance.sourceModels` honestly lists `RedraftRoster` / `RedraftRosterPlayer` when (and only when)
   they were read; no fabrication.
10. Architecture guard: `RosterFacts` still reports `playerMetadataEnriched:false` for redraft-sourced
    rosters (no position/injury leakage into substrate facts).

Run alongside: `__tests__/decision-os/canonical-world-validation.test.ts`,
`canonical-world.test.ts`, `canonical-world-architecture.test.ts`,
`lineup-canonical-bridge.test.ts`, `player-metadata-enrichment.test.ts` — expect green + no regression.

---

## 10. Validation strategy (real-data, read-only)

Re-run the existing gated conformance scripts against non-prod (host-only logging, prod refused):

- `npx tsx scripts/decision-os-world-conformance.ts` — expect `WORLD_CONFORMANCE_OK` with previously
  **empty** native redraft leagues (e.g. `rwr-runtime-nfl-redraft-league`) now reporting non-zero
  rosters/players and a higher completeness; origin-blind shape unchanged.
- `npx tsx scripts/decision-os-trade-conformance.ts` — expect the **stageable-league count to rise**
  above the 7/55 baseline and trade conformance to **stop skipping** native redraft leagues with
  populated `RedraftRosterPlayer`. Determinism parity must stay GREEN.

Acceptance: stageable coverage increases, no new failures, read-only + prod-refusal behavior unchanged.
The before/after stageable count is the headline empirical metric.

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Double counting** when a league has both `Roster` and `RedraftRoster` rows for the same owner | Med | Union deduped by owner identity (`platformUserId`/`ownerId`); `Roster` wins on conflict. Tested in §9.5. |
| **`waiverPriority` default `0`** read as a real "priority 1" when it actually means unset | Low | Treat `0` per existing semantics; if the codebase already treats `0` as unset for redraft, carry that honestly (map `0`→`null`) and document. Decision deferred to implementation with a test pinning the chosen rule. |
| **Metadata leakage** — temptation to fold `RedraftRosterPlayer.position`/`injuryStatus`/`byeWeek` into `RosterFacts`, breaking origin-blindness (imported rosters lack these inline) | **High (architectural)** | Hard rule: substrate projects **ids only**; `playerMetadataEnriched` stays `false`. Richer columns are for the downstream enrichment seam, not the fact layer. Guard test §9.10. |
| **Provenance dishonesty** — world claims it read `Roster` when it read `RedraftRoster` | Med | Provenance-only `sourceModel` tag drives `sourceModels`; test §9.9. |
| **`slotType` vocabulary drift** between `lib/redraft` and the adapter | Low | Reuse the existing token sets (`BENCH/BN`, `IR/RESERVE`, `TAXI/DEVY`); cite them in code; test §9.4. |
| **Performance** — extra `findMany` with `include: players` per resolve | Low | One additional indexed query (`RedraftRosterPlayer.@@index([rosterId])`); read-only; bounded by league size. |
| **Identity-join misses** for redraft owners whose `ownerId` doesn't match a `LeagueTeam` | Low | Surfaces as the existing `roster_team_unmatched` completeness warning — honest degradation, not an error. |

---

## 12. Rollback

- **Pure code revert.** Option A is additive and lives in the port (+ one provenance field). Reverting
  the commit restores the `Roster`-only read. **No data migration to undo** — nothing was written, so
  rollback has zero data side-effects.
- **No flag flip required**, but the implementation MAY gate the redraft branch behind a read-only env
  switch (e.g. `DECISION_OS_WORLD_REDRAFT_SOURCE`) so it can be disabled in place without a deploy if a
  coverage regression appears. (Recommended but optional; the change is safe to ship un-gated because it
  only widens reads.)
- Because no slice consumes `resolveCanonicalWorld` in production yet (substrate is shadow/validation
  only), rollback cannot affect any live user decision.

---

## 13. Impact on slices

| Slice | Impact |
|---|---|
| **Lineup** (`manager.lineup.set`) | Lineup already reads `RedraftRoster` directly via `resolveRedraftRosterConfig`, so it is unaffected today — but once it migrates onto the canonical World, it inherits redraft coverage **for free** and the two read paths converge (one substrate, not two). |
| **Trade** (`manager.trade.evaluate`) | **Largest beneficiary.** Trade conformance currently skips native redraft leagues (empty rosters → unstageable). Option A makes those leagues stageable, lifting the 7/55 coverage and enabling real trade validation on the native-redraft majority. |
| **Waiver** (`manager.waiver.claim`) | Gains real roster + `faabBalance` + `waiverPriority` for native redraft leagues, unblocking real-data waiver validation on them. |
| **Commissioner** (`commissioner.league.health`) | Sees true roster/team population for redraft leagues, improving health/orphan/abandonment signal accuracy from the substrate. |
| **Chimmy (AI)** | Strictly positive and P3-safe: Chimmy explains deterministic facts; richer canonical coverage means more leagues have real facts to explain. AI still never generates the facts. |
| **Dashboard** | Any future dashboard surface reading the canonical World sees consistent, populated rosters across both league origins — no per-origin special-casing. |

Single read-surface fix; **all** consumers benefit at once. No slice requires a code change to receive it.

---

## 14. Licensing / platform review

- **Principle integrity (the reusable-engine concern):** Option A *strengthens* the properties that make
  the Decision OS licensable beyond AllFantasy — it keeps the substrate read-only-as-structure,
  origin-blind, and purpose-blind while broadening coverage. Option B would have introduced an
  app-specific write/migration into the substrate layer, weakening the clean read-only boundary an
  external licensee would depend on.
- **Provider-agnosticism:** the adapter is an AllFantasy **storage detail** (`RedraftRoster` is a native
  AF table), confined to the AllFantasy port implementation behind the `CanonicalWorldPort` interface. A
  future licensee supplies their own port; the fact contract and assembler — the licensable core —
  remain untouched. This ADR therefore has **no negative platform/SDK impact** and removes a coverage
  caveat from the "Canonical World" maturity line.
- **No new external surface, no data egress, no billing/licensing mechanism touched.**

---

## Hard rules honored by this ADR

No implementation · no migration · no writes · no backfill · no league-creation changes · no Decision OS
cutover · no legacy deletion. This document is architecture only; the build is a separate, scoped ticket.
