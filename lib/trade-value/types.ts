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
  /**
   * League-specific value for an individual defensive player, 0-10000.
   *
   * ⚠ NOT A MARKET QUOTE, WHICH IS WHY IT IS NOT `fantasyCalcValue`. FantasyCalc prices no
   * defenders; this is computed from the league's own scoring and starting slots. Null for
   * every non-IDP asset and for any league that does not roster defenders.
   */
  idpValue: number | null
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
  /**
   * WHICH input decided `internalValue` — the answer to "why is this number what it is".
   *
   * Comes from `valueBasisFor` in the engine, which is the SAME function the engine branches on,
   * so a surface can label a number without re-deriving the precedence. Optional because
   * snapshots written before this field existed do not carry it, and absent must render as
   * "not recorded" rather than as any particular basis.
   *
   * ⚠ `none` IS A REFUSAL, NOT A ZERO VALUATION. It means no usable input reached the engine. A
   * bare `0` rendered next to a real 6,552 reads as "worthless" when it means "we could not price
   * him" — opposite claims, and only one of them is true.
   */
  valuationBasis?: 'idp' | 'market' | 'projection' | 'none' | null
  /**
   * The league FORMAT's opinion on this asset — a multiplier and a reason, or null.
   *
   * 🛑 DELIBERATELY NOT APPLIED TO `internalValue`. User's decision: format, need and injury
   * effects are a SEPARATE "fit" number shown beside the base, never folded into it. Base stays
   * market-objective so two managers in different leagues can compare the same player and argue
   * about it; the moment a format multiplier is baked in, that comparability goes and — worse —
   * the adjustment becomes invisible, with nothing saying which rule moved the number.
   *
   * Null means the league's format has no VALUE model.
   *
   * ⚠ This comment used to say "sixteen of sixteen coded formats today", which was wrong twice
   * over — the list of sixteen was built by counting string occurrences and included three things
   * that are not formats, and "no model" understated what exists: `lib/trade-intel/` already
   * carries per-format context and risk logic for most of them. What they lack is a model that
   * can move a number. See the header of `formats/registry.ts`.
   */
  formatFit?: {
    formatId: string | null
    label: string | null
    fit: { multiplier: number; reason: string } | null
    legality: { ok: boolean; reason?: string } | null
  } | null
}

export interface TradeValueContext {
  sport: string
  leagueType: string
  scoring: string
  rosterFormat: string
  capturedAt: string
  /**
   * Concept alias tags from the league's `conceptRules`.
   *
   * ⚠ OPTIONAL, AND ABSENT MEANS "NOT SUPPLIED", NEVER "NONE". `normalizeConcept.ts` flattens
   * `pirate_vampire` and `royal` onto `dynasty`, and `king_of_the_hill` and `idp` onto `redraft`,
   * so for those four leagues `leagueType` is actively misleading and the alias is the only place
   * the real format survives. A caller that has them should pass them; one that does not gets the
   * base format's model, which is the same answer it got before this field existed.
   */
  aliasTags?: string[] | null
  /** Dynasty and keeper inference, for `readFormatRules` when no id resolves. Optional. */
  isDynasty?: boolean | null
  keeperCount?: number | null
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
