# ADR — Phase 6 DNA: `conservative_roster_pattern` Data-Completeness Guard

**Status:** Proposed — awaiting approval. No classifier code has been changed.
**Date:** 2026-07-05
**Governs:** `lib/decision-os/phase6/patterns/patterns.ts`, `lib/decision-os/behavioral/mappers.ts`
**Required by:** `lib/decision-os/ARCHITECTURE_FREEZE.md` — "Changing a fact contract shape... requires an architectural ADR" and this program's established per-ticket ADR discipline for Phase 6.x changes.
**Follows:** `docs/DECISION_OS_MANAGER_DNA_PHASE2J_CLASSIFIER_RAMPUP_AUDIT.md` (the audit that produced this ADR)

---

## 1. Problem statement

Phase 6.2's manager identity classifier (`lib/decision-os/phase6/dna/dna.ts`) can assign `'set_and_forget'` to a manager whose real trade, waiver, and free-agent-roster activity is genuinely high — the exact opposite of what that label should represent. This was measured directly, not inferred: a synthetic manager with 6 redraft trades, 3 waiver claims, and 8 free-agent roster adds classifies as `'committed_grinder'` (confidence 0.55) *until* 6 real lineup-history events (one per week, weeks 1–6, no gaps) are added on top — at which point the identity flips to `'set_and_forget'`, despite nothing about the manager's real engagement having changed (`docs/DECISION_OS_MANAGER_DNA_PHASE2I_READINESS_AFTER_LINEUP_HISTORY.md` §3).

This is not an edge case confined to synthetic data. Per the Phase 2J audit, it fires for **any** manager with 4 or more consecutive real calendar weeks of lineup activity from any of the three currently-wired `lineup_saved` sources — meaning it is *more* likely to misfire for consistently-engaged managers than for sporadic ones.

## 2. Root cause

`lib/decision-os/phase6/patterns/patterns.ts`'s `detectConservativeRosterPattern` (line 536) delegates to `detectConsecutiveWeekPattern` (line 453) with the predicate `(slotChanges) => slotChanges === 0` and `CONSERVATIVE_MIN_WEEKS = 4`. It fires when a manager's last `lineup_saved` event in each of 4+ consecutive calendar weeks reports `slotChanges === 0`.

**Every current mapper that produces a `lineup_saved` event hardcodes `slotChanges: 0`** (and `startedPlayerIds`/`benchedPlayerIds: []`) as an honest placeholder, because none of the three source tables track slot-level change detail:

| Mapper | Source table | `slotChanges` |
|---|---|---|
| `mapRosterMoveToLineupSavedEvent` (Phase 5.1) | `AfRosterMoveHistory` | hardcoded `0` |
| `mapRedraftRosterPlayerToLineupSavedEvent` (Phase 2E) | `RedraftRosterPlayer` (free-agent) | hardcoded `0` |
| `mapRedraftRosterMoveToLineupSavedEvent` (Phase 2H) | `RedraftRosterMoveHistory` | hardcoded `0` |

The detector has no way to distinguish "we don't know how many slots changed" from "zero slots changed" — both arrive as the literal number `0`. `detectConsecutiveWeekPattern`'s own logic is correct and directly tested (`__tests__/decision-os/phase6/behavioral-patterns.test.ts`'s `conservative_roster_pattern` block confirms 4 consecutive weeks of `slotChanges: 0` is intentionally designed to fire) — the defect is entirely in the ambiguity of the input, not in the detection algorithm.

## 3. Why this is a pre-existing latent bug, not a Phase 2H regression

The hardcoded-zero convention has existed since the original Phase 5.1 `AfRosterMoveHistory` mapper — it predates this entire Decision OS Manager DNA de-duplication workstream. It was never exercised at realistic volume because `AfRosterMoveHistory` had near-zero real data (per `ADR_F5_10_STAGING_VERIFICATION.md`'s staging snapshot: the live redraft product doesn't even write to that table — see `docs/DECISION_OS_MANAGER_DNA_PHASE2D_REAL_DATA_READINESS.md`). Phase 2E's free-agent mapper and Phase 2H's lineup-history mapper both faithfully copied the existing convention rather than inventing a new one. Phase 2H's contribution was making a real, credible volume of lineup-history data flow through the pipeline for the first time — which is precisely what made this pre-existing ambiguity observable via Phase 2I's combined-signal readiness test. No code in this workstream introduced the defect; the workstream's own rigor is what surfaced it.

## 4. Options considered

