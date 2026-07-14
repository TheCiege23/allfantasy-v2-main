# Draft OS — Migration Readiness Assessment (Phase 25)

**Classification: Major gaps. Not ready for migration into the shared Fantasy OS architecture.**

## Reasoning, evidence-based

This assessment evaluates whether `lib/shared-services/draft/` (the Phase 8 shadow-mode module) — or, more precisely, the real engine it wraps (`lib/draft-helper/RecommendationEngine.ts`) — is ready to become an authoritative, migrated Fantasy OS capability. It is not, for reasons found and verified fresh this phase:

1. **League-configuration coverage is materially incomplete.** Of 11 configurations this phase was asked to validate, genuine distinct handling exists for only 2 (Redraft baseline, Superflex). Dynasty affects only explanation text, not scoring. Keeper, IDP, Auction, and all scoring-format distinctions (PPR/Half-PPR/Standard) are entirely absent from the recommendation formula. A "TE Premium" boost exists in name only — it checks for a TE roster slot, not the league's actual TE-scoring rule. Migrating this as an authoritative, cross-format capability today would silently misrepresent quality for the majority of real league configurations that exist in this product.

2. **Player identity resolution fails for 80.1% of the real candidate pool** in the one real league measured this phase. This directly degrades recommendation differentiation (observed: identical top pick recommended across 5 rounds with different needs) and would starve any future Knowledge Graph-dependent features the shadow module already wires up (manager tendency, player exposure).

3. **No real historical draft data exists to validate against.** `.env.test` has zero completed drafts on a recognized real-provider platform. This isn't itself a Draft OS defect, but it means **no phase, including this one, has been able to measure real-world recommendation accuracy** — the single most important readiness signal for a recommendation engine, still entirely unverified.

4. **The shadow module itself (`lib/shared-services/draft/`) has zero real callers**, confirming it remains exactly what Phase 8 built it as — a comparison/backtest scaffold, never activated. This is not itself disqualifying (that was always the design), but it means there is no real production shadow-parity telemetry of any kind to lean on, unlike Waiver (Phases 12-16) or Trade (Phases 18-19), which both had real production shadow-compare evidence before any readiness discussion.

## What IS solid, evidence-based

- The core engine (`computeDraftRecommendation`) is genuinely deterministic, pure, well-structured, and already real, live, and heavily used in production for its current (Redraft/Superflex-aware, ADP-based) scope.
- The backtest tooling built in Phase 8 is real, functional, and correctly ran end-to-end this phase against real (if non-ideal) data — the engineering is sound, only the validation evidence and format coverage are missing.
- No crashes, no undefined behavior, no non-determinism found anywhere in the scoring path.

## What would need to be true before a different classification

- Genuine scoring-path support (not just cosmetic flags) for at minimum PPR/Half-PPR/Standard and Dynasty value adjustment, given how common these are in the real product's league base.
- A materially higher identity-resolution rate (80% failure is not a marginal gap).
- At least one real historical draft (genuine provider-imported, not manual/seed fixture) validated end-to-end with an honestly-reported sample size.

## Explicit scope note

Per this phase's guardrails, nothing was migrated, redesigned, or fixed — this assessment is evidence-based classification only.
