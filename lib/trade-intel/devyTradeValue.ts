/**
 * What a college player is worth in a trade — in devy points, and only against
 * other devy assets.
 *
 * ⚠ READ devyOutlook.ts FIRST. Nothing prices college players: `DevyAdp` is
 * empty, no NCAAF trade-value source exists, and P(reaches the NFL) has never
 * been observed. That module explains why a devy asset cannot be quoted in
 * market units. This one answers the narrower question it left open — given two
 * devy assets, which side of a devy-for-devy trade is ahead — because that is
 * answerable and a devy manager asks it constantly.
 *
 * ── Why rank, and not the projected draft round ────────────────────────────
 *
 * ⚠ `DevyPlayer.projectedDraftRound` LOOKS like the obvious input and would be
 * a trap. Measured against production 2026-08-25:
 *
 *     round 1:   0 players          round 4: 347   avg recruiting 0.907
 *     round 2:   4 players          round 5: 417   avg recruiting 0.877
 *     round 3:  44 players          null:    906
 *
 * There is not one projected first-rounder in the entire pool, and 764 of the
 * 812 rated players sit in rounds 4-5. That is not a scouting projection, it is
 * an artifact of `estimateProjectedDraftRound` in lib/devy-intel.ts, which
 * scores `recruitingComposite * 40 + production * 0.4` — and
 * `computeRecruitingComposite` RETURNS 0.75 FOR A PLAYER WITH NO RECRUITING DATA
 * while `computeProductionIndex` reads missing stats as `|| 0`. An unknown
 * player therefore scores 30 and lands in round 5-6 with total confidence.
 *
 * Average recruiting does fall monotonically across those buckets, so the ORDER
 * carries signal. The LABELS do not: pricing a player off `pickRoundShare(5)`
 * would put him at 7.2% of a first on the strength of a number that mostly
 * records how much data we hold about him.
 *
 * This is the same lesson afValue.ts learned on real market data — two sources
 * agreed on order at Spearman 0.939 and disagreed on scale by up to 7x. Order
 * survives. Scale does not. So rank is the input here and the round label is
 * never read.
 *
 * ── Why a curve at all ─────────────────────────────────────────────────────
 *
 * ⚠ ORDINAL SCORES CANNOT BE ADDED, AND ADDING THEM IS THE CLASSIC WAY TO LOSE A
 * TRADE. `devyOutlook` returns 0-100 standing; two players at 50 are not worth
 * one player at 100, because value curves are convex — the top asset is worth
 * far more than twice the tenth. Summing raw standings would make every
 * quantity-for-quality trade look like a win for the side receiving quantity.
 *
 * ⚠ THE CURVE SHAPE IS BORROWED, AND THAT IS AN ANALOGY RATHER THAN A
 * MEASUREMENT. lib/pick-curve.ts holds one shape, fitted across 771 real dynasty
 * trades, and it is explicitly documented as shape-only with each caller keeping
 * its own scale. A devy board is functionally a draft board — devy rookie drafts
 * select from it in order — and both price UNPRODUCED claims on future NFL
 * production, which is the justification for reusing the shape. It is not
 * evidence about college players, and no devy trade has ever tested it.
 *
 * ⚠ THE ANCHOR IS DEVY POINTS AND CONVERTS TO NOTHING. `DEVY_FIRST_PICK_VALUE`
 * is a denomination, not a price. It is deliberately not
 * `FIRST_ROUND_IN_MARKET_UNITS` — reaching for that constant is exactly how a
 * devy asset would acquire a market price nobody measured.
 */

import { pickRoundShare } from '@/lib/pick-curve'
import { DEVY_GAPS, type DevyOutlook } from './devyOutlook'

/**
 * What the top devy asset is worth, in devy points.
 *
 * ⚠ A DENOMINATION, NOT A PRICE. Round numbers on purpose, so nobody mistakes
 * this for a measurement. Only ratios between devy assets carry meaning.
 */
export const DEVY_FIRST_PICK_VALUE = 1000

/** The scale tag, distinct from every market scale in the repo. */
export const DEVY_POINTS = 'devy-points' as const
export type DevyPointsScale = typeof DEVY_POINTS

/**
 * How many devy assets a "round" of the board holds.
 *
 * The pick curve is round-granular, so rank must be bucketed to read it. Twelve
 * matches the league size every stored market price already assumes
 * (BASELINE_LEAGUE_SIZE in valueLedger.ts), and a devy round in a 12-team league
 * is twelve players.
 */
