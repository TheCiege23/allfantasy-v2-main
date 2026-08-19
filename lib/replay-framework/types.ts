/**
 * Decision OS Replay Framework — generic, provider-agnostic, decision-type-
 * agnostic contracts, per docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md.
 *
 * First implementation: Sleeper trades. The types below intentionally carry
 * no Sleeper-specific or trade-specific fields at the top level — only
 * `payload`/`backtestedOutput`/`realOutcome` vary per decision type, exactly
 * mirroring the schema's own `Json` fields. Adding a future replay type
 * (waiver, draft, lineup, commissioner_action, roster_move) means adding a
 * new normalizer/backtest-executor pair, never a schema migration.
 */

export type ReplayDecisionType = 'trade' | 'waiver' | 'draft' | 'lineup' | 'commissioner_action' | 'roster_move'

export interface ReplayImportInput {
  provider: string
  decisionType: ReplayDecisionType
  providerLeagueId: string
  providerTransactionId: string
  season: number
  providerWeek: number | null
  proposedAt: Date
  resolvedAt: Date | null
  providerStatus: string
  participantsInvolved: unknown
  managerUserIds: unknown
  managerDisplayNames: unknown
  payload: unknown
  rawProviderPayload: unknown
  contextSnapshot: unknown
  isDynasty: boolean | null
  isSuperFlex: boolean | null
  ingestSourceUserId: string
}

export interface BacktestResultInput {
  replayId: string
  decisionType: ReplayDecisionType
  modelVersion: string
  engineVersionHash: string
  deterministicConfigVersion: string
  backtestedOutput: unknown
  realOutcome: unknown | null
}

/**
 * A roster player/pick usable as trade-engine `Asset` input — a subset of
 * `Asset`'s fields, just enough for `computeTradeDrivers()`'s roster-context
 * lineup math (`pos` is required for a player to count toward
 * `computeBestLineupPPG()`). `vorpValue` is additive (Phase 7) — required
 * for `computeTradeDrivers()`'s richer `hasVorpData` scoring branch to
 * activate at all. `providerAssetId` is additive (Phase 9) — the stable,
 * real Sleeper player ID (or a deterministic pick identifier), required so
 * the SAME real player carries the SAME `Asset.id` whether they appear in
 * `assetsGiven`/`assetsReceived` or in `proposerRoster`/`counterpartyRoster`
 * — `computeLineupDelta()` matches give/receive against the roster by
 * `Asset.id`, so without a shared, stable ID the swap silently never
 * applies (see the Phase 9 corpus-expansion finding).
 */
export interface TradeReplayRosterAsset {
  name: string
  value: number
  type: string
  pos?: string
  vorpValue?: number
  providerAssetId?: string
}

/**
 * Trade-specific shape stored in `ReplayImport.payload` (decisionType: 'trade').
 * `proposerRoster`/`counterpartyRoster` are optional and additive (Phase 6,
 * per docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §11) — rows ingested
 * before Phase 6 simply have them `undefined`, handled gracefully by the
 * backtest executor (falls back to no roster context, exactly like before).
 * `vorpValue` on every asset array is additive (Phase 7). `providerAssetId`
 * on every asset array is additive (Phase 9) — see `TradeReplayRosterAsset`.
 * `pos` on `assetsGiven`/`assetsReceived` is additive (Phase 9) — a second,
 * independent gap found alongside the ID-namespace bug: `computeLineupDelta()`
 * appends `give`/`receive` directly into the "after" roster arrays, and
 * `computeBestLineupPPG()` only counts a player with a real `pos` — without
 * it, an incoming player is silently invisible to the lineup calculation, so
 * `deltaThem`/`deltaYou` could only ever decrease or stay flat, never
 * increase, regardless of corpus composition.
 */
export interface TradeReplayPayload {
  assetsGiven: Array<{ name: string; value: number; type: string; pos?: string; vorpValue?: number; providerAssetId?: string }>
  assetsReceived: Array<{ name: string; value: number; type: string; pos?: string; vorpValue?: number; providerAssetId?: string }>
  proposerRoster?: TradeReplayRosterAsset[]
  counterpartyRoster?: TradeReplayRosterAsset[]
}

/**
 * Trade-specific shape stored in `ReplayBacktestResult.backtestedOutput`.
 * `hasLineupData`/`deltaThem` are additive (Phase 9) — `deltaThem` is
 * `computeTradeDrivers()`'s own `lineupDelta.deltaThem` (the counterparty's
 * real, computed best-lineup PPG change), the exact real signal Phase 8's
 * architecture note found genuinely feeds `acceptProbability` (unlike
 * `vorpDeltaThem`, confirmed dead) — persisted so corpus-composition
 * analysis (starter-involved vs. bench-depth trades) doesn't require a
 * live re-computation every time.
 */