| Option | Assessment |
|---|---|
| **No change** | Rejected as a permanent stance. The bug actively produces a *less accurate* primary identity for genuinely engaged managers, and will affect every consumer eventually migrated onto Phase 6 DNA (AI Coach, Trade Analyzer, Trade Proposal Generator) once that migration happens. Acceptable only as the *current* state while this ADR is reviewed — not a place to stay. |
| **Priority-order change** (reorder `CLASSIFIERS` in `dna.ts` so `committed_grinder`-style positive signals are checked before `set_and_forget`) | Rejected. Treats the symptom (which label wins the race) without fixing the cause (the pattern is still falsely detected). `conservative_roster_pattern` would still corrupt `deriveRiskTendency` (→ `'risk_averse'`), still appear in `derivation`/`traits`, and remain one classifier reorder away from resurfacing the same symptom for a different label pair in the future. |
| **Deployment wait period** (don't trust lineup-based classification until N days post-deploy) | Rejected. Per §3/§2, this bug is not a ramp-up artifact — a manager with an unbroken weekly habit triggers it regardless of how long the feature has been live. Waiting does not resolve it. |
| **Data-completeness guard** (exclude low-completeness `lineup_saved` events from `conservative_roster_pattern` scoring specifically, using each event's already-computed `completeness` field) | **Recommended.** Directly addresses the ambiguity without changing any existing type contract. Uses infrastructure that already exists — every one of the three mappers already reports a lower `completeness` score for these events (via `missingMetadataFieldCount`) *because* slot-level detail is unavailable. This option teaches `detectConservativeRosterPattern` to respect that existing signal instead of ignoring it. |
| **Nullable `slotChanges` contract** (`LineupSavedMetadata.slotChanges: number | null`, update all detectors to treat `null` as "cannot evaluate") | Accepted as the durable long-term direction, deferred to a separate, later ADR. This is the structurally "more honest" fix (an explicit unknown instead of an inferred one via completeness), but it is a fact-contract shape change — explicitly named as ADR-required by `ARCHITECTURE_FREEZE.md` — with a wider blast radius (every current and future consumer of `LineupSavedMetadata`, not just this one pattern detector). Doing it in the same change as the completeness guard would conflate a small, low-risk fix with a larger, contract-level one. |

## 5. Recommended option

**Data-completeness guard**, scoped narrowly:

- Add a minimum-completeness cutoff to `detectConsecutiveWeekPattern`'s (or specifically `detectConservativeRosterPattern`'s) input filtering: exclude `lineup_saved` events whose `completeness` falls below a threshold from contributing toward the "does this week meet the zero-change predicate" check, rather than counting them as satisfying it.
- The exact threshold value, and whether the exclusion is scoped to `detectConservativeRosterPattern` alone or to all four lineup-based pattern detectors (`repeated_lineup_indecision`, `conservative_roster_pattern`, `matchup_overreaction`, `bench_regret_repetition` — see the Phase 2J audit's reachability table), is an implementation-time decision for Phase 2K, not fixed here. `repeated_lineup_indecision` does not need this guard (it only depends on event *count*, which is always real) — the guard should not be applied where it isn't needed.
- This does **not** change `LineupSavedMetadata`'s shape, `BehavioralEvent`'s shape, or any DCO/shadow-model surface named as frozen in `ARCHITECTURE_FREEZE.md`. It is a change to Phase 6.1 pattern-detection *logic* only.

## 6. Behavior-preservation strategy

- **Managers whose lineup-history events genuinely have high completeness** (a future source that *does* track real slot-level changes, should one ever be built) must be completely unaffected by this guard — the fix must be inert once real data exists, not a permanent workaround baked into the detector's design.
- **`repeated_lineup_indecision`** must continue to fire exactly as it does today (it does not depend on `slotChanges` and should not be touched by this guard).
- **Existing correctly-detected `conservative_roster_pattern` cases using real, non-hardcoded `slotChanges` values** (as already exercised by `__tests__/decision-os/phase6/behavioral-patterns.test.ts`'s own fixtures, which pass explicit `slotChanges` values through the `lineupSaved()` test helper) must continue to fire — the guard only excludes *low-completeness* events, it does not disable the pattern outright.
- **The existing `conflicting_signals` warning** (`detectConflicts` in `dna.ts`) should remain in place regardless of this fix — it's a legitimate, independent honesty signal and should not be removed as part of this change.
- No public API response shape changes as a result of this fix — it is entirely internal to the Phase 5→6.1 pipeline.

## 7. Required tests

Carried forward from the Phase 2J audit (`docs/DECISION_OS_MANAGER_DNA_PHASE2J_CLASSIFIER_RAMPUP_AUDIT.md` §6), restated as the acceptance criteria for this ADR's implementation:

1. **Pre-fix regression pin**: a test proving today's behavior explicitly (4+ consecutive weeks of hardcoded-zero `lineup_saved` events currently produces `conservative_roster_pattern`) — establishes the exact baseline the fix changes.
2. **Real-data-still-works test**: events with genuine, non-hardcoded `slotChanges` values (via `behavioral-patterns.test.ts`'s existing `lineupSaved(..., slotChanges)` helper) must still correctly trigger `conservative_roster_pattern` for truly conservative managers after the guard is added.
3. **Completeness-boundary test**: events at, above, and below the chosen completeness threshold, confirming the cutoff behaves as intended and does not accidentally exclude genuinely-complete future events.
4. **`dna.ts`-level re-classification test**: re-run Phase 2I's exact combined scenario (6 trades, 3 waivers, 8 free-agent adds, 6 lineup-history saves across weeks 1–6) and confirm the identity no longer silently flips to `'set_and_forget'` — the manager should classify as `'committed_grinder'` (or, at minimum, the caller must be able to tell the difference between a genuine and a low-completeness-driven pattern detection).
5. **Full regression** of `__tests__/decision-os/phase6/behavioral-patterns.test.ts` and `__tests__/decision-os/phase6/manager-dna.test.ts`, unchanged and green.
6. **Parity/before-after harness** across a battery of realistic scenarios (mirroring the Phase 2C/2F/2I pattern already established in this workstream), including `deriveRiskTendency`'s `'risk_averse'` path, which is the other known consumer of `conservative_roster_pattern`.

## 8. Rollout / risk plan

- **Risk level: Low-to-medium.** This touches Phase 6.1 pattern-detection logic, which is not one of the ten frozen invariants explicitly enumerated in `ARCHITECTURE_FREEZE.md` (Canonical World, Canonical Asset, Origin Blindness, Purpose Blindness, Enrichment-as-truth, AI governance, DCO contract, Shadow Validation, read-only ports, ADR-first workflow) — but Phase 6 as a whole has followed its own per-ticket ADR discipline throughout this program (F6.3, F6.5, etc.), and this ADR follows that same convention rather than assuming Phase 6.1 is exempt from review.
- **No public API response shape changes.** No route, no DCO contract, no shadow/parity model is touched.
- **No database migration required.** This is pure in-memory logic in `patterns.ts`; nothing schema-related changes.
- **Sequencing relative to other open work:** this fix is independent of, and does not require, deploying Phase 2H's `RedraftRosterMoveHistory` migration (still undeployed per Phase 2I §5) or resolving the still-open real-world volume-evidence question (Phase 2F/2G/2I). It can be implemented and tested entirely with synthetic fixtures, exactly as this whole workstream's prior phases have done.
- **Rollback:** trivially reversible — the guard is a filtering condition inside one pattern detector function; reverting it is a single-function diff.
- **Suggested implementation order for Phase 2K:** land the six test categories from §7 first (with test #1 intentionally documenting the pre-fix buggy behavior), then implement the completeness-threshold guard, then confirm tests #1 and #4 flip to their post-fix expected values while #2/#3/#5/#6 remain green throughout.

## 9. Explicit non-goals

- **Not fixing `matchup_overreaction` or `bench_regret_repetition`'s under-detection** (both are currently unreachable given hardcoded `slotChanges`/`startedPlayerIds`/`benchedPlayerIds`, per the Phase 2J audit) — that requires actual slot-level change tracking to be implemented somewhere upstream, a much larger scope than this ADR.
- **Not implementing the nullable `slotChanges` contract** (§4's deferred option) — that is its own, later ADR, once the completeness guard has proven the narrower fix in practice.
- **Not deploying Phase 2H's `RedraftRosterMoveHistory` migration.** That remains a separate, explicit production decision per Phase 2I.
- **Not requesting or performing a staging database query.** Not needed for this fix, which is entirely testable with synthetic fixtures.
- **Not migrating AI Coach, Trade Analyzer, or Trade Proposal Generator.** This ADR concerns Phase 6 DNA's internal correctness only, independent of any consumer migration decision.
- **Not touching Chimmy or `lib/manager-dna.ts`.**
- **Not implementing any classifier priority-order change** (rejected in §4).
- **This ADR does not itself authorize implementation.** Per `ARCHITECTURE_FREEZE.md`'s governance rule, this document is the proposal; Phase 2K should not begin until it is explicitly approved.
