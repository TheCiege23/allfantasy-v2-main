/**
 * T2 Player Value Engine V1 — deterministic `normalizedTradeValue` (0–10000 scale).
 *
 * Pure functions only. No AI, no learning, no adaptation. The 0–10000 range follows the FantasyCalc
 * convention so values are comparable across the app. Inputs are captured at proposal time.
 *
 * ── Player formula ────────────────────────────────────────────────────────────
 *   base       = restOfSeasonProjection (points)            // primary signal
 *   scarcity   = POSITION_SCARCITY[position]                // positional premium
 *   adpPremium = clamp((ADP_PIVOT − adp) × ADP_SLOPE, …)    // lower ADP ⇒ small premium
 *   value      = clamp(round(base × PROJ_TO_VALUE × scarcity + adpPremium), 0, 10000)
 *
 * A ~330-pt elite RB (scarcity 1.15, no adp) → ~10000 (clamped); a ~120-pt flex → ~3800.
 *
 * ── Pick formula ──────────────────────────────────────────────────────────────
 *   roundBase discounted 15%/yr for future seasons (reference-only — redraft has no pick inventory).
 *
 * ── FAAB formula ──────────────────────────────────────────────────────────────
 *   value = amount × FAAB_VALUE_PER_DOLLAR
 */

export const PROJ_TO_VALUE = 26
export const ADP_PIVOT = 120
export const ADP_SLOPE = 6
export const ADP_PREMIUM_MIN = -600
export const ADP_PREMIUM_MAX = 1600
export const FAAB_VALUE_PER_DOLLAR = 18
export const PICK_FUTURE_DISCOUNT = 0.15

/**
 * Slice 16 — SCORING-AWARE VALUATION.
 *
 * `POSITION_SCARCITY` below is explicitly tuned for **standard 1-QB redraft**,
 * and until now that was the only shape the engine could express: a Superflex
 * league's QBs and a TE-premium league's tight ends were valued exactly like a
 * standard league's, so trades in those formats were graded against the wrong
 * market.
 *
 * These modifiers adjust positional scarcity for the real league settings the
 * app already resolves everywhere else. They are multiplicative on top of the
 * standard baseline and default to 1.0, so a league that supplies no scoring
 * context is valued byte-identically to before.
 *
 * Magnitudes follow well-established fantasy market behavior:
 *  - Superflex/2QB roughly doubles QB demand (a second QB-eligible starter
 *    makes ~24 QBs startable instead of ~12).
 *  - TE premium adds per-reception value that accrues almost entirely to TEs.
 *  - PPR lifts pass-catchers relative to standard; half-PPR is half the lift.
 */
export const SUPERFLEX_QB_MULTIPLIER = 1.6
export const TWO_QB_MULTIPLIER = 1.8
/** Per full point of TE premium, capped so an extreme setting can't run away. */
export const TE_PREMIUM_PER_POINT = 0.18
export const TE_PREMIUM_MAX_MULTIPLIER = 1.5
/** Full-PPR lift by position (half-PPR applies half of it). */
export const PPR_POSITION_LIFT: Record<string, number> = { WR: 0.08, TE: 0.10, RB: 0.04 }

export interface ScoringContext {
  /** Two QB-eligible starting slots where the second is a flex. */
  isSuperflex?: boolean | null
  /** Two dedicated QB slots — a strictly stronger requirement than superflex. */
  is2QB?: boolean | null
  /** Points per reception for TEs above the base rate (e.g. 0.5, 1). */
  tePremium?: number | null
  scoringFormat?: 'standard' | 'half_ppr' | 'ppr' | null
}

/**
 * Multiplier applied to a position's standard scarcity for this league's real
 * scoring settings. Returns exactly 1.0 when nothing relevant is configured.
 */
export function scoringScarcityMultiplier(
  position: string | null | undefined,
  scoring?: ScoringContext | null,
): number {
  if (!scoring || !position) return 1.0
  const pos = position.toUpperCase()
  let multiplier = 1.0

  if (pos === 'QB') {
    // 2QB is the stronger requirement and wins when both are set.
    if (scoring.is2QB) multiplier *= TWO_QB_MULTIPLIER
    else if (scoring.isSuperflex) multiplier *= SUPERFLEX_QB_MULTIPLIER
  }

  if (pos === 'TE' && scoring.tePremium != null && Number.isFinite(scoring.tePremium) && scoring.tePremium > 0) {
    multiplier *= Math.min(1 + scoring.tePremium * TE_PREMIUM_PER_POINT, TE_PREMIUM_MAX_MULTIPLIER)
  }

  const lift = PPR_POSITION_LIFT[pos]
  if (lift != null) {
    if (scoring.scoringFormat === 'ppr') multiplier *= 1 + lift
    else if (scoring.scoringFormat === 'half_ppr') multiplier *= 1 + lift / 2
  }

  return multiplier
}

