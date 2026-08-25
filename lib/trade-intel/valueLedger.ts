/**
 * The player value ledger — what a player is worth HERE, and what we still
 * cannot see.
 *
 * ⚠ FANTASYCALC IS THE ANCHOR, NOT THE ANSWER. It is the right baseline because
 * it is liquid, dated, format-matched and everyone already argues in its units.
 * It knows nothing about your league's scoring, and it knows nothing about the
 * manager sitting across the trade.
 *
 * So value is a triple, not a number:
 *
 *     value(player, league, counterparty)
 *
 * The same tight end is one price in a 0.5-PPR one-QB league and another in a
 * TE-premium superflex — and the price you should pay to acquire him depends on
 * a third thing, which is who holds him and what they need. Ship a scalar and
 * you have built a ranking site.
 *
 * ── The layers, and which of them exist ────────────────────────────────────
 *
 *   0  market baseline    BUILT   PlayerValueSnapshot, format-matched
 *   1  league fit         BUILT   exact dot product against league scoring
 *   2  trajectory         GAP     age curve, recency, snap share, depth chart
 *   3  situation          GAP     pace, coordinator, weather splits, durability
 *   4  microstructure     BUILT   disagreement, liquidity, momentum
 *   5  counterparty       BUILT   per-trade, via priceForCounterparty()
 *
 * ⚠ EVERY LAYER THAT CANNOT COMPUTE RETURNS NULL AND NAMES ITSELF IN `gaps`. It
 * must never return 1.0, which is a silent claim that the layer ran and found no
 * effect. "No adjustment" and "did not look" are different statements and a
 * trade screen has to be able to tell a manager which one it is making.
 */

import 'server-only'

import { prisma } from '@/lib/prisma'
import { lookupProjections } from '@/lib/core-app/playerProjections'
import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'
import { valueAtRankFrom } from './afValue'
import { counterpartyPriceDelta, type RosterNeed } from './rosterNeed'

/**
 * The scoring the market baseline is priced on.
 *
 * ⚠ THE PPR VALUE IS A FACT; THE REST IS A STATED ASSUMPTION. All four
 * snapshot variants are fetched at `ppr=1&numTeams=12` — see
 * `lib/player-values/ingestPlayerValues.ts` — so full-point receptions are
 * certain. FantasyCalc does not publish the rest of its internal scoring, so
 * the remaining keys are the industry-standard PPR map, written down here
 * rather than buried, because every number layer 1 produces is relative to it.
 *
 * If this is wrong, it is wrong in the same direction for every player, so it
 * shifts the whole board rather than reordering it — and reordering is the only
 * thing that survives into the output. That is what makes the assumption
 * tolerable, and it is why `priceByAdjustedRank` works the way it does.
 */
export const BASELINE_SCORING: Record<string, number> = {
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rush_yd: 0.1,
  rush_td: 6,
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  fum_lost: -2,
}

/**
 * League size is NOT matched either — every snapshot is a 12-team price.
 * Replacement level moves with league size, so a 10- or 14-team league is
 * priced slightly wrong at the margins. Named so it can be fixed rather than
 * discovered.
 */
export const BASELINE_LEAGUE_SIZE = 12

/** A layer that either applied, or refused and said why. */
export type LedgerLayer = {
  /**
   * What the layer multiplied the value beneath it by. Null means the layer
   * could not run — NOT that it ran and found no effect.
   */
  factor: number | null
  /** Plain-language reason, shown to the manager. Always present. */
  basis: string
}

/** How thin and how contested this price is. Layer 4. */
export type Microstructure = {
  /** Market disagreement, in the source's own value units. */
  stdDev: number | null
  /** Share of leagues the player is traded in, where the source publishes it. */
  tradeFrequency: number | null
  /** 30-day movement, in value units. */
  trend30d: number | null
  /**
   * ⚠ A HIGH PRICE WITH NEAR-ZERO TRADE FREQUENCY IS A THIN PRICE. It has rarely
   * been tested by an actual trade, so it is a weaker claim than the same number
   * on a player who changes hands constantly. Nothing in the product said so.
   */
  liquidity: 'thin' | 'normal' | 'liquid' | null
  /** Wide disagreement is where an edge lives; narrow is a settled price. */
  agreement: 'contested' | 'settled' | null
}

