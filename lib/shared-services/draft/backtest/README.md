# Draft Shadow Backtest (Phase 8)

Validates the Draft Service (`../DraftShadowService.ts`) against **real historical AllFantasy draft picks** — mirrors [`lib/shared-services/waiver/backtest/`](../../waiver/backtest/README.md) (Phase 7). Shadow mode only; reads existing rows, writes nothing to production tables.

## Pipeline

```
loadHistoricalDraftPickSamples() → real Prisma query, real completed-draft picks
  → runDraftShadowBacktest()     → point-in-time context reconstruction + evaluateDraftShadowFromContext() per sample, failures isolated
    → summarizeDraftBacktest()   → grader parity + real-outcome alignment
```

```ts
import { loadHistoricalDraftPickSamples, runDraftShadowBacktest, summarizeDraftBacktest } from '@/lib/shared-services/draft/backtest'

const { samples, skipped } = await loadHistoricalDraftPickSamples({ maxSessions: 20, maxPicksPerSession: 10 })
const runSummary = await runDraftShadowBacktest(samples)
const summary = summarizeDraftBacktest(runSummary.pairs)

console.log(summary.thresholdFindings.join('\n'))
console.log('Real-outcome alignment:', summary.realOutcomeAlignment)
```

## Where the historical samples come from

Real completed `DraftSession` rows (`status: 'completed'`), sampling a bounded number of real `DraftPick` rows per session (round > 1 only — round 1 has no prior picks in the same session to build a "roster so far" context from). Natively-created leagues are included, not just imported ones.

## A real architectural advantage over Trade OS's and Waiver OS's backtests: true point-in-time replay

Draft picks are strictly ordered by `overall`. For a historical pick at `overall = N`, every `DraftPick` row in the same session with `overall < N` is a **faithful, exact reconstruction** of what had already been drafted (and by whom) at that moment — not an approximation. `DraftBacktestRunner.ts` uses this to rebuild the real roster-so-far and excluded-players set for each sampled pick, then calls `evaluateDraftShadowFromContext()` — reusing 100% of the real shadow-evaluation logic (KG lookups, divergence, evidence assembly) that the live path uses.

**The one honest caveat**: ADP values come from today's `AllFantasyAdpSnapshot`, not a point-in-time snapshot as of the historical draft — no ADP versioning exists (confirmed during the Phase 8 audit). This means:
1. **Grader-to-grader parity (`byGrader`) is fully fair** — both the shadow service and the legacy grader (`decideDraftPickWithScores`) see the *same* (today's) ADP values for a given reconstructed board state, so their agreement/disagreement rate is a real, meaningful comparison.
2. **`realOutcomeAlignment` is directional, not a strict prediction-accuracy claim** — the shadow's recommendation reflects today's ADP consensus, which may differ from the ADP consensus at the time the historical pick was actually made.

## Migration-readiness thresholds

No fixed numeric threshold is hardcoded here (unlike Trade OS's Phase 6, which had explicit brief-provided targets) — `summarizeDraftBacktest()`'s `thresholdFindings` reports the real same-top-player rate per grader; a future phase can set a target once real backtest volume exists.

## What this does not do

- Does not migrate any live consumer onto the shadow Draft Service.
- Does not retire `RecommendationEngine.ts` or `aiOpponentDraft.ts`.
- Does not change any live API behavior, UI, or scoring math.
- Does not persist backtest results durably — `DraftShadowResultStore` is the same disclosed in-memory-only store the shadow service uses.
