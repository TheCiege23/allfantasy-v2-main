# Recommendation Impact Report (Phase 31)

## QB recommendation changes

- **Superflex (real leagues)**: the 3 real Sleeper Superflex leagues in `.env.test` now correctly receive the `isSF` QB-urgency boost (`needs.QB +18`, `formatBoost +14` for QB) — previously they received **none**, since the old detector never fired on their real data.
- **2QB (fixture-validated only)**: a distinct, slightly larger QB boost (`needs.QB +24`, `formatBoost +20`) now exists and is measurably different from the Superflex boost — confirmed via `recommendation-engine-2qb-tep.test.ts`'s `twoQbScore > sfScore` assertion for an identical elite-QB fixture.
- Non-QB players are provably unaffected by either flag (dedicated regression test).

## TE recommendation changes

- The prior always-on `+4` roster-slot-presence boost is removed. **Every real league in `.env.test` (0/65 with a real TE Premium setting) will see TE recommendations score `~4 points` lower than before this phase** — a real, disclosed, intended behavior change, not a bug.
- A new, real `tePremiumAdjustment` (`0`-`20`, scaled from `settings.te_premium`) replaces it, currently inert for all real leagues in this environment (no real league populates the setting) but ready and tested for when one does.

## Confidence changes

`confidence = clamp(Math.round(55 + totalScore * 0.6), 40, 92)` is a direct function of `totalScore`; confidence shifts proportionally with the QB/TE boost changes above. No independent confidence-only logic was touched.

## Deterministic behavior

All new adjustments (`is2QB`, `tePremiumValue`) are pure functions of their inputs — confirmed via explicit determinism tests in both new test files (identical input → identical `totalScore` across repeated calls).

## Recommendation diversity

Unaffected outside the QB/TE positions and the specific real leagues where `isSF`/`is2QB`/`tePremiumValue` now resolve differently than before. No changes to ADP edge weighting, need-scoring for other positions, auction logic (Phase 30, untouched), or keeper logic (Phase 30, untouched).

## Comparison against Phase 30

Phase 30 added Keeper/Auction awareness, both real-data-unvalidated (0 real sessions of either type). Phase 31 differs in one important way: **the Superflex fix is the first config-intelligence change in this whole Draft OS effort (Phases 25-31) validated against real, unambiguous production data** — 3 real leagues, provably misclassified before, provably correct after.