export type ValueLedger = {
  sleeperId: string
  name: string
  position: string | null

  /** Layer 0. Null when we hold no price in this league's format. */
  baseline: {
    value: number
    source: string
    format: string
    qbFormat: string
    capturedAt: Date
    overallRank: number | null
  } | null

  leagueFit: LedgerLayer

  microstructure: Microstructure

  /**
   * The composed number, on FantasyCalc's own scale so it is comparable with
   * every price a manager has already seen. Null whenever the baseline is null —
   * there is nothing to adjust.
   */
  value: number | null

  /**
   * Layers that did not run, named. A screen that shows a number without this
   * is claiming more certainty than we have.
   */
  gaps: string[]
}

/**
 * Liquidity thresholds.
 *
 * ⚠ THESE ARE PRESENTATION BANDS, NOT MODEL PARAMETERS. Nothing downstream
 * multiplies by them; they only decide which word appears next to a number the
 * manager can also see. Chosen so the tails are named and the middle is quiet.
 */
const THIN_TRADE_FREQUENCY = 0.02
const LIQUID_TRADE_FREQUENCY = 0.15
/** Disagreement worth remarking on, as a share of the player's own value. */
const CONTESTED_STDDEV_SHARE = 0.12

export function classifyMicrostructure(row: {
  value: number
  marketStdDev: number | null
  tradeFrequency: number | null
  trend30d: number | null
}): Microstructure {
  const { marketStdDev, tradeFrequency, trend30d } = row

  return {
    stdDev: marketStdDev,
    tradeFrequency,
    trend30d,
    liquidity:
      tradeFrequency == null
        ? null
        : tradeFrequency <= THIN_TRADE_FREQUENCY
          ? 'thin'
          : tradeFrequency >= LIQUID_TRADE_FREQUENCY
            ? 'liquid'
            : 'normal',
    /*
     * Deviation is compared against the player's OWN value, not an absolute
     * threshold. A spread of 300 is noise on a 9,000 asset and a violent
     * disagreement on a 900 one.
     */
    agreement:
      marketStdDev == null || row.value <= 0
        ? null
        : marketStdDev / row.value >= CONTESTED_STDDEV_SHARE
          ? 'contested'
          : 'settled',
  }
}

/**
 * Layer 1 — how much more (or less) this player scores under THIS league's
 * rules than under the scoring the market baseline assumes.
 *
 * ⚠ THE RATIO IS EXACT, NOT ESTIMATED. Both sides are the same projected
 * component line put through a dot product: once against the league's own
 * scoring map, once against the baseline's. TE premium, six-point passing
 * touchdowns, yardage bonuses and IDP weights are not things to guess at.
 *
 * ⚠ AND IT DELIBERATELY EXCLUDES THE ONE THING THE BASELINE ALREADY PRICES.
 * `lib/player-values/ingestPlayerValues.ts` fetches four combinations, and the
 * ONLY parameter that varies with the league is `numQbs`. So superflex is
 * already in the baseline and must never be re-applied here — doing so would
 * count it twice and inflate every quarterback in the league.
 *
 * Everything else is PINNED, not matched: `ppr=1` and `numTeams=12` on all four.
 * A half-PPR league therefore SHOULD get a downward adjustment out of this
 * layer, and it is this layer's job to apply it.
 *
 * Returns null when either side is missing. A league with no scoring settings
 * on file, or a player with no projected line, gets a stated gap rather than a
 * 1.0 that looks like a measurement.
 */
export function leagueFitRatio(args: {
  componentStats: Record<string, unknown> | null | undefined
  leagueScoring: Record<string, unknown> | null | undefined
  baselineScoring: Record<string, unknown> | null | undefined
}): { ratio: number; leaguePoints: number; baselinePoints: number } | null {
  const { componentStats, leagueScoring, baselineScoring } = args
  if (!componentStats || !leagueScoring || !baselineScoring) return null

  const league = computeLeagueProjectedPoints(componentStats, leagueScoring)
  const baseline = computeLeagueProjectedPoints(componentStats, baselineScoring)
  if (!league || !baseline) return null

  /*
   * A baseline of zero cannot be divided into. This is the normal case for a
   * defender in a league whose baseline scoring has no IDP keys — his league
   * points are real and his baseline points are genuinely zero, so there is no
   * ratio to report. The caller states that as a gap rather than dividing.
   */
  if (baseline.points <= 0) return null

  return {
    ratio: league.points / baseline.points,
    leaguePoints: league.points,
    baselinePoints: baseline.points,
  }
}

