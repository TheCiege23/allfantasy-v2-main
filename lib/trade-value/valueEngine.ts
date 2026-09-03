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

import { pickRoundTable, pickValueByOverall } from '@/lib/pick-curve'
import { demandMultiplier, type LeagueShape } from './leagueShape'

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
  /**
   * The league's real structural shape — team count and starting slots.
   *
   * 🛑 WHEN PRESENT THIS SUPERSEDES `isSuperflex` / `is2QB` FOR POSITIONAL DEMAND, AND MUST, OR
   * THE TWO WOULD MULTIPLY. Both answer the same question — how much does this league want at
   * this position — and the shape answers it from counts rather than from a two-state flag.
   *
   * The booleans could only say "one QB or more than one". Measured against real leagues here,
   * that collapsed 2QB, 3QB, 4QB (Four Horsemen) and 6QB into a single multiplier, and it made
   * a 4-team league indistinguishable from a 32-team one. `demandMultiplier` is exactly 1.0 for
   * the reference 12-team shape, so supplying a standard league changes nothing.
   *
   * `tePremium` and `scoringFormat` still apply on top: those are SCORING facts, not roster
   * facts, and the shape says nothing about them.
   */
  shape?: LeagueShape | null
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

  if (scoring.shape) {
    /*
     * Shape wins outright. It covers every position, not just QB, so a 6-WR / 10-FLEX league
     * gets its receiver demand priced too — something the booleans had no way to express.
     */
    multiplier *= demandMultiplier(scoring.shape, pos)
  } else if (pos === 'QB') {
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

/**
 * Unchanged in value — this module's shape was the one that best matched observed trades, so
 * collapsing the five curves adopted it. It now comes from `lib/pick-curve.ts` so the other
 * modules cannot drift away from it again.
 */
export const PICK_ROUND_BASE: Record<number, number> = pickRoundTable(2500)

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * ── 1.7f · THE SOFT KNEE ─────────────────────────────────────────────────────────────────────
 *
 * 🛑 A HARD CLAMP DOES NOT CAP A VALUE, IT DELETES AN ORDERING. Measured before this landed, in
 * a superflex league:
 *
 *     340 pts → 10000     380 pts → 10000     420 pts → 10000     460 pts → 10000
 *
 * Four quarterbacks, four different players, one number. The uncapped value at 460 pts is 16,266
 * — 1.63× the ceiling — so the engine HAD the information and the clamp threw it away. And it did
 * so precisely in superflex/2QB/4QB, the formats where QB separation is the whole point.
 *
 * Below {@link SOFT_KNEE} nothing changes. Above it the excess is compressed onto the remaining
 * headroom by `headroom × excess / (excess + headroom)`, which:
 *   - is continuous AND smooth at the knee (its derivative there is exactly 1), so there is no
 *     visible kink at the boundary;
 *   - is strictly increasing, so ordering is preserved;
 *   - approaches 10000 asymptotically and never reaches it, so the ceiling still holds.
 *
 * ⚠ IT IS RATIONAL, NOT EXPONENTIAL, AND THE FIRST VERSION WAS EXPONENTIAL. `1 − e^(−x/h)`
 * satisfies every property above ON PAPER and fails one of them in float64: `Math.exp` underflows
 * to exactly 0 around x/h ≈ 745, so `softCap` returned exactly 10000 and the ordering it exists to
 * protect was lost again. Worse, after `Math.round` the exponential form saturated at a raw value
 * of only ~20,500 — and a 6-QB league can produce ~24,900, so the collapse was still reachable by
 * a real league.
 *
 * The rational form decays polynomially instead, and keeps distinct integers up to a raw value of
 * ~4.5 MILLION — roughly 180× anything the formula can produce. A test asserting the asymptote is
 * what caught this; the property was correct and the implementation of it was not.
 *
 * ⚠ THIS IS A SAFETY NET, NOT THE REAL FIX. The formula only overshoots because `PROJ_TO_VALUE`
 * = 26 is calibrated for season-long PPR points and is too hot once positional and format
 * multipliers stack. Recalibrating it (plan step 1.5) is the actual repair; this guarantees that
 * when it does overshoot, no information is lost.
 *
 * ⚠ AND IT IS NOT FREE: values in [SOFT_KNEE, 10000) SHIFT DOWN. A raw 8600 moves ~3 points
 * (0.03%); a raw 9828 moves ~447 (4.5%). That is the unavoidable cost — fitting an unbounded
 * range into a bounded one while preserving order requires compressing somewhere, and the top
 * decile is the least damaging place. Stated here rather than discovered later.
 */
export const SOFT_KNEE = 8500
export const VALUE_CEILING = 10000

export function softCap(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  if (raw <= 0) return 0
  if (raw <= SOFT_KNEE) return raw
  const headroom = VALUE_CEILING - SOFT_KNEE
  const excess = raw - SOFT_KNEE
  return SOFT_KNEE + (headroom * excess) / (excess + headroom)
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
   * The league's own value for an individual defender, same 0–10000 convention.
   *
   * ⚠ THIS OUTRANKS THE PROJECTION, WHICH IS THE OPPOSITE OF HOW `marketValue` BEHAVES, AND
   * THE ASYMMETRY IS THE POINT. For an offensive player a projection is the better signal, so
   * market value is a fallback. For a defender the projection reaching this function is the
   * vendor's generic PPR line — and standard PPR contains no defensive scoring at all, so it
   * is not a low projection, it is the absence of one wearing a number. Measured on a real
   * roster: 0.3 for a linebacker his league projects in the teens. Letting that through as
   * `hasProjection` prices him at roughly nothing and the fallback never fires.
   */
  idpValue?: number | null
  /**
   * Slice 16 — real league scoring settings. Omitted ⇒ standard 1-QB redraft,
   * i.e. byte-identical to the pre-slice-16 result.
   */
  scoring?: ScoringContext | null
}): number {
  /*
   * The IDP value is checked FIRST and returns immediately. It is already the output of a
   * scarcity model — ranked against this league's own starting requirements — so multiplying
   * it by `POSITION_SCARCITY` would count positional scarcity twice, and that table has no IDP
   * entry anyway: LB, DL and DB all fall through to its 1.0 default.
   */
  return explainPlayerValue(input).value
}

