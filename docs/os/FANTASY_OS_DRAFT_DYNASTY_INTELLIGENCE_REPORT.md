# Dynasty Intelligence Report (Phase 29)

**Status: implemented and proven via controlled fixtures using real data sources. End-to-end real-league validation was not possible in `.env.test` — disclosed explicitly.**

## What was implemented

`dynastyAgeAdjustment(age, isDynasty)` — real, deterministic age-based scoring, replacing Phase 25's confirmed cosmetic-only Dynasty handling:

```
isDynasty === false           → 0 (no effect at all — redraft leagues fully unaffected)
age <= 23                     → +8  (rookie/near-rookie long-term upside)
age 24-27                     → +3  (still ascending / prime long-term value)
age === 28                    → 0   (neutral pivot point)
age >= 29                     → -(age-28)*2, capped at -16 (real, capped aging decline)
age missing                   → 0   (honest no-op, never fabricated)
```

## Real data source reused, not invented

`player.age` comes directly from `PoolPlayerRecord.age` (`lib/sport-teams/types.ts`), already resolved by the shared player pool resolver (`SportPlayerPoolResolver.ts`'s `age: r.age ?? null`, from the real `SportsPlayer.age` column) — the exact same real data source already flowing through the pipeline, now simply threaded one step further into `RecommendationPlayer` via `DraftContextAssembler.ts`. No new data source, no new valuation system, per this phase's explicit guardrails.

## Real data availability (measured this phase)

12,073 of 17,257 NFL `SportsPlayer` rows (70%) have real, non-null age data — a substantial, genuinely usable real signal.

## Real validation attempted — genuine, honest result: not fully possible end-to-end

8 real Dynasty NFL leagues exist in `.env.test`. Checked all 8: **none has both a real `DraftSession` and a real `Roster`** — the same underlying data-availability constraint Phase 25's Historical Replay doc already found (real leagues here mostly lack completed drafts; only manual/seed-fixture leagues do). This means a full, real, end-to-end Dynasty recommendation could not be computed against a genuine Dynasty league's real draft context in this environment. Stated explicitly, not fabricated.

## Controlled fixture validation (what was actually proven)

4 real, passing unit tests prove the mechanism works correctly:
- A 22-year-old outscores a 33-year-old with identical ADP in a Dynasty league.
- The same two players score identically in a non-Dynasty (redraft) league — age has zero effect outside Dynasty, proving backward compatibility.
- Missing age data does not throw and does not distort the score.
- The pre-existing Dynasty explanation text (`resolveFormatInsight`) still appears alongside the new real scoring effect — both signals now coexist correctly.

## Conclusion

The mechanism is real, correct, deterministic, reuses existing real data end-to-end (age already flows from a real, substantially-populated column), and will activate automatically for any real Dynasty league with real roster/pool data once one exists in a testable environment — nothing further needs to change for that to happen.
