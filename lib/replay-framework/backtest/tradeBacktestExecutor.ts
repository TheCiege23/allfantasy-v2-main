/**
 * Decision OS Replay Framework — deterministic trade backtest executor.
 * Calls the existing, UNMODIFIED trade-engine (computeTradeDrivers() +
 * calibrateAcceptProbability()) against a normalized replay row, producing a
 * retroactive prediction to compare against the real, known outcome.
 *
 * Per docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §6: this module never
 * writes to TradeOfferEvent/TradeOutcomeEvent/TradeLearningStats — it only
 * READS the current calibratedB0 (via the existing getCalibratedWeights(),
 * the same read every live trade-evaluation route already performs) to
 * score a historical trade the same way a live proposal would have been
 * scored, then hands the result to lib/replay-framework/writer.ts, which
 * only ever writes ReplayBacktestResult.
 */
import { calibrateAcceptProbability, getCalibratedWeights } from '@/lib/trade-engine/accept-calibration'
import { computeTradeDrivers } from '@/lib/trade-engine/trade-engine'
import type { Asset } from '@/lib/trade-engine/types'
import { computeDeterministicConfigVersion, resolveEngineVersionHash, TRADE_MODEL_VERSION } from '../versioning'
import type { BacktestResultInput, TradeBacktestOutput, TradeRealOutcome, TradeReplayPayload } from '../types'
import { mapSleeperStatusToOutcome } from '../normalize/sleeperTradeNormalizer'

function toAssets(items: TradeReplayPayload['assetsGiven']): Asset[] {
  return items.map((item, idx) => ({
    // Phase 9 fix: the real, stable providerAssetId (Sleeper player ID or
    // deterministic pick ID) must be used here, matching whatever ID the
    // SAME real player carries in the roster-context arrays below —
    // computeLineupDelta() matches give/receive against the roster by
    // Asset.id, so two disjoint synthetic ID namespaces (this function's
    // old `replay-${idx}` vs. toRosterAssets()'s old `roster-${idx}`) meant
    // the traded player was never actually recognized as present in the
    // roster, so it was never removed from the "after" lineup computation.
    // Falls back to a synthetic ID only if providerAssetId is somehow
    // missing (rows written before this fix), preserving old behavior.
    id: item.providerAssetId ?? `replay-${idx}`,
    type: item.type === 'pick' ? 'PICK' : 'PLAYER',
    value: item.value,
    name: item.name,
    // pos (Phase 9) — required for computeBestLineupPPG()'s player filter;
    // computeLineupDelta() appends give/receive directly into the "after"
    // roster arrays, so without a real pos an incoming player was silently
    // invisible to the lineup calculation (see TradeReplayPayload's docstring).
    pos: item.pos,
    // vorpValue (Phase 7) — required for computeTradeDrivers()'s hasVorpData
    // gate; 0/undefined for any asset that didn't resolve one (picks, or
    // players that failed to match FantasyCalc), matching this pipeline's
    // established graceful-fallback convention.
    vorpValue: item.vorpValue,
  }))
}

function toRosterAssets(items: TradeReplayPayload['proposerRoster']): Asset[] {
  return (items ?? []).map((item, idx) => ({
    id: item.providerAssetId ?? `roster-${idx}`,
    type: item.type === 'pick' ? 'PICK' : 'PLAYER',
    value: item.value,
    name: item.name,
    pos: item.pos,
    vorpValue: item.vorpValue,
  }))
}

export interface TradeBacktestInput {
  replayId: string
  season: number
  payload: TradeReplayPayload
  isSuperFlex: boolean
  providerStatus: string
  resolvedAt: Date | null
  /** League roster-slot definitions (e.g. `['QB','RB','RB','WR','WR','FLEX','BN',...]`), from `ReplayImport.contextSnapshot.roster_positions`. Required for roster context to have any effect — without it, `computeTradeDrivers()`'s lineup-delta math short-circuits exactly as it does when `rosterCtx` is omitted entirely. */
  rosterPositions?: string[]
}

export async function runTradeBacktest(input: TradeBacktestInput): Promise<BacktestResultInput> {
  const give = toAssets(input.payload.assetsGiven)
  const receive = toAssets(input.payload.assetsReceived)

  const calWeights = await getCalibratedWeights(input.season, { isSuperFlex: input.isSuperFlex, scoringType: undefined })

  // Roster context (Phase 6, per docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md
  // §11): additive — rows normalized before Phase 6 (or where a roster
  // failed to resolve) simply have empty roster arrays, which
  // computeTradeDrivers() already treats identically to `rosterCtx: undefined`
  // (its own internal guard: `rosterCtx.yourRoster.length > 0`).
  const yourRoster = toRosterAssets(input.payload.proposerRoster)
  const theirRoster = toRosterAssets(input.payload.counterpartyRoster)
  const rosterCtx =
    yourRoster.length > 0 && (input.rosterPositions?.length ?? 0) > 0
      ? { yourRoster, theirRoster, rosterPositions: input.rosterPositions! }
      : undefined

  const drivers = computeTradeDrivers(
    give,
    receive,
    null,
    null,
    input.isSuperFlex,
    false,
    rosterCtx,
    undefined,
    undefined,
    undefined,
    undefined,
    calWeights,
  )

  const { calibrated } = await calibrateAcceptProbability(drivers.acceptProbability, input.season)

  const backtestedOutput: TradeBacktestOutput = {
    acceptProb: calibrated,
    verdict: drivers.verdict,
    confidenceScore: drivers.confidenceScore,
    lineupImpactScore: drivers.lineupImpactScore,
    vorpScore: drivers.vorpScore,
    marketScore: drivers.marketScore,
    behaviorScore: drivers.behaviorScore,
    // Additive (Phase 9) — the real signal Phase 8 found genuinely feeds
    // acceptProbability (unlike vorpDeltaThem), persisted for corpus-
    // composition analysis (starter-involved vs. bench-depth trades).
    hasLineupData: drivers.lineupDelta?.hasLineupData ?? false,
    deltaThem: drivers.lineupDelta?.deltaThem ?? null,
  }

  // Per the ADR's exclusion (§4): a real outcome is only settled once the
  // underlying trade has actually resolved — a `pending` trade has no known
  // outcome to backtest against yet.
  const realOutcome: TradeRealOutcome | null =
    input.providerStatus === 'pending'
      ? null
      : { outcome: mapSleeperStatusToOutcome(input.providerStatus), providerStatus: input.providerStatus }

  return {
    replayId: input.replayId,
    decisionType: 'trade',
    modelVersion: TRADE_MODEL_VERSION,
    engineVersionHash: resolveEngineVersionHash(),
    deterministicConfigVersion: computeDeterministicConfigVersion(calWeights.b0),
    backtestedOutput,
    realOutcome,
  }
}