export const DEVY_ROUND_SIZE = 12

/**
 * Where a given devy rank sits on the curve, as a share of the top asset.
 *
 * ⚠ INTERPOLATED WITHIN THE ROUND, WHICH THE PICK CURVE ITSELF DOES NOT DO — and
 * the difference is justified. A future pick is a round-level asset because its
 * SLOT IS UNKNOWN, so quoting every second-rounder the same price is the honest
 * answer there. A devy player's rank IS known, and flattening ranks 1-12 to one
 * value would throw away the only signal we have: it would price the best
 * prospect on the board identically to the twelfth.
 *
 * Geometric interpolation between the measured round anchors, so the anchors are
 * hit exactly at each round boundary and the decay in between is monotone. The
 * interpolation is an assumption; the anchors are the measurement.
 *
 * Past the deepest observed round the pick curve holds its last share rather
 * than extrapolating, so this flattens there too and a deep prospect keeps a
 * floor instead of decaying to free.
 */
export function devyShareAtRank(devyRank: number, roundSize = DEVY_ROUND_SIZE): number {
  const t = (devyRank - 1) / roundSize
  const round = Math.floor(t) + 1
  const fraction = t - Math.floor(t)

  const here = pickRoundShare(round)
  const next = pickRoundShare(round + 1)
  if (fraction === 0 || next === here) return here

  return here * Math.pow(next / here, fraction)
}

export type DevyAssetValue = {
  scale: DevyPointsScale
  /** Devy points. Null when the player is not ranked — never 0. */
  value: number | null
  /** 1 = the best devy asset on the board. */
  devyRank: number | null
  /**
   * Which slice of the board he sits in, used only to read the curve.
   * ⚠ NOT a projected NFL draft round and must never be shown as one.
   */
  boardRound: number | null
  timeDiscount: number | null
  gaps: string[]
  basis: string
}

/**
 * Price one ranked devy asset.
 *
 * `outlook` supplies the horizon discount and the honesty flags already computed
 * by devyOutlook, so the two modules cannot drift on how a wait is priced.
 */
export function devyAssetValue(args: {
  /** 1-based position on the devy board. Null when he could not be ranked. */
  devyRank: number | null
  outlook: Pick<DevyOutlook, 'timeDiscount' | 'gaps' | 'score'>
  name?: string | null
  roundSize?: number
}): DevyAssetValue {
  const { devyRank, outlook } = args
  const roundSize = args.roundSize ?? DEVY_ROUND_SIZE
  const who = args.name ?? 'this player'

  const gaps = [...outlook.gaps, DEVY_CURVE_GAP]

  if (devyRank == null || !Number.isFinite(devyRank) || devyRank < 1) {
    return {
      scale: DEVY_POINTS,
      value: null,
      devyRank: null,
      boardRound: null,
      timeDiscount: outlook.timeDiscount,
      gaps,
      basis: `${who} could not be ranked against the devy board, so he carries no devy value here. That is an absence of signal, not a low valuation.`,
    }
  }

  const boardRound = Math.ceil(devyRank / roundSize)
  const share = devyShareAtRank(devyRank, roundSize)
  /*
   * The horizon discount is applied on top of the curve rather than folded into
   * the rank, because they answer different questions: rank says how good he is
   * thought to be, the discount says how long the wait is. A caller that wants
   * one without the other can see both terms.
   */
  const discount = outlook.timeDiscount ?? 1
  const value = Math.round(DEVY_FIRST_PICK_VALUE * share * discount)

  return {
    scale: DEVY_POINTS,
    value,
    devyRank,
    boardRound,
    timeDiscount: outlook.timeDiscount,
    gaps,
    basis:
      `${who} is devy asset #${devyRank} on this board, which reads off the curve at ` +
      `${Math.round(share * 100)}% of a top devy asset` +
      (outlook.timeDiscount != null && outlook.timeDiscount < 1
        ? `, then ${Math.round(discount * 100)}% of that for the wait, giving ${value} devy points.`
        : `, giving ${value} devy points.`) +
      ' Devy points compare devy assets to each other and convert to nothing else.',
  }
}

export const DEVY_CURVE_GAP =
  'the value curve shape is borrowed from the NFL rookie-pick curve, which was fitted to pro trades — no devy trade has ever tested it'

export type DevyTradeSide = {
  label: string
  value: DevyAssetValue
}

