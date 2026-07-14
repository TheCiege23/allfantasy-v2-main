# Trade Shadow Backtest (Phase 6)

Validates the Phase 5 shadow Trade Service (`lib/shared-services/trade/TradeShadowService.ts`) against **real historical AllFantasy-native trades** before any live consumer migration is considered. This module only reads existing rows and writes nothing back to production tables — output goes to the same in-memory `ShadowResultStore` Phase 5 already defined.

**Shadow mode only.** Nothing in this module is called by any live route, changes any live API behavior, alters the UI, or touches scoring math. It does not migrate any consumer or retire any legacy grader.

## Pipeline

```
loadHistoricalTradeSamples()   → real Prisma query, real historical trades
  → runTradeShadowBacktest()   → Phase 5's evaluateTradeShadow() per sample, failures isolated
    → summarizeDivergence()    → parity stats by grader / league / provider / confidence / category
```

```ts
import { loadHistoricalTradeSamples } from '@/lib/shared-services/trade/backtest/HistoricalTradeLoader'
import { runTradeShadowBacktest } from '@/lib/shared-services/trade/backtest/TradeShadowBacktestRunner'
import { summarizeDivergence } from '@/lib/shared-services/trade/backtest/DivergenceAnalyzer'

const { samples, skipped, totalCandidates } = await loadHistoricalTradeSamples({ limit: 200 })
const runSummary = await runTradeShadowBacktest(samples)
const divergenceSummary = summarizeDivergence(runSummary.evaluations)

console.log(divergenceSummary.thresholdFindings.join('\n'))
console.log('Passes migration threshold:', divergenceSummary.passesMigrationThreshold)
```

## Where the historical samples come from

Real trades are captured at proposal time by `lib/league-trade-engine/tradeLearningCapture.ts`'s `captureLiveTradeOffer()`, which writes a `TradeOfferEvent` row with `mode: 'LIVE_PROPOSAL'` and `afLeagueTradeId` set to the real `AfLeagueTrade.id`. `loadHistoricalTradeSamples()` queries exactly those rows, joins to the real `AfLeagueTrade` (for roster ids and terminal status) and its `League` (for provider/platform), and reuses `tradeLearningCapture.ts`'s own `mapAfTradeStatusToOutcome()` — not a re-invented status table — to decide which trades are terminal (backtestable) versus still in flight (skipped).

## Two real translation gotchas found during the schema audit

Both were confirmed by reading the actual persistence code, not assumed:

1. **Roster id ≠ provider team id.** `AfLeagueTrade.proposerRosterId`/`receiverRosterId` are our own internal `Roster.id` (uuid). But `evaluateTradeShadow()`'s `sideARosterId`/`sideBRosterId` must be the *provider's* `source_team_id` (e.g. Sleeper's numeric `roster_id` as a string) — see `LeagueTeamSnapshot.teamId` in `league-context-assembler.ts` (`teamId: r.sourceTeamId`). That value is only retrievable per-`Roster`-row via `Roster.playerData.source_team_id` (written by `SleeperLeagueCreationBootstrapService.ts`), **never** via `Roster.platformUserId`, which stores the provider's *owner* id instead. A roster missing this field is skipped (`reason: 'missing_source_team_id'`), never guessed at.
2. **Only imported leagues are re-assemblable.** `evaluateTradeShadow()` calls `buildLeagueDecisionContext()`, which calls `runImportedLeagueNormalizationPipeline()` — this has no "native" provider branch. Trades on natively-created (non-imported) `League` rows (`platform` not in `IMPORT_PROVIDERS`) are skipped (`reason: 'unsupported_platform:<platform>'`), never force-fit into a Sleeper-shaped fallback.

Every skip reason is returned in `HistoricalTradeLoadResult.skipped`, not silently dropped.

## Live DB access

**Not available in this sandbox.** This module was written and unit-tested entirely against a mocked `prisma` client (see `__tests__/shared-services/trade/historical-trade-loader.test.ts`). The Prisma queries themselves (`tradeOfferEvent.findMany`, `afLeagueTrade.findUnique`, `roster.findUnique`, `tradeOutcomeEvent.findUnique`) are real and match the schema exactly, but **this backtest has never been run against a real database**. Per [[phase-e-live-sleeper-proof]] convention, whoever runs this for real should use a real non-prod Neon branch (not the shared default `.env` database), and should start with a small `limit` to sanity-check the skip-reason distribution before scaling up.

## Migration-readiness thresholds

`DEFAULT_BACKTEST_THRESHOLDS` (in `types.ts`) encodes the Phase 6 brief's suggested starting values:

| Threshold | Default | Meaning |
|---|---|---|
| `minNonCriticalParityRate` | 0.95 | ≥95% of a grader's evaluations must be non-critical divergences |
| `maxCriticalDivergencesInHighConfidence` | 0 | Zero critical divergences tolerated among high-confidence trades |
| `criticalDivergenceAbsFairnessDelta` | 30 | `abs(fairnessScoreDelta) >= 30` is what counts as "critical" |
| `highConfidenceMinScore` | 0.7 | `evaluation.confidence >= 0.7` is what counts as "high confidence" |

These are starting values, not law — `summarizeDivergence()` accepts an override. A `legacy_grader_failed` divergence (the legacy grader's own call threw) is never counted as critical — it means the comparison couldn't be made, not that the shadow disagreed with it.

## What this does not do

- Does not migrate any live consumer onto the shadow Trade Service.
- Does not retire T2 or `trade-engine.ts`'s `computeTradeDrivers`.
- Does not change any live API behavior, UI, or scoring math.
- Does not persist backtest results durably — `ShadowResultStore` is the same disclosed in-memory-only store from Phase 5, lost on process restart.
