/**
 * League-local player value — the global price, bent by what a league actually pays.
 *
 * A player is worth what your league will pay for him, and that is not always the
 * consensus number. The idea is right; the failure mode is sharp enough to sink it
 * if implemented naively.
 *
 * ⚠ THE FAILURE MODE, STATED FIRST BECAUSE IT DRIVES EVERY DECISION HERE. A 12-team
 * league sees perhaps 20-40 trades a season and a given player appears in one or
 * two. Fitting a local price to one observation lets a single lopsided deal — or
 * one manager overpaying for his alma mater's running back — permanently corrupt
 * that player's league value. Users notice immediately, and it reads as "the site
 * is broken" rather than "the market is thin".
 *
 * The fix is the same empirical-Bayes discipline used for opponent history:
 *
 *     local = w · observed_local  +  (1 − w) · global,    w = n / (n + k)
 *
 * With n=1 the local signal barely moves the number. With n≫k it dominates. The
 * global value is the prior, and a thin local market never overrides it.
 */

export type TradeObservation = {
  /** Implied price for this player from one trade, in global-value units. */
  impliedValue: number
  /** Total assets across both sides — a 1-for-1 prices far more cleanly than 3-for-2. */
  assetCount: number
  /**
   * True when the two sides were in different competitive states (contender vs
   * rebuilder). See the weighting note below — these are not market prices.
   */
  crossState?: boolean
  /** Older trades count less; seasons before the current one decay. */
  season?: number
}

export type LocalValue = {
  globalValue: number
  localValue: number
  observations: number
  /** 0–1. How much the local market was trusted. Surface this, don't hide it. */
  shrinkageWeight: number
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT'
  /** Safe to show a user verbatim. */
  detail: string
}

/**
 * Shrinkage constant, in observations.
 *
 * ⚠ START HIGH AND TUNE DOWN, NEVER THE REVERSE. At k=12 a single trade carries
 * ~8% weight and twelve carry 50%. Tuning k downward later makes local signal
 * louder and is easy to justify from data; tuning it upward means retracting
 * numbers users have already seen and acted on. This is a placeholder pending
 * calibration on real trade volume, and it is deliberately conservative.
 */
const SHRINKAGE_K = 12

/** Per-season decay — a 2023 trade is weak evidence about a 2026 market. */
const SEASON_DECAY = 0.7

/**
 * Weight one observation.
 *
 * ⚠ A CROSS-STATE TRADE IS NOT A MARKET PRICE, IT IS TIMELINE ARBITRAGE. When a
 * contender overpays a rebuilder in win-now terms, that says something about the
 * two teams' windows and almost nothing about the player's standing value. Folding
 * it in at full weight would teach the model that every contender's panic buy is
 * the new price.
 *
 * ⚠ AND A 3-FOR-2 CANNOT PRICE ANY SINGLE PLAYER CLEANLY — the implied value is
 * split across assets by an attribution we are guessing at. Weight falls with
 * asset count so 1-for-1 deals, the only genuinely clean signal, dominate.
 */
function observationWeight(o: TradeObservation, currentSeason: number): number {
  const assets = Math.max(2, o.assetCount)
  // 1-for-1 (2 assets) = 1.0; 3-for-2 (5 assets) = 0.4.
  const cleanliness = 2 / assets
  const stateFactor = o.crossState ? 0.5 : 1
  const age = o.season != null ? Math.max(0, currentSeason - o.season) : 0
  return cleanliness * stateFactor * Math.pow(SEASON_DECAY, age)
}

export function computeLeagueLocalValue(args: {
  globalValue: number
  observations: TradeObservation[]
  currentSeason: number
}): LocalValue {
  const { globalValue, observations, currentSeason } = args

  if (!Number.isFinite(globalValue) || globalValue <= 0) {
    return {
      globalValue: 0,
      localValue: 0,
      observations: 0,
      shrinkageWeight: 0,
      confidence: 'INSUFFICIENT',
      detail: 'no global value on file for this player',
    }
  }

  if (observations.length === 0) {
    /*
     * ⚠ THE GLOBAL VALUE UNCHANGED, AND SAID SO. Returning the global number while
     * labelling it "league-adjusted" would claim an adjustment that never happened
     * — the same class of lie as a C grade that means no data.
     */
    return {
      globalValue,
      localValue: globalValue,
      observations: 0,
      shrinkageWeight: 0,
      confidence: 'INSUFFICIENT',
      detail: 'no trades in this league involve this player — showing the global value',
    }
  }

  let weightSum = 0
  let weighted = 0
  for (const o of observations) {
    if (!Number.isFinite(o.impliedValue)) continue
    const w = observationWeight(o, currentSeason)
    weightSum += w
    weighted += w * o.impliedValue
  }

  if (weightSum <= 0) {
    return {
      globalValue,
      localValue: globalValue,
      observations: observations.length,
      shrinkageWeight: 0,
      confidence: 'INSUFFICIENT',
      detail: 'trades involving this player are too old or too ambiguous to price from',
    }
  }

  const observedLocal = weighted / weightSum
  // Shrink on the EFFECTIVE weight, so five messy old trades cannot buy the
  // confidence of five clean recent ones.
  const w = weightSum / (weightSum + SHRINKAGE_K)
  const localValue = w * observedLocal + (1 - w) * globalValue

  const confidence: LocalValue['confidence'] =
    weightSum >= 12 ? 'HIGH' : weightSum >= 5 ? 'MEDIUM' : 'LOW'

  const delta = localValue - globalValue
  const dir = delta >= 0 ? 'above' : 'below'
  const n = observations.length

  return {
    globalValue: Math.round(globalValue),
    localValue: Math.round(localValue),
    observations: n,
    shrinkageWeight: Math.round(w * 100) / 100,
    confidence,
    /*
     * ⚠ THE OBSERVATION COUNT IS IN THE USER-FACING STRING ON PURPOSE.
     * "League-adjusted (based on 2 trades)" is honest and genuinely interesting.
     * An unqualified league-specific number implies a precision this cannot have,
     * which is the failure this whole codebase keeps having to undo.
     */
    detail:
      `league-adjusted from ${n} trade${n === 1 ? '' : 's'} — ` +
      `${Math.abs(Math.round(delta))} ${dir} the global value ` +
      `(${Math.round(w * 100)}% local weight)`,
  }
}

/**
 * Solve a trade for the implied price of one player.
 *
 * ⚠ ONLY MEANINGFUL WHEN EVERY OTHER ASSET IS PRICED. If any counterparty asset is
 * unvalued, the residual absorbs that unknown and the "implied price" is a
 * fabrication — the same partial-coverage trap the trade grader refuses on.
 * Returns null rather than a number in that case.
 */
export function impliedValueFromTrade(args: {
  /** Global values of the OTHER assets on the same side as the target player. */
  sameSideOthers: Array<number | null>
  /** Global values of every asset on the opposite side. */
  otherSide: Array<number | null>
}): number | null {
  const all = [...args.sameSideOthers, ...args.otherSide]
  if (all.some((v) => v == null)) return null

  const sameSide = args.sameSideOthers.reduce<number>((a, b) => a + (b ?? 0), 0)
  const other = args.otherSide.reduce<number>((a, b) => a + (b ?? 0), 0)

  // The target is worth what the other side paid, less what came with him.
  const implied = other - sameSide
  // A negative implied price is not information, it is a sign the trade was
  // lopsided enough that the residual is meaningless.
  return implied > 0 ? implied : null
}