/**
 * Price a league-adjusted ordering off the market's own curve.
 *
 * ⚠ THIS IS WHY THE RATIO NEVER SURVIVES INTO THE OUTPUT AS A SCALE FACTOR.
 * Multiplying a market value by a points ratio would be a claim that value moves
 * linearly with points, which it does not — value curves are convex and the two
 * sources in this repo disagree with each other by factors of 2.8x to 7.0x on
 * the same players.
 *
 * So the ratio is used ONLY to reorder the population, and the new position is
 * then read off the real curve. What survives is the reordering — which is
 * exactly what a league's scoring rules do to a market — and not the invented
 * scale. This is the same rank-space discipline `afValue.blendByRank` uses to
 * reconcile two sources, for the same reason.
 */
export function priceByAdjustedRank(
  population: Array<{ sleeperId: string; value: number; ratio: number | null }>,
): Map<string, number> {
  const sortedValues = [...population.map((p) => p.value)].sort((a, b) => b - a)
  const priceAt = valueAtRankFrom(sortedValues)

  /*
   * Players the ratio could not be computed for keep their market value exactly,
   * by ordering on it unchanged. They must not be pushed down the board for the
   * crime of having no projection on file.
   */
  const ordered = [...population].sort(
    (a, b) => b.value * (b.ratio ?? 1) - a.value * (a.ratio ?? 1),
  )

  const out = new Map<string, number>()
  ordered.forEach((p, i) => {
    const priced = priceAt(i + 1)
    if (priced != null) out.set(p.sleeperId, Math.round(priced))
  })
  return out
}

/** Layers this build does not have, named the same way every time. */
export const LEDGER_GAPS = {
  trajectory:
    'age curve, recency-weighted production and depth-chart role are not applied yet',
  situation:
    'team pace, coordinator changes, durability history and weather splits are not applied yet',
  counterparty:
    'roster need and the other manager’s trade history price a specific deal, not a player',
  leagueSize:
    'the market baseline is a 12-team price, so replacement level is slightly off in a 10- or 14-team league',
} as const

/**
 * Build the ledger for a set of players in one league.
 *
 * One query for the baseline population, one for the projections. The league's
 * scoring map is read once by the caller and passed in, because it also drives
 * the projection column on the roster screen and the two must agree.
 */
