# IDP Validation Report (Phase 32)

## Real `.env.test` data (65 total real leagues)

| Metric | Real count |
|---|---|
| Real leagues with any IDP starter slot (`League.starters`) | **0 / 65** |
| Real `IdpLeagueConfig` rows | **0** |
| Real leagues with `leagueVariant` in `{idp, IDP, DYNASTY_IDP, dynasty_idp}` | **0 / 65** |
| `SportsPlayer` NFL rows with a defensive position (DE/DT/LB/CB/DB/DL/S + aliases) | **6,712** |
| `AllFantasyAdpSnapshot` NFL entries with a DE/DT/LB/S position suffix | **0** |
| `AllFantasyAdpSnapshot` NFL entries with a CB position suffix | **21** |

Three independent real signals (starter slots, `IdpLeagueConfig` rows, `leagueVariant`) all agree: **no real league in `.env.test` is configured as IDP.**

## A caveat on the 21 real CB ADP entries

These 21 entries are labeled `draftMode: 'real'`, but a closer inspection found they share an identical `sampleSize: 25` and an identical `contextHash` across all 21 — unlike genuinely organic real data (a contrasting WR sample showed varied `draftMode` and `sampleSize` values, as expected from real, diverse league history). This uniformity is the signature of a single batch-computed snapshot (most likely from the `allfantasy_test_adp_seed` platform's 18 leagues), not organically diverse real draft behavior across many leagues over time. Disclosed precisely as measured — not claimed as fake, not claimed as robust real signal either.

## What this means for validation

- **Roster-construction logic (position targets, flex-slot eligibility)**: implemented and unit-tested (6 controlled-fixture tests in `recommendation-engine-idp.test.ts`), matching the same honest-disclosure pattern as Keeper/Auction (Phase 30) and 2QB/TE Premium (Phase 31) — no real IDP league exists to validate end-to-end.
- **The `isIdpLeague()`-based format-detection fix**: implemented and unit-tested (2 tests in `draft-context-assembler.test.ts`) via mocked `isIdpLeague`. Cannot be validated against a real IDP league for the same reason.
- **Defensive player pool depth**: real and substantial (6,712 `SportsPlayer` rows) — if a real IDP league existed, the underlying player data would support real recommendations. The bottleneck is entirely the ADP snapshot's thin, likely-single-batch defensive coverage (CB only, 0 for DE/DT/LB/S), not the player pool.
- **IDP scoring presets (`IdpLeagueConfig.scoringPreset`/`scoringOverrides`)**: not read by this phase's implementation (out of scope per the "do not invent defensive values" guardrail — no real league populates them to validate against anyway).

This is not a case of "no real data at all" like Keeper/Auction — real defensive player data exists at scale, but zero real IDP *leagues* exist to exercise the recommendation logic end-to-end, and the ADP snapshot's defensive coverage is thin and probably synthetic-batch-origin for the one position it does cover.
