# Waiver OS Impact Report (Phase 28)

**Status: real measurement. This is where Phase 28's fix has its real, measurable effect — the residual gap Phase 27 disclosed is now closed.**

## Real result

At `limit: 250` (Waiver's typical real call shape, `WaiverContextAssembler.ts`'s `maxFreeAgents`-driven limit), resolution rate is **65.4% (178/272)**, and all 5 spot-checked real stars now resolve, **including Saquon Barkley** — the exact player Phase 27 found excluded at this same limit.

## Why this specifically closes Phase 27's disclosed gap

Phase 27's alphabetical tiebreak within the ADP tier meant that when the ADP-relevant population (354 for NFL) exceeded the limit (250), which specific players made the cut was determined by alphabetical luck, not fantasy relevance — a real top-5 player like Saquon Barkley (S) could lose out to dozens of lower-relevance ADP-tier players whose names happened to start earlier in the alphabet. Phase 28's ADP-rank tiebreak means the 250 slots are now filled by the 250 *most* fantasy-relevant ADP-tier players (by real rank), not an alphabetically-arbitrary subset of the full 354.

## Regression check

Full Waiver OS test suite (`__tests__/shared-services/waiver/`, `__tests__/waiver-wire-player-route-pool-resolver.test.ts`, `__tests__/waiver-ai-engine-route-contract.test.ts`) — 100% passing, confirmed this phase.

## Remaining gap at this limit (honest, not claimed as fully solved)

65.4% is a dramatic improvement but not 100% — 250 is still smaller than the 354-player ADP-relevant population, so the *lowest*-ranked ~104 ADP-tier players (by real rank) are still excluded at this limit by design (correctly, since they're genuinely the least fantasy-relevant of the ADP-tracked group) — this is expected, appropriate behavior for a bounded pool size, not a defect. The remaining unresolved candidates are now dominated by the same minor suffix/punctuation normalization category already disclosed in Phase 26, not a selection-strategy problem.
