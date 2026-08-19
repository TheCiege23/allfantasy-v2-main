# 2QB Configuration Audit (Phase 31)

## Fresh audit finding: the pre-existing "Superflex" check was a real bug

`resolveLeagueScoringFlags()` (`DraftContextAssembler.ts`) previously derived `isSF` from `rosterSettings.starterSlots.QB >= 2`, read from `League.settings`'s parsed snapshot. A direct query against all 65 real leagues in `.env.test` found:

| Check | Real leagues matching |
|---|---|
| `starterSlots.QB >= 2` (the old check) | **0 / 65** |
| A real `SUPER_FLEX`/`SFLEX`/`OP`/`SUPERFLEX` slot key on `League.starters` | **4 / 65** |

**The old "Superflex" detector never fired for a single real league.** It was validated only via controlled fixtures in Phases 27-29. Real Superflex leagues in this environment carry a dedicated flex slot key (e.g. `QB:1, SUPER_FLEX:1`) on the separate `League.starters` column, not `QB:2` in `League.settings`.

## Is 2QB genuinely distinguishable from Superflex in real data?

Yes. The two are structurally different shapes:
- **Superflex**: `QB:1` + a flex-type slot key (`SUPER_FLEX`/`SFLEX`/`OP`) that *may* start a QB.
- **2QB**: `QB:2`, no flex-type QB slot — every roster *must* start 2 QBs.

**0 of 65 real leagues have both signals simultaneously** — confirming these are real, mutually exclusive shapes, not an artificial distinction. `lib/agents/anthropic-pipeline.ts`'s `buildLeagueScoringSettings()` already uses the exact same slot-key vocabulary (`SUPER_FLEX`/`SFLEX`/`OP`) for a different purpose (AI chat context), confirming this is an established, real pattern in this codebase — not invented for this phase.

## Real data distribution (by platform)

| Platform | Total leagues | Real Superflex | Real 2QB |
|---|---|---|---|
| `sleeper` (imported) | 3 | **3** | 0 |
| `allfantasy` (native) | 16 | 1 | 0 |
| `allfantasy_test_adp_seed` | 18 | 0 | 0 |
| `manual` | 27 | 0 | 0 |
| `native` | 1 | 0 | 0 |

All 3 real imported Sleeper leagues in `.env.test` are genuinely Superflex. **Zero real leagues of any platform are genuine 2QB.**

## Fix implemented

`resolveLeagueScoringFlags(settingsJson, startersJson)` now:
1. Parses `League.starters` (new: added to both live and backtest `select` clauses) via a new `parseStarterSlotCounts()` helper, mirroring `anthropic-pipeline.ts`'s `countStarterSlots()` parsing shape (array-of-strings or object-of-counts).
2. `isSF` = a real `SUPER_FLEX`/`SFLEX`/`OP`/`SUPERFLEX` slot key present, OR `settings.superflex`/`settings.is_superflex === true`.
3. `is2QB` = `!isSF` AND real QB slot count `>= 2` (falls back to the old settings-snapshot QB count only when `starters` data is unavailable).

`RecommendationEngine.ts` gained a new, distinct `is2QB` input alongside the existing `isSF`, with a slightly larger QB-urgency boost (`+24` need, `+20` formatBoost, vs Superflex's existing `+18`/`+14`) — a deliberate, disclosed heuristic judgment (2QB is a *mandatory* dual-QB requirement, Superflex is *optional*), not an empirically-derived number.

## Honest disclosure

2QB logic is implemented, tested (5 new unit tests), deterministic, and backward compatible — but **cannot be validated against real 2QB draft data**, because none exists in `.env.test`. Superflex correction, by contrast, **is** now validated against real data: all 3 real Sleeper leagues correctly classify as `isSF: true` post-fix (they classified as `isSF: false` before this phase's fix).
