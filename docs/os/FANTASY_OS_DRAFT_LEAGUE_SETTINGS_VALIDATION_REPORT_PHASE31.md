# League Settings Validation Report (Phase 31)

## Real `.env.test` data (65 total real leagues)

| Configuration | Real leagues | Notes |
|---|---|---|
| Superflex (real `SUPER_FLEX`/`SFLEX`/`OP` slot key, or `settings.superflex`/`is_superflex`) | **4** (3 `sleeper`-imported, 1 `allfantasy`-native) | Previously misdetected as 0 by the buggy `QB>=2` check |
| 2QB (real `QB:2`, no flex-type QB slot) | **0** | No real occurrences in this environment |
| TE Premium (`settings.te_premium`/`tePremium` populated) | **0** | Field name pattern is real (used elsewhere), never populated here |

## By platform

| Platform | Total | Superflex | 2QB | TE Premium |
|---|---|---|---|---|
| `sleeper` (imported) | 3 | 3 | 0 | 0 |
| `allfantasy` (native) | 16 | 1 | 0 | 0 |
| `allfantasy_test_adp_seed` | 18 | 0 | 0 | 0 |
| `manual` | 27 | 0 | 0 | 0 |
| `native` | 1 | 0 | 0 | 0 |

## What this means for validation

- **Superflex correction: real-data validated.** All 3 real imported Sleeper leagues classify as `isSF: true` after this phase's fix (they incorrectly classified as `isSF: false` before it) — this is a genuine before/after improvement measurable against real production data, not a fixture.
- **2QB: implemented, tested, but not real-data validated.** No real 2QB league exists to exercise it against. Validated via 5 controlled-fixture unit tests instead (`__tests__/shared-services/draft/draft-context-assembler-2qb-tep.test.ts`, `__tests__/draft-helper/recommendation-engine-2qb-tep.test.ts`).
- **TE Premium: implemented, tested, but not real-data validated.** No real league populates the setting. Validated via 6 controlled-fixture unit tests in the same two files.

This is the same honest disclosure pattern established in Phase 30 for Keeper/Auction — real, defensible logic with a genuine data-availability gap, not a fabricated validation claim.
