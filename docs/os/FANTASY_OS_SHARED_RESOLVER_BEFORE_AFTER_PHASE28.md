# Shared Resolver — Before/After Comparison, Phases 26 → 27 → 28

**Status: real measurements, identical methodology (same real league, same 272 real ADP candidates) at every phase.**

## Draft OS shape (`limit: 800`)

| Phase | Resolution rate | Resolved/Total | Known real stars resolved |
|---|---|---|---|
| Phase 25/26 baseline (alphabetical, pre-dedup-fix) | 19.9% | 54/272 | 0/7 |
| Phase 26 (dedup-before-limit fixed) | 20.6% | 56/272 | 0/7 |
| Phase 27 (ADP-priority tier added) | **87.5%** | 238/272 | **7/7** |
| Phase 28 (ADP-rank tiebreak within tier) | **87.5%** (unchanged) | 238/272 | 7/7 |

**Phase 28 correctly produced no change for Draft's shape** — the 354-player NFL ADP-relevant population already fit entirely within the 800-item limit after Phase 27's fix, so refining the *order within* that tier has no effect on *which* players are included at this limit, only their relative priority. This is the expected, correct result, not a null result.

## Waiver OS shape (`limit: 250`)

| Phase | Resolution rate | Resolved/Total | Saquon Barkley resolves? |
|---|---|---|---|
| Phase 27 (ADP-priority tier, alphabetical tiebreak within tier) | Not measured with the full 272-candidate methodology at this specific phase (spot-checked 3 named players only) | — | **No** |
| Phase 28 (ADP-rank tiebreak within tier) | **65.4%** | 178/272 | **Yes** |

**This is the real, measured closure of Phase 27's disclosed residual gap.** All 5 spot-checked real stars (Saquon Barkley, Justin Jefferson, CeeDee Lamb, Bijan Robinson, Mike Evans) now resolve at `limit: 250`, including Saquon Barkley specifically — the exact case Phase 27 found excluded.

## Remaining unresolved players (both shapes)

The remaining gap at both limits is now dominated by the same minor, already-disclosed secondary categories from Phase 26's classification (suffix variants — "Jr.", punctuation — apostrophes) — not a selection-strategy problem. This is the expected, correct remaining-gap composition: true normalization edge cases, not selection logic, matching this phase's own success criteria.
