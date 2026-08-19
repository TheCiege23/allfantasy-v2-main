# Manager DNA De-duplication — Phase 2J: Classifier Priority & Ramp-Up Audit

**Status:** Audit only. No classifier code changed. No consumer touched.
**Branch:** `g15-event-foundation`
**Follows:** `docs/DECISION_OS_MANAGER_DNA_PHASE2I_READINESS_AFTER_LINEUP_HISTORY.md`, `lib/decision-os/ARCHITECTURE_FREEZE.md`

## Correction to Phase 2I first

Phase 2I described the `committed_grinder` → `set_and_forget` flip as caused by "coverage gaps in the weeks *after* the manager's real activity." That explanation was imprecise. Having now traced `lib/decision-os/phase6/patterns/patterns.ts` line-by-line, the real mechanism is more specific — and, as shown in §3, meaningfully worse than "a ramp-up gap." This document supersedes that explanation.

## 1. Phase 6 DNA classifier priority/order

`lib/decision-os/phase6/dna/dna.ts`'s `CLASSIFIERS` array (lines 163–172) and `classifyIdentity()` (lines 174–192):

```ts
const CLASSIFIERS: Classifier[] = [
  ['ghost_manager',       scoreGhostManager,       MIN_CONFIDENCE],       // priority 1
  ['set_and_forget',      scoreSetAndForget,        MIN_CONFIDENCE],      // priority 2
  ['reactive_manager',    scoreReactiveManager,     MIN_CONFIDENCE],      // priority 3
  ['indecisive_tinkerer', scoreIndecisiveTinkerer,  MIN_CONFIDENCE],      // priority 4
  ['serial_trader',       scoreSerialTrader,        MIN_CONFIDENCE],     // priority 5
  ['waiver_hawk',         scoreWaiverHawk,          MIN_CONFIDENCE],      // priority 6
  ['trade_seeker',        scoreTradeSeeker,         TRADE_SEEKER_THRESHOLD], // priority 7 (0.40, lower)
  ['committed_grinder',   scoreCommittedGrinder,    MIN_CONFIDENCE],      // priority 8
]

for (const [label, scorer, threshold] of CLASSIFIERS) {
  const score = scorer(patterns, signals)
  const selected = score >= threshold
  derivation.push(`${label}: score=${score.toFixed(3)}, threshold=${threshold}${selected ? ' → SELECTED' : ''}`)
  if (selected) return { label, confidence: Math.min(1, score), derivation }
}
```

**This is first-classifier-to-cross-its-own-threshold-wins, not highest-score-wins.** Unlike legacy `lib/manager-dna.ts`'s `classifyArchetype()` (which scores every archetype whose predicate passes, then picks the highest score — see `docs/DECISION_OS_MANAGER_DNA_PHASE2C_PARITY_FINDINGS.md`), Phase 6.2 never compares `set_and_forget`'s 0.55 against `committed_grinder`'s (unreached, unscored) potential value. `set_and_forget` sits at priority 2, `committed_grinder` at priority 8 — any manager who crosses `set_and_forget`'s threshold first never gets `committed_grinder` evaluated at all, regardless of how much stronger the positive-engagement signal might be.

## 2. Where `conservative_roster_pattern` is detected

`lib/decision-os/phase6/patterns/patterns.ts`, `detectConservativeRosterPattern` (line 536), which delegates to the generic `detectConsecutiveWeekPattern` (line 453):

```ts
function detectConservativeRosterPattern(events: BehavioralEvent[]): DetectedPattern | null {
  return detectConsecutiveWeekPattern(
    events,
    'conservative_roster_pattern',
    (slotChanges) => slotChanges === 0,   // ← the predicate
    CONSERVATIVE_MIN_WEEKS,               // = 4
    ...
  )
}
```

`detectConsecutiveWeekPattern` takes the **last `lineup_saved` event per calendar week**, and looks for a run of **4+ consecutive calendar weeks** (week N, N+1, N+2, N+3 — literally sequential, not just 4 events) where each week's last save has `slotChanges === 0`. This exact mechanism is directly tested and confirmed correct-by-design in `__tests__/decision-os/phase6/behavioral-patterns.test.ts`'s `conservative_roster_pattern` block: 4 consecutive weeks of `slotChanges: 0` fires the pattern; 3 does not; confidence escalates at 4/6/8 weeks. **The detector's own logic is not the bug** — it's built and tested correctly, assuming its input (`slotChanges`) is a real, measured value.