export interface TradeBacktestOutput {
  acceptProb: number
  verdict: string
  confidenceScore: number
  lineupImpactScore: number
  vorpScore: number
  marketScore: number
  behaviorScore: number
  hasLineupData?: boolean
  deltaThem?: number | null
}

/** Trade-specific shape stored in `ReplayBacktestResult.realOutcome` — only populated once the underlying trade's provider status reflects a resolved decision. */
export interface TradeRealOutcome {
  outcome: 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'UNKNOWN'
  providerStatus: string
}

/**
 * Lineup-specific shapes (Phase 12 scaffolding — selected as the second Replay
 * Scenario, per docs/DECISION_OS_REPLAY_LINEUP_SCENARIO_SELECTION_ADR.md;
 * not yet consumed by any normalizer/executor, reserved for Phase 13).
 * `actualPoints` is deliberately real, historical, already-scored points
 * (e.g. Sleeper's `players_points`), never a projection — the whole point of
 * this replay type is grading a real manager's real lineup decision against
 * the real, deterministic optimal lineup for the points that actually came
 * in that week.
 */
export interface LineupReplayPlayer {
  /** Real, stable provider player ID — same convention as `TradeReplayRosterAsset.providerAssetId` (Phase 9). */
  providerAssetId: string
  name: string
  /** Multi-position eligibility, matching `OptimizerPlayerInput.positions` (`lib/lineup-optimizer-engine/types.ts`). */
  pos: string[]
  actualPoints: number
}

/** Lineup-specific shape stored in `ReplayImport.payload` (decisionType: 'lineup'). */
export interface LineupReplayPayload {
  /** The real historical providerAssetIds the manager actually started that week. */
  actualStarterIds: string[]
  /** Every rostered player that week, with real actual points. */
  fullRoster: LineupReplayPlayer[]
  /** League's roster slot definitions, same convention as `TradeBacktestInput.rosterPositions`. */
  slotPositions: string[]
}

/**
 * A single start/sit mistake detail — either a player who should have
 * started (per the real, unmodified `optimizeLineupDeterministic()`) but
 * didn't, or a player who was started but wasn't part of the optimal
 * lineup. Identified by real, stable `providerAssetId` (Phase 13), never a
 * synthetic index — matching the Phase 9 lesson from Trade Replay about ID
 * consistency across arrays that describe the same real player.
 */
export interface LineupMistakeDetail {
  providerAssetId: string
  name: string
  actualPoints: number
}

/**
 * Lineup-specific shape stored in `ReplayBacktestResult.backtestedOutput`
 * (decisionType: 'lineup'). Phase 13 (this phase) extended Phase 12's
 * original scaffolding (`actualPoints`/`optimalPoints`/`pointsLeftOnBench`/
 * `efficiencyPct`) with explicit start/sit mistake detail, per the task's
 * request for "points gained", "points lost", "start/sit mistakes", and
 * "bench value left" as distinct, non-redundant metrics:
 *
 * - `pointsLeftOnBench` (net) = `optimalPoints - actualPoints` — how much
 *   better the week COULD have gone overall.
 * - `benchValueLeft` (gross) = the real points scored by players who were
 *   part of the optimal lineup but sat on the actual bench — the literal
 *   "value left on the bench," which can be larger than `pointsLeftOnBench`
 *   if the manager's actual (wrong) starters also scored real points.
 * - `pointsFromSuboptimalStarters` (gross) = the real points the manager DID
 *   get from starting players who weren't part of the optimal lineup — the
 *   honest "points gained" from an imperfect decision, not zero.
 * - `startSitMistakeCount` = the number of players who should have started
 *   but didn't (equivalently, under normal roster-completeness, the number
 *   who started but shouldn't have).
 */
export interface LineupBacktestOutput {
  /** Sum of `starters_points` for the lineup the manager actually started. */
  actualPoints: number
  /** `optimizeLineupDeterministic()`'s `totalProjectedPoints` when fed real `actualPoints` as `projectedPoints`. */
  optimalPoints: number
  /** Net: `optimalPoints - actualPoints`. */
  pointsLeftOnBench: number
  /** `actualPoints / optimalPoints`, clamped [0,1] — 1.0 means the manager started the exact optimal lineup. */
  efficiencyPct: number
  /** Gross: real points scored by optimal-lineup players who sat on the actual bench. */
  benchValueLeft: number
  /** Gross: real points scored by actual starters who weren't part of the optimal lineup. */
  pointsFromSuboptimalStarters: number
  startSitMistakeCount: number
  missedOptimalStarters: LineupMistakeDetail[]
  subOptimalActualStarters: LineupMistakeDetail[]
}