export type DevyTradeVerdict = {
  scale: DevyPointsScale
  giveTotal: number
  getTotal: number
  /** get - give, in devy points. Positive means the viewer gains. */
  net: number
  /** Assets we could not price, by side. */
  giveUnpriced: string[]
  getUnpriced: string[]
  /**
   * False when the unpriced share is large enough that the totals do not
   * describe the deal. A verdict is withheld rather than qualified.
   */
  conclusive: boolean
  basis: string
  gaps: string[]
}

/**
 * Compare two sides of a devy-for-devy trade.
 *
 * ⚠ REFUSES WHEN EITHER SIDE IS ENTIRELY UNPRICED. Summing one ranked player
 * against two unranked ones and reporting a winner would be arithmetic on a
 * number we do not have — the same defect as grading a trade C off zero points
 * (see hasNoSignal in tradeGradeEmail.ts).
 *
 * ⚠ THIS DOES NOT HANDLE MIXED TRADES. A deal containing NFL assets must go
 * through refuseMixedScaleGrade in devyOutlook.ts first; devy points and market
 * values do not share an axis.
 */
export function gradeDevyTrade(args: {
  give: DevyTradeSide[]
  get: DevyTradeSide[]
}): DevyTradeVerdict {
  const sum = (side: DevyTradeSide[]) =>
    side.reduce((acc, a) => acc + (a.value.value ?? 0), 0)
  const unpriced = (side: DevyTradeSide[]) =>
    side.filter((a) => a.value.value == null).map((a) => a.label)

  const giveTotal = sum(args.give)
  const getTotal = sum(args.get)
  const giveUnpriced = unpriced(args.give)
  const getUnpriced = unpriced(args.get)

  const gaps = [...new Set([...args.give, ...args.get].flatMap((a) => a.value.gaps))]

  /*
   * A side with assets, none of which could be priced, contributes 0 to a
   * comparison — which reads as "he gave up nothing" rather than "we cannot
   * see what he gave up".
   */
  const giveBlind = args.give.length > 0 && giveUnpriced.length === args.give.length
  const getBlind = args.get.length > 0 && getUnpriced.length === args.get.length
  const conclusive = !giveBlind && !getBlind

  if (!conclusive) {
    const blindSide = giveBlind ? 'sending' : 'receiving'
    const names = (giveBlind ? giveUnpriced : getUnpriced).join(', ')
    return {
      scale: DEVY_POINTS,
      giveTotal,
      getTotal,
      net: getTotal - giveTotal,
      giveUnpriced,
      getUnpriced,
      conclusive: false,
      gaps,
      basis: `No verdict: every player you are ${blindSide} (${names}) is unranked on the devy board, so one side of this deal has no value at all to compare. Treating that as zero would report the other side as a free win.`,
    }
  }

  const net = getTotal - giveTotal
  const partial = giveUnpriced.length + getUnpriced.length
  const caveat =
    partial > 0
      ? ` ${partial} player${partial === 1 ? '' : 's'} in this deal could not be ranked and ${
          partial === 1 ? 'is' : 'are'
        } not counted on either total.`
      : ''

  const direction =
    net === 0
      ? 'Both sides come out level in devy points.'
      : net > 0
        ? `You gain ${net} devy points.`
        : `You give up ${Math.abs(net)} devy points.`

  return {
    scale: DEVY_POINTS,
    giveTotal,
    getTotal,
    net,
    giveUnpriced,
    getUnpriced,
    conclusive: true,
    gaps,
    basis: `${direction} You send ${giveTotal} and receive ${getTotal}, counted in devy points, which rank devy assets against each other and do not convert to the values used for NFL players.${caveat}`,
  }
}

/**
 * Rank a devy pool by standing, best first.
 *
 * ⚠ UNSCORED PLAYERS ARE NOT RANKED LAST, THEY ARE NOT RANKED. `devyOutlook`
 * returns null when no scouting signal exists, and sorting those to the bottom
 * would state that we know they are the worst assets available.
 */
export function rankDevyPool<T>(
  pool: Array<{ item: T; outlook: Pick<DevyOutlook, 'score'> }>,
): Array<{ item: T; devyRank: number | null }> {
  const scored = pool
    .filter((p) => p.outlook.score != null)
    .sort((a, b) => (b.outlook.score as number) - (a.outlook.score as number))

  const rankOf = new Map<unknown, number>()
  scored.forEach((p, i) => rankOf.set(p.item, i + 1))

  return pool.map((p) => ({ item: p.item, devyRank: rankOf.get(p.item) ?? null }))
}

/** Re-exported so a consumer holding only this module still names the market gap. */
export { DEVY_GAPS }
