# Waiver Shadow Backtest (Phase 7)

Validates the Waiver Service (`../WaiverShadowService.ts`) against **real historical AllFantasy waiver claims** — mirrors [`lib/shared-services/trade/backtest/`](../../trade/backtest/README.md)'s structure (Phase 6). Shadow mode only; reads existing rows, writes nothing to production tables.

## Pipeline

```
loadHistoricalWaiverSamples()   → real Prisma query, real historical claims
  → runWaiverShadowBacktest()   → evaluateWaiverShadow() per sample, failures isolated
    → summarizeWaiverBacktest() → grader parity + real-outcome alignment
```

```ts
import { loadHistoricalWaiverSamples, runWaiverShadowBacktest, summarizeWaiverBacktest } from '@/lib/shared-services/waiver/backtest'

const { samples, skipped } = await loadHistoricalWaiverSamples({ limit: 200 })
const runSummary = await runWaiverShadowBacktest(samples)
const summary = summarizeWaiverBacktest(runSummary.pairs)

console.log(summary.thresholdFindings.join('\n'))
console.log('Real-outcome alignment:', summary.realOutcomeAlignment)
```

## Where the historical samples come from

Real terminal `WaiverClaim` rows (`status: 'processed'` = awarded, `status: 'failed'` = lost — confirmed via `lib/waiver-wire/process-engine.ts`), joined to their real `WaiverResult` (`resultType`/`faabDelta` — the true per-claim outcome record) and their `League` (for platform grouping). Unlike Trade OS's Phase 6 backtest, **natively-created leagues are included**, not just imported ones — Waiver OS's context assembler never needs an external re-fetch.

## A real, important limitation: no point-in-time snapshot

**This backtest re-evaluates historical claims against TODAY's roster and free-agent-pool state, not the state as it existed when the claim was actually made.** No point-in-time roster/free-agent snapshot exists for waivers — unlike Trade OS, where `TradeOfferEvent.assetsGiven/assetsReceived` captured the exact assets verbatim at proposal time, there is no `WaiverOfferEvent` equivalent (confirmed during the Phase 7 audit: no such model or capture file exists; the Knowledge Graph's `WaiverSignalHook.ts` only appends to the in-memory `SignalStore`, non-durable).

Two consequences, both by design, not oversight:
1. **`realOutcomeAlignment` is not a prediction-accuracy claim.** It reports how often the shadow's own top pick (computed against today's context) happens to match the player that was actually added/rejected historically — a rough, directional signal, not calibration.
2. **Grader-to-grader parity (`byGrader`) is the backtest's primary real value** — both the shadow service and the one real comparison-only legacy engine (`generateWaiverRecommendations`) are evaluated against the *same* (current) context, so their agreement/disagreement rate is a fair, real comparison even though neither is being judged against a faithful historical snapshot.

## What this does not do

- Does not migrate any live consumer onto the shadow Waiver Service.
- Does not retire `runWaiverAIService`/`scoreWaiverCandidates` or `generateWaiverRecommendations`.
- Does not change any live API behavior, UI, or scoring math.
- Does not persist backtest results durably — `WaiverShadowResultStore` is the same disclosed in-memory-only store the shadow service uses.
