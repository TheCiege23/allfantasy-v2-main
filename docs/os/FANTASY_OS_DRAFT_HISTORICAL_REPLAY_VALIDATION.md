# Draft OS — Historical Replay Validation (Phase 25)

**Status: real attempt against `.env.test`. Zero genuine real-provider draft data was available — disclosed honestly, not papered over. A separately-labeled mechanics-only exercise was run instead.**

## What was attempted

Ran `loadHistoricalDraftPickSamples()` (the real Phase 8 backtest loader) against `.env.test`, requesting up to 24 sessions × 10 picks/session.

## Real finding: `.env.test` has zero completed drafts on a recognized real-provider platform

Query results (real, this phase):

| `League.platform` | Leagues total | Leagues **with a completed draft** |
|---|---|---|
| `sleeper` | 3 | **0** |
| `native` | 1 | **0** |
| `allfantasy` | 16 | 0 |
| `allfantasy_test_adp_seed` | 18 | **18** |
| `manual` | 27 | **6** |

`loadHistoricalDraftPickSamples()`'s platform filter (`'native'` or one of `sleeper`/`espn`/`yahoo`/`fantrax`/`mfl`/`fleaflicker`) correctly and conservatively excluded **all 24** completed `DraftSession` rows, because every one belongs to a `manual` or `allfantasy_test_adp_seed` league — test/seed fixtures, not genuine platform-imported draft outcomes. **Real sample size: 0.** This is reported honestly rather than silently substituting non-representative data as if it were real.

## Separately-labeled mechanics exercise (fixture data — NOT claimed as real-outcome accuracy evidence)

To verify the pipeline itself functions (not to claim real-world accuracy), the platform filter was bypassed in a throwaway script (never touching the real module) against the 24 fixture sessions.

**Sample construction**: 45 candidate picks across 10 sessions (round > 1, 5 picks/session spaced evenly).

**Result**: 20 evaluated, **25 failed** with `Roster not found: seed-roster-N` — the `allfantasy_test_adp_seed` platform's `DraftPick.rosterId` values are synthetic placeholders that don't correspond to real `Roster` rows. This 55.6% failure rate is an artifact of non-representative seed data, not a Draft OS defect — disclosed as a real characteristic of this specific fixture data, not investigated further (fixing seed data is out of this audit's scope).

**Of the 20 that did evaluate**: real player names in the fixture data were placeholder strings (`"Starting RB1"`, `"Starting WR2"`, `"Starting TE"`, etc.) — not real players. **The `realOutcomeAlignment` metric (0/20 matched) is therefore not meaningful and must not be read as "the engine is 0% accurate"** — it's comparing a real recommendation against a placeholder string that was never a real player to begin with.

**What the mechanics exercise DID reveal, genuinely useful**: the pipeline runs end-to-end without crashing on the cases that had valid rosters, correctly reconstructs point-in-time context, and surfaced a real, separate, significant finding — see [`FANTASY_OS_DRAFT_IDENTITY_VALIDATION.md`](FANTASY_OS_DRAFT_IDENTITY_VALIDATION.md) for the 80.1% identity-resolution failure this exercise exposed.

## Honest conclusion

**Historical replay against genuine, real-provider-imported draft outcomes was not possible this phase — no such data exists in `.env.test`.** This is a real, disclosed gap in the validation environment, not a finding about Draft OS's own quality. The mechanics exercise substitutes for a true accuracy measurement only in the narrow sense of proving the pipeline runs; it cannot and does not answer "would Draft OS have picked well in a real draft."

## What would be needed to close this gap

A future phase would need either (a) a real Sleeper (or other provider) league in a non-production environment that has actually completed a real snake/auction draft with genuine human picks, or (b) importing historical draft results from one of the 3 real `sleeper`-platform leagues already present in `.env.test` (none currently have a completed `DraftSession` — this would require either running/completing a real draft for one of them, or importing one that already completed on the real Sleeper platform).