## 3. How this actually produces false `set_and_forget` confidence

**Root cause: every current `lineup_saved` mapper hardcodes `slotChanges: 0` as an honest placeholder for "we don't track slot-level diffs from this source" — and `detectConsecutiveWeekPattern` has no way to distinguish that placeholder from a real, measured zero.**

Confirmed by reading all three current `lineup_saved` mappers in `lib/decision-os/behavioral/mappers.ts`:

| Mapper | Source | `slotChanges` | `startedPlayerIds`/`benchedPlayerIds` |
|---|---|---|---|
| `mapRosterMoveToLineupSavedEvent` (Phase 5.1, original) | `AfRosterMoveHistory` | hardcoded `0` | hardcoded `[]` |
| `mapRedraftRosterPlayerToLineupSavedEvent` (Phase 2E) | `RedraftRosterPlayer` (free-agent) | hardcoded `0` | hardcoded `[]` |
| `mapRedraftRosterMoveToLineupSavedEvent` (Phase 2H) | `RedraftRosterMoveHistory` | hardcoded `0` | hardcoded `[]` |

**This is a pre-existing condition, not something Phase 2H introduced.** The original Phase 5.1 `AfRosterMoveHistory` mapper has had this exact same hardcoded-zero shape since it was built — it was simply never exercised by a readiness measurement rigorous enough to notice, because `AfRosterMoveHistory` had near-zero real data (per `ADR_F5_10`'s staging snapshot) until this workstream started generating synthetic combined-signal scenarios. Phase 2H's `mapRedraftRosterMoveToLineupSavedEvent` faithfully copied the existing convention (as its own commit message documented at the time) — it did not add a new bug, it made an existing one reachable with realistic-looking volume for the first time.

**Why this is worse than "a ramp-up gap," corrected from Phase 2I:** the pattern doesn't need gaps *after* a manager's real activity to fire — it fires directly from the manager's own real activity, as soon as there are 4+ consecutive real calendar weeks of lineup-history events, because every one of those events honestly-but-misleadingly reports `slotChanges: 0`. Re-verified against Phase 2I's own test scenario: 6 lineup-history rows across weeks 1–6 (a solid, unbroken run of activity, not a ramp-up artifact) is already 6 consecutive weeks of `slotChanges: 0` — well past the 4-week minimum — with no "coverage gap" required at all.

**This means the failure mode is backwards from what "conservative"/"set-and-forget" should mean:** a manager with consistent, unbroken weekly lineup engagement is *more* likely to trigger a false `conservative_roster_pattern` than one with sparse, irregular activity (whose real weeks may not land on consecutive calendar numbers, breaking the streak). It will not resolve with elapsed time since deployment — a manager who has set their lineup every single week for a year would still show this pattern forever, because slot-level tracking has never existed for any of these three sources.

**Scope of the bug beyond `set_and_forget`:** `conservative_roster_pattern` also feeds `deriveRiskTendency` (returns `'risk_averse'` when present) — same false-positive exposure. The reverse-direction pattern, `detectMatchupOverreaction` (`slotChanges >= 4`), is *not* exposed to false positives from this bug (a hardcoded `0` can never satisfy `>= 4`), but is consequently **permanently unreachable** from any of these three sources — an honest under-detection, not a misclassification. `detectBenchRegretRepetition` (reads `startedPlayerIds`/`benchedPlayerIds`, also hardcoded to `[]` by all three mappers) is similarly permanently unreachable. Only `detectRepeatedLineupIndecision` (which only needs a per-week *event count*, not slot-level detail) is both reachable and safe from this specific ambiguity.

| Lineup-based pattern | Reachable from current data? | False-positive risk? |
|---|---|---|
| `repeated_lineup_indecision` | Yes (event count only) | No |
| `conservative_roster_pattern` | Yes | **Yes — this bug** |
| `matchup_overreaction` | No (needs real `slotChanges >= 4`) | N/A (silently under-detects) |
| `bench_regret_repetition` | No (needs real player-level assignments) | N/A (silently under-detects) |

## 4. Which fix strategy is right?

Evaluated against the task's five named options:

| Option | Verdict | Why |
|---|---|---|
| **Priority-order change** | ❌ Insufficient alone | Would only change *which* label wins the race, not whether `conservative_roster_pattern` is falsely detected in the first place. The pattern would still corrupt `deriveRiskTendency`, still appear in `derivation`/`traits`, and any future classifier added ahead of `committed_grinder` could resurrect the same symptom. Treats the symptom, not the cause. |
| **Data-completeness guard** | ✅ **Recommended** | Directly addresses the root cause: teach the pattern detector (or the events themselves) to distinguish "genuinely zero slot changes" from "slot-change count unknown for this source." Two viable shapes, both requiring their own ADR per §5: (a) change `LineupSavedMetadata.slotChanges` to `number \| null` and have `detectConsecutiveWeekPattern` skip `null` weeks rather than treating them as `0` — a fact-contract shape change, explicitly ADR-gated by `ARCHITECTURE_FREEZE.md`; or (b) use each event's already-computed `completeness` score (already lower for these three mappers, since they already report `missingMetadataFieldCount` for the very same reason) to exclude low-completeness events from `conservative_roster_pattern` scoring specifically, without changing the metadata shape — smaller blast radius, still a real behavior change to frozen-adjacent Phase 6.1 logic and still worth an ADR given this program's own established discipline (every Phase 6.x sub-ticket in this codebase has shipped behind its own ADR). |
| **Ramp-up window guard** | ⚠️ Insufficient alone, may help as an interim mitigation | Does not fix the underlying ambiguity — per §3, the false positive isn't actually a ramp-up artifact, it fires directly from a solid run of real activity. A ramp-up guard (e.g. "don't trust `conservative_roster_pattern` until N weeks post-deployment") would only mask the symptom during an early window and then let it resurface indefinitely for exactly the well-engaged managers it should least apply to. Not recommended as the primary fix; could be a cheap, temporary belt-and-suspenders addition alongside the real fix if the team wants extra caution during initial rollout. |
| **Warning-only behavior** | ⚠️ Already partially in place, not sufficient | `detectConflicts` in `dna.ts` already emits `'conflicting_signals: conservative roster pattern alongside trade spike — set_and_forget may understate trade activity'` when both patterns are present (confirmed in Phase 2I's own measurement). This is good, honest disclosure — but the *primary identity* a consumer sees is still the less-accurate one; the warning doesn't change classification outcome. Worth keeping as a complementary signal regardless of which structural fix is chosen. |
| **Deployment wait period** | ❌ Not effective | Per §3's correction, this bug does not resolve with elapsed time — a manager with a genuine, unbroken weekly habit will trigger it forever, not just during an early ramp-up window. This option was only plausible under Phase 2I's original (now-corrected) "ramp-up gap" theory. |

**Recommendation: a data-completeness guard**, most likely option (b) above (completeness-score-based exclusion) as the lower-risk starting point, with option (a) (a real `slotChanges: number | null` contract, ultimately requiring actual slot-tracking to be implemented for at least one source) as the durable long-term fix. Both require their own ADR before implementation, per `ARCHITECTURE_FREEZE.md` and this program's own established per-ticket ADR discipline — this document does not authorize either.

## 5. Migration risk

- **Low-to-medium for option (b) (completeness-based exclusion in `patterns.ts`):** touches Phase 6.1 pattern-detection logic directly (not the frozen Canonical World/DCO/shadow-model surfaces `ARCHITECTURE_FREEZE.md` explicitly names), but Phase 6.1 has its own dedicated, currently-passing 835+/related-assertion test suites (`behavioral-patterns.test.ts`, `manager-dna.test.ts`) that would need to stay green and be extended — a real regression surface, not a trivial one.
- **Medium-to-high for option (a) (metadata shape change):** `LineupSavedMetadata.slotChanges: number` is part of the Phase 5.0 `BehavioralEvent` taxonomy's frozen-adjacent contract (`lib/decision-os/behavioral/events/types.ts`) — changing it to `number | null` is a genuine fact-contract shape change requiring a real Prisma-free but code-wide review across every consumer of `LineupSavedMetadata` (both existing lineup-based pattern detectors and any UI/API surface that reads this field). `ARCHITECTURE_FREEZE.md` explicitly lists "changing a fact contract shape" as ADR-required.
- **Neither option changes public API response shapes** — this is entirely internal to the Phase 5/6 pipeline; no route response contract is touched by either fix.
- **Both options are reversible** (a registry/threshold-level guard, or a nullable field addition) and additive in the ARCHITECTURE_FREEZE.md sense of "new deterministic facts/enrichment... degrading honestly when a source is missing" — which is exactly what option (a) would formalize.

## 6. Tests required before any classifier change

1. **A regression-documenting test at the `patterns.ts` level**, added *before* any fix, that pins today's (buggy) behavior explicitly: 4+ consecutive weeks of mapper-sourced (hardcoded-zero) `lineup_saved` events currently produces `conservative_roster_pattern`. This is the baseline the fix must change.
2. **A "real slot-change data still works" test**: construct events with genuine, non-hardcoded `slotChanges` values (mirroring `behavioral-patterns.test.ts`'s existing `lineupSaved(..., slotChanges)` helper) proving the pattern still correctly fires for *actually* conservative managers once the guard exists — the fix must not blind the detector to real conservative behavior, only to the ambiguous-placeholder case.
3. **A completeness-boundary test** (if option (b) is chosen): events at, above, and below whatever completeness threshold is chosen, proving the cutoff behaves as intended and doesn't accidentally exclude genuinely-complete events from sources that *do* track slot changes (none exist today, but the guard must not assume that stays true forever).
4. **A `dna.ts`-level re-classification test**: re-run Phase 2I's exact combined scenario (6 trades, 3 waivers, 8 free-agent adds, 6 lineup-history saves across weeks 1–6) and confirm the identity returns to `'committed_grinder'` (or at minimum, no longer silently flips to `'set_and_forget'` without the caller being able to tell the difference) post-fix.
5. **Full regression of the existing `behavioral-patterns.test.ts` and `manager-dna.test.ts` suites**, unchanged and green — proving the fix is additive, not a redesign, per `ARCHITECTURE_FREEZE.md`'s allowed-without-a-new-ADR bar (if the chosen fix stays within that bar) or clearly scoped against it (if it doesn't).
6. **A parity/before-after harness** (mirroring the Phase 2C/2F/2I pattern already established in this workstream) run across a battery of realistic scenarios — not just the one combined case — to catch any other classifier whose behavior shifts as a side effect (`deriveRiskTendency`'s `risk_averse` path is the other known consumer of this pattern and should be included).

## Go/no-go for AI Coach

**Unaffected by this phase — still NO-GO**, per Phase 2I. This document is audit-only and authorizes no code change.

## Phase 2K implementation prompt

> Implement Phase 2K only after an ADR is written and approved for the chosen fix (per `ARCHITECTURE_FREEZE.md`'s governance rule — this phase does not write that ADR, it identifies which fix needs one). Recommended scope once approved: implement option (b) from §4 — exclude events whose `completeness` falls below a to-be-decided threshold from contributing to `conservative_roster_pattern` detection in `lib/decision-os/phase6/patterns/patterns.ts`'s `detectConsecutiveWeekPattern`/`detectConservativeRosterPattern`, without changing `LineupSavedMetadata`'s shape. Add all six test categories from §6 before touching detection logic. Do not implement option (a) (the nullable-field contract change) in the same phase — that is explicitly the larger, separately-ADR-scoped, longer-term fix. Do not touch AI Coach, Trade Analyzer, Trade Proposal Generator, Chimmy, or `lib/manager-dna.ts`. Do not deploy Phase 2H's migration in this phase either — that remains a separate, explicit decision per Phase 2I §5/§6.

## Files changed in this phase

- `docs/DECISION_OS_MANAGER_DNA_PHASE2J_CLASSIFIER_RAMPUP_AUDIT.md` (this document, new)

No other file was created, modified, or deleted. No classifier code was changed. No database was queried or connected to.