/** One step of the derivation, with the running value after it. */
export interface ValueDerivationStep {
  label: string
  /** A sentence a manager can argue with. Never a formula alone. */
  detail: string
  /** The running value after this step. */
  value: number
}

export interface ValueDerivation {
  value: number
  basis: ValueBasis
  steps: ValueDerivationStep[]
}

/**
 * The full derivation chain behind a player's value.
 *
 * ── 🛑 THIS IS THE ONE IMPLEMENTATION. `normalizedPlayerValue` RETURNS `.value` FROM IT ────
 * An explainer that re-walks the engine's arithmetic is a second implementation of the pricing
 * rule, and it drifts the first time either side changes — silently, because an explanation that
 * disagrees with a price still reads perfectly. So the arithmetic lives here once and the engine
 * delegates, which makes "the explanation matches the number" true by construction rather than by
 * a test that has to be remembered.
 */
export function explainPlayerValue(input: {
  projection: number | null | undefined
  adp?: number | null
  position?: string | null
  marketValue?: number | null
  idpValue?: number | null
  scoring?: ScoringContext | null
}): ValueDerivation {
  const basis = valueBasisFor(input)
  const steps: ValueDerivationStep[] = []

  if (basis === 'idp') {
    const v = clamp(Math.round(input.idpValue as number), 0, 10000)
    steps.push({
      label: 'IDP scarcity model',
      detail:
        "Priced against this league's own defensive starting slots and scoring. No market ranks defenders, so this is computed rather than quoted — and positional scarcity is NOT applied on top, because it is already inside this number.",
      value: v,
    })
    return { value: v, basis, steps }
  }

  let adpPremium = 0
  if (input.adp != null && Number.isFinite(input.adp)) {
    adpPremium = clamp((ADP_PIVOT - input.adp) * ADP_SLOPE, ADP_PREMIUM_MIN, ADP_PREMIUM_MAX)
  }

  if (basis === 'market') {
    const v = clamp(Math.round(input.marketValue as number), 0, 10000)
    steps.push({
      label: 'Market value',
      detail:
        'No usable projection, so this falls back to the market price. Positional scarcity is NOT applied: a market value already embeds positional demand, and multiplying again would count it twice.',
      value: v,
    })
    return { value: v, basis, steps }
  }

  /*
   * 🛑 `none` DOES NOT SHORT-CIRCUIT, AND AN EARLIER DRAFT OF THIS FUNCTION MADE IT DO SO.
   *
   * It looked obviously right — no projection, no market, no IDP, so return 0 with a "not priced"
   * note. Measured against the pre-extraction engine: a WR with no projection and an ADP of 10 was
   * priced at 660 and became 0. The whole existing suite stayed green, because nothing covers a
   * player carrying an ADP alone.
   *
   * The original falls through to the projection path with `base = 0`, so the ADP premium still
   * lands. That behaviour is preserved here deliberately — an explainer that changes a price is
   * not an explainer. Whether pricing a player off draft capital alone is RIGHT is a separate
   * question and a real one; it is not this function's to decide silently.
   */
  const base = Number.isFinite(input.projection as number) ? Math.max(0, input.projection as number) : 0
  steps.push({
    label: basis === 'none' ? 'No projection' : 'Projection',
    detail:
      basis === 'none'
        ? 'No projection, market value or defensive value reached the engine, so the points term is zero. This is a gap in the inputs, NOT a judgement that the player is worthless.'
        : `${base} projected points for the rest of the season.`,
    value: base,
  })

  const afterScale = base * PROJ_TO_VALUE
  steps.push({
    label: `× ${PROJ_TO_VALUE}`,
    detail: `Points converted to the 0–${VALUE_CEILING} value scale.`,
    value: afterScale,
  })

  const scarcity = scarcityFor(input.position) * scoringScarcityMultiplier(input.position, input.scoring)
  const afterScarcity = afterScale * scarcity
  steps.push({
    label: `× ${scarcity.toFixed(2)} scarcity`,
    detail:
      scarcity === 1
        ? 'Position carries no scarcity adjustment in this league.'
        : `How hard ${input.position ?? 'this position'} is to replace, given the league's starting slots and scoring.`,
    value: afterScarcity,
  })

  let running = afterScarcity
  if (adpPremium !== 0) {
    running = afterScarcity + adpPremium
    steps.push({
      label: `${adpPremium > 0 ? '+' : ''}${Math.round(adpPremium)} draft capital`,
      detail: `Where the player is being drafted, relative to pick ${ADP_PIVOT}. Capped at ${ADP_PREMIUM_MAX} either way so draft position can nudge a value, never decide it.`,
      value: running,
    })
  }

  // 1.7f: soft knee instead of a hard clamp, so two elite players never collapse to one number.
  const knee = softCap(running)
  if (Math.round(knee) !== Math.round(running)) {
    steps.push({
      label: 'Soft knee',
      detail: `Above ${SOFT_KNEE} the scale compresses toward ${VALUE_CEILING} rather than clipping, so two elite players stay distinguishable instead of collapsing to the same number.`,
      value: knee,
    })
  }

  const value = clamp(Math.round(knee), 0, VALUE_CEILING)
  return { value, basis, steps }
}