/** Positional scarcity multipliers tuned for standard 1-QB redraft. */
export const POSITION_SCARCITY: Record<string, number> = {
  RB: 1.15,
  WR: 1.05,
  TE: 1.0,
  QB: 0.85,
  K: 0.55,
  DST: 0.6,
  DEF: 0.6,
  FLEX: 1.0,
}

export const PICK_ROUND_BASE: Record<number, number> = {
  1: 2500,
  2: 1200,
  3: 600,
  4: 320,
  5: 180,
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function scarcityFor(position: string | null | undefined): number {
  if (!position) return 1.0
  return POSITION_SCARCITY[position.toUpperCase()] ?? 1.0
}

/**
 * Slice 14 — MARKET FALLBACK. `AssetValueSnapshot.sources.fantasyCalcValue` has
 * always existed on the contract but was hardcoded `null` at every write site
 * ("deferred"), so the canonical engine could only price assets that carried a
 * projection. Surfaces whose only real value signal is market data — af-legacy
 * runs entirely on FantasyCalc — priced every player at 0, which after the
 * slice-11 honesty pass means "not gradeable at all".
 *
 * Market value is used ONLY when there is no usable projection. It is NOT
 * multiplied by positional scarcity: FantasyCalc values already embed
 * positional market demand, so applying scarcity again would double-count it.
 * The scale matches by construction — this module's 0–10000 range follows the
 * FantasyCalc convention (see the module docstring).
 *
 * Strictly additive: when a projection exists the result is byte-identical to
 * the pre-slice-14 formula.
 */
export function normalizedPlayerValue(input: {
  projection: number | null | undefined
  adp?: number | null
  position?: string | null
  /** Market value (FantasyCalc convention, 0–10000). Fallback basis only. */
  marketValue?: number | null
  /**
   * Slice 16 — real league scoring settings. Omitted ⇒ standard 1-QB redraft,
   * i.e. byte-identical to the pre-slice-16 result.
   */
  scoring?: ScoringContext | null
}): number {
  const hasProjection = Number.isFinite(input.projection as number) && (input.projection as number) > 0
  let adpPremium = 0
  if (input.adp != null && Number.isFinite(input.adp)) {
    adpPremium = clamp((ADP_PIVOT - input.adp) * ADP_SLOPE, ADP_PREMIUM_MIN, ADP_PREMIUM_MAX)
  }

  if (!hasProjection && input.marketValue != null && Number.isFinite(input.marketValue) && input.marketValue > 0) {
    return clamp(Math.round(input.marketValue), 0, 10000)
  }

  const base = Number.isFinite(input.projection as number) ? Math.max(0, input.projection as number) : 0
  const scarcity = scarcityFor(input.position) * scoringScarcityMultiplier(input.position, input.scoring)
  return clamp(Math.round(base * PROJ_TO_VALUE * scarcity + adpPremium), 0, 10000)
}

export function normalizedPickValue(input: {
  round: number | null | undefined
  pickSeason?: number | null
  currentSeason?: number | null
}): number {
  const round = Number.isFinite(input.round as number) ? Math.max(1, Math.round(input.round as number)) : 5
  const roundBase = PICK_ROUND_BASE[round] ?? 100
  let value = roundBase
  if (input.pickSeason != null && input.currentSeason != null && input.pickSeason > input.currentSeason) {
    const yearsOut = input.pickSeason - input.currentSeason
    value = Math.round(value * Math.pow(1 - PICK_FUTURE_DISCOUNT, yearsOut))
  }
  return clamp(value, 0, 10000)
}

export function normalizedFaabValue(amount: number | null | undefined): number {
  const amt = Number.isFinite(amount as number) ? Math.max(0, amount as number) : 0
  return clamp(Math.round(amt * FAAB_VALUE_PER_DOLLAR), 0, 10000)
}
