# Decision OS — ARCHITECTURE FREEZE

**Status:** FROZEN as of 2026-06-29. Branch `g15-event-foundation`.
**Milestone:** roadmap step 1.5 (between Validation ✅ and Canonical Enrichment).
**Authority:** this document governs ALL subsequent Decision OS work. It is referenced by every future ADR.

---

## Why now

All four decision slices are real-data validated, read-only, on BOTH native-AF and imported-provider
leagues — the question "can this architecture support every decision slice across origins?" is answered
empirically, not by design intent:

| Slice | Native AF | Imported Sleeper | Proof |
|---|---|---|---|
| Trade | ✅ | ✅ | `TRADE_CONFORMANCE_OK` (F.0 `5949b1f68`, E.5 `663c9daa0`) |
| Lineup | ✅ (`redraft_native`) | ✅ (`canonical_world` bridge) | `LINEUP_CONFORMANCE_OK` (F.1 `06e2d1cdf`) |
| Waiver | ✅ | ✅ | `WAIVER_CONFORMANCE_OK` (F.1 `06e2d1cdf`) |
| Commissioner | ✅ | ✅ | `COMMISSIONER_CONFORMANCE_OK` (F.1 `06e2d1cdf`) |

From this point the architecture is **stable**. The remaining work is additive — richer deterministic
facts, proving them, and a governed cutover — NOT proving the core is sound.

## The rule

> **Future tickets may ENRICH these components but may NOT redesign them without an explicit ADR that
> proposes the architectural change and is approved before implementation.**

No silent redesigns. No "maybe we should move this responsibility." No reshaping a contract mid-ticket.
A change that touches a frozen invariant STOPS and opens an ADR first.

## Frozen components & invariants

1. **Canonical World** (`lib/decision-os/world/`) — origin-blind, read-only, storage-less derived fact
   layer. Pure layer imports no prisma; `port.ts` is find\*-only. No writes, ever.
2. **Canonical Asset** (`lib/decision-os/world/assets.ts`) — the provider-agnostic asset contract
   (`AfLeagueTradeItem → CanonicalAsset → TradeMovement`).
3. **Origin Blindness (P1a)** — assembled FACTS never reveal or branch on provider. Provider lives ONLY
   in `provenance`. (Enforced by `canonical-world-architecture.test.ts`; F0-1 closed the
   `scoringSettings` leak via purpose-blind key allow-listing.)
4. **Purpose Blindness (P1)** — the substrate owns FACTS; decision-specific *interpretation* (e.g.
   `MarketContext`) lives in the decision-specific World, never in Canonical World.
5. **Enrichment-as-truth (P2)** — unsourced fields degrade to null + uncertainty; they are NEVER
   fabricated.
6. **AI governance (P3)** — AI may summarize, explain, prioritize, or communicate deterministic
   decisions. AI may NEVER generate, replace, or fabricate deterministic facts used by the Decision OS.
7. **Decision Object (DCO)** — the four-answers contract + rule verdicts + telemetry flags; the shared
   shape every slice emits (`Canonical World → decision-specific World → Memo → Decision Object →
   Explainability(AI) → Telemetry`).
8. **Shadow Validation** — slices run BESIDE the legacy path, compute wrap-fidelity parity, emit
   telemetry, and NEVER mutate or alter the legacy response. Gated behind per-slice shadow flags.
9. **Read-only ports / identity resolution** — origin-blind read-only resolvers (`resolveCanonicalWorld`
   find\*-only; `resolveRedraftRosterLookupReadOnly`; the roster-identity join direct→team→manager). No
   owner repair, no write path in any read seam.
10. **ADR-first workflow** — ADR → Build → Validate → Enrich → Cutover. Every major phase opens with an ADR.

## What is ALLOWED without a new architectural ADR (additive only)

- New **read-only** ports/seams that read already-persisted data (no live provider calls, no cache
  warming, no writes).
- New **deterministic facts / enrichment** projected into existing contracts, degrading honestly when a
  source is missing.
- New conformance/validation scripts and tests.
- New decision-specific Worlds that consume Canonical World facts (never the reverse).

## What REQUIRES an architectural ADR (frozen surface)

- Any WRITE to Canonical World, or giving the substrate a storage of its own.
- Any provider-specific branch in fact assembly or any decision rule.
- Changing a fact contract shape, the DCO contract, or the shadow/parity model.
- Promoting any shadow path to a live cutover (cutover is its own governed phase).
- Moving a responsibility across the layer boundary (substrate ↔ decision-specific World ↔ decision).

## Next (governed)

Roadmap: **1 Validation ✅ → 1.5 Architecture Freeze (this) → 2 Canonical Enrichment → 3 Re-validation →
4 Cutover Planning.** Phase 2 enrichment proceeds incrementally — player metadata → schedule/bye →
injuries → ADP/market values → projections → weather → news → league intelligence — each plugged into the
same deterministic, honest-degradation framework, each preserving every invariant above.