export async function buildValueLedger(args: {
  sleeperIds: string[]
  format: 'DYNASTY' | 'REDRAFT'
  qbFormat: 'ONE_QB' | 'SUPERFLEX'
  leagueScoring: Record<string, unknown> | null
  /**
   * The scoring the baseline itself assumes, so layer 1 compares like with
   * like. Null disables the layer with a stated gap rather than guessing at
   * FantasyCalc's internal rules.
   */
  baselineScoring: Record<string, unknown> | null
  projectionWeek: { season: string; week: number } | null
  /** Team count, so the 12-team baseline can name itself as a gap when it differs. */
  leagueSize?: number | null
  /**
   * The field to rank within. Defaults to the whole format-matched population.
   *
   * A caller comparing rosters inside one league passes that league's rostered
   * players: the reordering that matters there is among the assets actually in
   * play, and loading seven hundred prices to rank a hundred and eighty is work
   * nobody reads.
   */
  populationIds?: string[] | null
}): Promise<Map<string, ValueLedger>> {
  const { sleeperIds, format, qbFormat, leagueScoring, baselineScoring, leagueSize } = args
  if (sleeperIds.length === 0) return new Map()

  /*
   * The whole format-matched population, not just the players asked about —
   * a rank is meaningless without the field it is a rank within.
   *
   * Newest capture per player: the table keeps history, so an unfiltered read
   * would rank yesterday's price against today's.
   */
  const rows = await prisma.playerValueSnapshot
    .findMany({
      where: {
        source: 'FANTASYCALC',
        format,
        qbFormat,
        ...(args.populationIds ? { sleeperId: { in: args.populationIds } } : {}),
      },
      orderBy: { capturedAt: 'desc' },
      select: {
        sleeperId: true,
        name: true,
        position: true,
        value: true,
        overallRank: true,
        trend30d: true,
        tradeFrequency: true,
        marketStdDev: true,
        capturedAt: true,
        source: true,
      },
    })
    .catch(() => [])

  const newest = new Map<string, (typeof rows)[number]>()
  for (const r of rows) if (!newest.has(r.sleeperId)) newest.set(r.sleeperId, r)

  const population = [...newest.values()]
  if (population.length === 0) return new Map()

  /*
   * Projections for the whole population, so every player can be reordered.
   *
   * ⚠ THROUGH `lookupProjections`, NOT A SECOND QUERY. It already knows that the
   * sleeper id lives in `playerId`, that the component line is unpacked out of
   * `stats`, and that AF mirror rows must be excluded. A private copy of that
   * here would be a second implementation that drifts — and it would miss the
   * IDP enrichment, which is exactly the population whose league fit differs
   * most from the market's.
   */
  const projections =
    leagueScoring && baselineScoring
      ? await lookupProjections(
          population.map((p) => p.sleeperId),
          args.projectionWeek,
          leagueScoring ? { scoringSettings: leagueScoring } : null,
        ).catch(() => new Map())
      : new Map()

  const componentBy = new Map(
    [...projections.entries()].map(([id, pr]) => [id, pr.componentStats ?? null]),
  )

  const fitBy = new Map<string, ReturnType<typeof leagueFitRatio>>()
  for (const p of population) {
    fitBy.set(
      p.sleeperId,
      leagueFitRatio({
        componentStats: componentBy.get(p.sleeperId),
        leagueScoring,
        baselineScoring,
      }),
    )
  }

  const adjusted = priceByAdjustedRank(
    population.map((p) => ({
      sleeperId: p.sleeperId,
      value: p.value,
      ratio: fitBy.get(p.sleeperId)?.ratio ?? null,
    })),
  )

  const wanted = new Set(sleeperIds)
  const out = new Map<string, ValueLedger>()

  for (const p of population) {
    if (!wanted.has(p.sleeperId)) continue
    const fit = fitBy.get(p.sleeperId) ?? null

    const gaps: string[] = [
      LEDGER_GAPS.trajectory,
      LEDGER_GAPS.situation,
      LEDGER_GAPS.counterparty,
    ]
    if (leagueSize != null && leagueSize !== BASELINE_LEAGUE_SIZE) gaps.push(LEDGER_GAPS.leagueSize)
    if (!fit) {
      gaps.unshift(
        leagueScoring == null
          ? 'this league’s scoring settings are not on file, so league fit was not applied'
          : baselineScoring == null
            ? 'no baseline scoring to compare against, so league fit was not applied'
            : 'no projected line for this player, so league fit was not applied',
      )
    }

    out.set(p.sleeperId, {
      sleeperId: p.sleeperId,
      name: p.name,
      position: p.position,
      baseline: {
        value: p.value,
        source: p.source,
        format,
        qbFormat,
        capturedAt: p.capturedAt,
        overallRank: p.overallRank,
      },
      leagueFit: fit
        ? {
            factor: fit.ratio,
            basis: `scores ${(fit.ratio * 100 - 100).toFixed(0)}% ${
              fit.ratio >= 1 ? 'more' : 'less'
            } under this league’s scoring (${fit.leaguePoints.toFixed(
              1,
            )} vs ${fit.baselinePoints.toFixed(1)})`,
          }
        : {
            factor: null,
            basis: gaps[0] ?? 'league fit was not applied',
          },
      microstructure: classifyMicrostructure(p),
      value: adjusted.get(p.sleeperId) ?? p.value,
      gaps,
    })
  }

  return out
}

/**
 * The third dimension: what this player is worth TO ONE SPECIFIC TEAM.
 *
 * ⚠ THIS IS A PRICE, NOT A VALUE, AND IT MUST NOT BE STORED OR RANKED. It is
 * true of one deal between two teams and false everywhere else. Writing it back
 * onto a player page or a roster grade would corrupt a league-wide fact with a
 * one-off preference.
 *
 * Kept out of `buildValueLedger` deliberately: that function answers
 * value(player, league) and is cacheable per league. This one is not cacheable
 * at all, because its second argument is a roster that changes every waiver run.
 */
export function priceForCounterparty(
  ledger: ValueLedger,
  need: RosterNeed | null,
): { price: number | null; delta: LedgerLayer } {
  const d = counterpartyPriceDelta({ position: ledger.position, need })

  if (!d) {
    return {
      price: ledger.value,
      delta: {
        factor: null,
        basis: 'we cannot read that roster’s starting lineup, so need does not move this price',
      },
    }
  }

  return {
    price: ledger.value == null ? null : Math.round(ledger.value * d.factor),
    delta: { factor: d.factor, basis: d.basis },
  }
}
