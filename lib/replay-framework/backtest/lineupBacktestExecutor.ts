/**
 * Decision OS Replay Framework Phase 13 — deterministic lineup backtest
 * executor. Calls the existing, UNMODIFIED lineup engine
 * (`optimizeLineupDeterministic()`, lib/lineup-optimizer-engine/) against a
 * normalized replay row, feeding it REAL, historical, already-scored points
 * (never a live projection) to compute the true retrospective-optimal
 * lineup for that week, then compares it against what the manager actually
 * started. Mirrors `tradeBacktestExecutor.ts`'s exact pattern: reconstruct
 * real historical state, call the real production engine as-is, persist
 * the comparison.
 *
 * Per docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §6 (the isolation
 * guarantee, decision-type-agnostic since Phase 3): this module never
 * writes to TradeOfferEvent/TradeOutcomeEvent/TradeLearningStats, and never
 * touches acceptProbability/calibration — lineup replay has no
 * accept-probability-equivalent concept at all.
 */
import { optimizeLineupDeterministic } from '@/lib/lineup-optimizer-engine/LineupOptimizerEngine'
import type { OptimizerPlayerInput, OptimizerSlotInput } from '@/lib/lineup-optimizer-engine/types'
import { computeDeterministicConfigVersion, LINEUP_MODEL_VERSION, resolveEngineVersionHash } from '../versioning'
import type { BacktestResultInput, LineupBacktestOutput, LineupMistakeDetail, LineupReplayPayload } from '../types'

/**
 * Non-starting roster slot codes Sleeper includes in `roster_positions`
 * (bench/taxi/IR) — never real starting-lineup requirements, so they're
 * excluded before calling the optimizer (mirrors `trade-engine.ts`'s own
 * `parseRosterSlots()`, which silently drops any code it doesn't
 * recognize as a starting slot — same effective behavior, made explicit
 * here since the lineup optimizer's `normalizeSlots()` would otherwise
 * treat an unrecognized code as its own single-position requirement rather
 * than dropping it).
 */
const NON_STARTING_SLOT_CODES = new Set(['BN', 'TAXI', 'IR'])

/**
 * Sleeper's own slot-code vocabulary does not always match
 * `LineupOptimizerEngine.ts`'s `FLEX_GROUPS` keys exactly — most notably,
 * Sleeper's real `SUPER_FLEX` (underscore) has no matching entry in
 * `FLEX_GROUPS` (whose flex key is `SUPERFLEX`, no underscore), so passing
 * it straight through would leave every SUPER_FLEX slot permanently
 * unfillable (the engine's own `slotAllowedPositions()` falls back to
 * `[code]` verbatim when it doesn't recognize the code, and no real
 * player's position is literally `'SUPER_FLEX'`). This is the same class of
 * provider-vocabulary-vs-engine-vocabulary translation seam Phase 9 handled
 * for Trade Replay's `providerAssetId`/`pos` — the fix belongs in this
 * replay glue, never in the unmodified production engine.
 */
const SLEEPER_SLOT_ALLOWED_POSITIONS: Record<string, string[]> = {
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  'WR/TE': ['WR', 'TE'],
}

function toOptimizerSlots(slotPositions: string[]): OptimizerSlotInput[] {
  return slotPositions
    .filter((code) => !NON_STARTING_SLOT_CODES.has(code.toUpperCase()))
    .map((code) => ({
      code,
      allowedPositions: SLEEPER_SLOT_ALLOWED_POSITIONS[code.toUpperCase()],
    }))
}

function toOptimizerPlayers(payload: LineupReplayPayload): OptimizerPlayerInput[] {
  return payload.fullRoster.map((player) => ({
    id: player.providerAssetId,
    name: player.name,
    positions: player.pos,
    // The deliberate reuse this phase's design rests on: feeding REAL,
    // historical, already-scored points into a parameter named
    // `projectedPoints` is not a misuse of the engine — the engine simply
    // maximizes whatever point value it's given, so feeding it the real
    // final score computes the true retrospective-optimal lineup, which is
    // exactly the replay question ("what was the best possible lineup,
    // given what we now know actually happened").
    projectedPoints: player.actualPoints,
  }))
}

export interface LineupBacktestInput {
  replayId: string
  season: number
  payload: LineupReplayPayload
  sport?: string
}

export async function runLineupBacktest(input: LineupBacktestInput): Promise<BacktestResultInput> {
  const players = toOptimizerPlayers(input.payload)
  const slots = toOptimizerSlots(input.payload.slotPositions)

  const result = optimizeLineupDeterministic({
    sport: input.sport,
    players,
    slots,
  })

  const actualPoints = input.payload.fullRoster
    .filter((p) => input.payload.actualStarterIds.includes(p.providerAssetId))
    .reduce((sum, p) => sum + p.actualPoints, 0)

  const optimalPoints = result.totalProjectedPoints

  const optimalStarterIds = new Set(result.starters.map((s) => s.playerId))
  const actualStarterIds = new Set(input.payload.actualStarterIds)
  const playerByProviderId = new Map(input.payload.fullRoster.map((p) => [p.providerAssetId, p]))

  const missedOptimalStarters: LineupMistakeDetail[] = result.starters
    .filter((s) => !actualStarterIds.has(s.playerId))
    .map((s) => {
      const real = playerByProviderId.get(s.playerId)
      return { providerAssetId: s.playerId, name: s.playerName, actualPoints: real?.actualPoints ?? 0 }
    })

  const subOptimalActualStarters: LineupMistakeDetail[] = input.payload.fullRoster
    .filter((p) => actualStarterIds.has(p.providerAssetId) && !optimalStarterIds.has(p.providerAssetId))
    .map((p) => ({ providerAssetId: p.providerAssetId, name: p.name, actualPoints: p.actualPoints }))

  const benchValueLeft = Math.round(missedOptimalStarters.reduce((sum, m) => sum + m.actualPoints, 0) * 100) / 100
  const pointsFromSuboptimalStarters = Math.round(subOptimalActualStarters.reduce((sum, m) => sum + m.actualPoints, 0) * 100) / 100

  const pointsLeftOnBench = Math.round((optimalPoints - actualPoints) * 100) / 100
  const efficiencyPct = optimalPoints > 0 ? Math.max(0, Math.min(1, actualPoints / optimalPoints)) : 1

  const backtestedOutput: LineupBacktestOutput = {
    actualPoints: Math.round(actualPoints * 100) / 100,
    optimalPoints: Math.round(optimalPoints * 100) / 100,
    pointsLeftOnBench,
    efficiencyPct: Math.round(efficiencyPct * 1000) / 1000,
    benchValueLeft,
    pointsFromSuboptimalStarters,
    startSitMistakeCount: missedOptimalStarters.length,
    missedOptimalStarters,
    subOptimalActualStarters,
  }

  return {
    replayId: input.replayId,
    decisionType: 'lineup',
    modelVersion: LINEUP_MODEL_VERSION,
    engineVersionHash: resolveEngineVersionHash(),
    // Lineup replay has no tunable calibrated config (unlike trade's
    // calibratedB0) -- the generalized computeDeterministicConfigVersion()
    // (Phase 13) resolves an empty descriptor to the stable literal 'none'.
    deterministicConfigVersion: computeDeterministicConfigVersion({}),
    backtestedOutput,
    // No trade-style accept/reject outcome exists for a lineup decision --
    // the backtestedOutput comparison IS the result, not a separate outcome.
    realOutcome: null,
  }
}
