/**
 * T2 Trade Value Snapshot + Grader — shared types (deterministic foundation).
 *
 * No AI, no learning, no adaptation. Every value is a pure function of inputs captured at proposal
 * time. The snapshot is immutable once written.
 */

export const TRADE_VALUE_SNAPSHOT_VERSION = '1.0' as const

export type TradeAssetKind = 'player' | 'draft_pick' | 'faab' | 'future_consideration'

/** Raw value sources captured for a single asset. `null` = source not available at capture time. */
export interface AssetValueSources {
  projectionValue: number | null
  rankingValue: number | null
  adpValue: number | null
  fantasyCalcValue: number | null
}

/** Immutable per-asset snapshot row. */
export interface AssetValueSnapshot {
  kind: TradeAssetKind
  fromRosterId: string
  toRosterId: string
  // player
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
  // pick
  pickSeason?: number | null
  pickRound?: number | null
  pickLabel?: string | null
  // faab
  faabAmount?: number | null
  sources: AssetValueSources
  /** Deterministic normalized 0–10000 trade value for this asset. */
  internalValue: number
}

export interface TradeValueContext {
  sport: string
  leagueType: string
  scoring: string
  rosterFormat: string
  capturedAt: string
}

export interface SideTotals {
  rosterId: string
  total: number
  assets: AssetValueSnapshot[]
}

export interface TradeGrade {
  /**
   * A+ … F, or `null` when the inputs could not support a grade at all
   * (honesty pass): no side carried any resolvable value, so evenness is
   * undefined rather than perfect. Consumers must render the
   * `insufficientData` state instead of a letter.
   */
  grade: string | null
  /** sideA.total − sideB.total (positive = sideA receives more) */
  valueDifference: number
  /** 0–100, 100 = perfectly even. `null` when insufficientData. */
  fairnessScore: number | null
  /** 0–100, data completeness of the inputs */
  confidenceScore: number
  /**
   * True when NO asset on either side resolved to a real value. Previously
   * this produced total=0 on both sides → fairnessScore 100 → "A+ / within
   * normal market range" for a trade the engine knew nothing about.
   */
  insufficientData: boolean
  /** Deterministic, templated explanation lines (never AI-generated). */
  bullets: string[]
}

export interface CommissionerReview {
  /** Null when the grade could not be computed (insufficientData). */
  fairnessScore: number | null
  lopsided: boolean
  reviewRecommended: boolean
  /** Null when there was no resolvable value to build a range from. */
  similarValueRange: { low: number; high: number } | null
}

export interface TradeValueSnapshot {
  version: typeof TRADE_VALUE_SNAPSHOT_VERSION
  context: TradeValueContext
  /** Exactly two sides for a two-party trade: [proposer, receiver]. */
  sides: SideTotals[]
  grade: TradeGrade
  commissionerReview: CommissionerReview
}

export type TeamStance = 'contender' | 'rebuilder' | 'middle'

export interface TeamProfile {
  rosterId: string
  stance: TeamStance
  winPct: number
  pointsFor: number
  weakPositions: string[]
  strongPositions: string[]
  depthIssues: boolean
}