/**
 * Which input decided a player's value — the answer to "why is this number what it is".
 *
 * ── 🛑 THIS IS THE ONE IMPLEMENTATION, AND `normalizedPlayerValue` CALLS IT ─────────────────
 * The obvious way to label a value in the UI is to re-check the same conditions there. That is
 * two implementations of one rule, and this repo has already measured what that costs: a SQL copy
 * of `normalizePlayerName` disagreed with the real one on 7.2% of rows. So the branch decision
 * lives here, the engine branches on its result, and a surface that wants to explain a number
 * calls the same function rather than reasoning about `sources` for itself.
 *
 * ⚠ `adp` IS NEVER A BASIS. It is a PREMIUM added to the projection path — capped, and worth at
 * most a few hundred points — so a player with an ADP and no projection is priced from the market
 * or not at all. Reporting "priced from ADP" would name an input that never decides the number.
 */
export type ValueBasis = 'idp' | 'market' | 'projection' | 'none'

export function valueBasisFor(input: {
  projection?: number | null
  marketValue?: number | null
  idpValue?: number | null
}): ValueBasis {
  /*
   * IDP first and unconditionally, mirroring the engine: it is already the output of a scarcity
   * model ranked against this league's own starting slots, so nothing downstream applies to it.
   */
  if (input.idpValue != null && Number.isFinite(input.idpValue) && input.idpValue > 0) return 'idp'

  const hasProjection =
    Number.isFinite(input.projection as number) && (input.projection as number) > 0
  if (hasProjection) return 'projection'

  if (
    input.marketValue != null &&
    Number.isFinite(input.marketValue) &&
    input.marketValue > 0
  ) {
    return 'market'
  }

  /*
   * ⚠ `none` MEANS THE ENGINE PRICED HIM AT ZERO FROM NO USABLE INPUT — which is a refusal, not a
   * valuation, and a surface must say so in words. A rendered `0` beside a real 6,552 reads as
   * "worthless" when it means "we could not price him", and those are opposite claims.
   */
  return 'none'
}

export function normalizedPickValue(input: {
  round: number | null | undefined
  pickSeason?: number | null
  currentSeason?: number | null
  /**
   * Teams in the league. Omit ⇒ 12, i.e. byte-identical to the pre-shape behaviour.
   *
   * 🛑 A ROUND IS NOT AN ASSET; AN OVERALL PICK NUMBER IS. Keyed on round alone this function
   * assumed every league had 12 teams. Measured against real leagues here, that was wrong in
   * both directions — a Four Horsemen (4-team) 3rd is overall #9 and was priced at 600 when the
   * league's own rulebook puts it in the 1.9-1.12 range (~2000); a KBFL (32-team) 2nd is overall
   * #33 and was priced as a 12-team 2nd when it is really a 12-team 3rd.
   */
  teams?: number | null
  /** Pick within the round, 1-indexed. Omit ⇒ the round's mid slot. */
  slot?: number | null
}): number {
  const round = Number.isFinite(input.round as number) ? Math.max(1, Math.round(input.round as number)) : 5
  /*
   * ⚠ THIS ALSO RETIRES THE `?? 100` FLOOR, WHICH WAS A SECOND BUG. `PICK_ROUND_BASE` holds five
   * entries, so every round past the fifth fell to a flat 100 — in a 10-round rookie draft
   * (Four Horsemen) that priced rounds 6 through 10 IDENTICALLY. `pick-curve.ts` already had the
   * right policy for this and valueEngine simply was not using it: hold the last OBSERVED share
   * rather than inventing a decay past where the data ran out.
   */
  let value = pickValueByOverall({
    round,
    teams: input.teams,
    slot: input.slot,
    firstRoundValue: PICK_ROUND_BASE[1],
  })
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
