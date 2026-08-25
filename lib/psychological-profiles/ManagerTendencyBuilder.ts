/**
 * Manager trade tendencies — the writer the table never had.
 *
 * `manager_trade_tendencies` carries exactly the columns the valuation brief asks for — average
 * overpay ratio, prefers youth, prefers picks, risk tolerance — is read by live code
 * (`CrossLeagueUserStatsService`), and has been permanently empty because nothing wrote it. It
 * could not be written before: the trade facts recorded that a trade happened and not what was
 * in it, so there was nothing to compute a preference from. Trade contents are ingested now.
 *
 * ⚠ NULL IS THE ANSWER FOR EVERYTHING THIS CANNOT SEE, AND THE BOOLEANS ARE THE TRAP. Every
 * column here is nullable and three of them default to a confident value — `prefers_youth` and
 * `prefers_picks` to `false`, `risk_tolerance` to `"medium"`. Writing those defaults would
 * assert that we looked and found no preference, which is a different claim from not knowing.
 * A manager with two trades gets nulls, and a reader can tell the difference.
 *
 * ⚠ `trades_sent` IS NEVER WRITTEN. Sleeper's transactions endpoint reports COMPLETED trades
 * only — there is no record of an offer that was declined or ignored. Setting sent equal to
 * accepted would assert a 100% acceptance rate for every manager in the product, which is both
 * false and flattering. The column keeps its default and the event-sourced path stays
 * authoritative for it.
 *
 * The computation lives here and is PURE — no prisma, no server-only — so the arithmetic can be
 * exercised from a script and a test without a database. `ManagerTendencyWriter.ts` persists it.
 */

import { inferRiskTolerance, type ManagerTendency } from '@/lib/trade-engine/managerTendencies'

/** One side of one completed trade, already priced. */
export interface TradeSideObservation {
  /** Sleeper user id — the space `CrossLeagueUserStatsService` queries `user_id` against. */
  managerKey: string
  leagueId: string
  transactionId: string
  /** Market value of players and picks received / given. Null when the side could not be priced. */
  valueReceived: number | null
  valueGiven: number | null
  picksReceived: number
  picksGiven: number
  /** Ages of the players moving each way. Empty when none were known. */
  agesReceived: number[]
  agesGiven: number[]
}

export interface ManagerTendencyRow {
  user_id: string
  leagues_played: number
  trades_accepted: number
  /** Given ÷ received. Above 1 means they hand over more than they get back. */
  avg_overpay_ratio: number | null
  prefers_youth: boolean | null
  prefers_picks: boolean | null
  risk_tolerance: string | null
  /** How many priced trades the ratio came from. Reported so a caller can weigh it. */
  pricedTrades: number
}

/**
 * Below this many priced trades the ratio is one bad deal away from meaningless.
 *
 * Trades do not balance in market terms — measured across 771 dynasty trades, the imbalance a
 * fair-trade model leaves unexplained is roughly the size of the trade itself. A manager's
 * average pulls signal out of that only with repetition, so a small sample gets null rather
 * than a number that would read as a personality.
 */
export const MIN_PRICED_TRADES = 5

/** A pick preference needs someone to have actually traded picks. */
const MIN_PICK_TRADES = 3
/** An age preference needs both sides of enough trades to carry known ages. */
const MIN_AGED_TRADES = 3

export function computeManagerTendencies(
  observations: readonly TradeSideObservation[],
): ManagerTendencyRow[] {
  const byManager = new Map<string, TradeSideObservation[]>()
  for (const o of observations) {
    if (!o.managerKey) continue
    const arr = byManager.get(o.managerKey) ?? []
    arr.push(o)
    byManager.set(o.managerKey, arr)
  }

  const rows: ManagerTendencyRow[] = []
  for (const [managerKey, sides] of byManager) {
    const leagues = new Set(sides.map((s) => s.leagueId))
    const trades = new Set(sides.map((s) => s.transactionId))

    /*
     * ⚠ A GEOMETRIC MEAN, AND AN ARITHMETIC ONE IS ACTIVELY WRONG HERE. Trades are zero-sum: if
     * one side gives 1,500 for 1,000 the other gives 1,000 for 1,500, so the two ratios are
     * 1.5 and 0.667 and the population has to centre on 1. Averaging them arithmetically gives
     * 1.08 — a ratio is not symmetric under inversion, so the bias compounds across every
     * trade and every manager comes out an overpayer. Measured before this fix: median 1.56
     * across 285 managers, with 224 of them classified "high risk" and 35 "low", which is not
     * a finding about the population, it is the estimator.
     *
     * The mean of log-ratios is symmetric — log(1.5) and log(0.667) cancel exactly — and it
     * also stops one blockbuster from defining a manager, which is the other reason not to use
     * totals.
     */
    const logRatios: number[] = []
    for (const s of sides) {
      if (s.valueGiven == null || s.valueReceived == null) continue
      if (s.valueReceived <= 0 || s.valueGiven <= 0) continue
      logRatios.push(Math.log(s.valueGiven / s.valueReceived))
    }
    const avgOverpay =
      logRatios.length >= MIN_PRICED_TRADES
        ? Math.round(Math.exp(logRatios.reduce((a, b) => a + b, 0) / logRatios.length) * 1000) / 1000
        : null

    const pickTrades = sides.filter((s) => s.picksReceived > 0 || s.picksGiven > 0)
    const netPicks = pickTrades.reduce((sum, s) => sum + s.picksReceived - s.picksGiven, 0)
    const prefersPicks = pickTrades.length >= MIN_PICK_TRADES ? netPicks > 0 : null

    const agedSides = sides.filter((s) => s.agesReceived.length > 0 && s.agesGiven.length > 0)
    let prefersYouth: boolean | null = null
    if (agedSides.length >= MIN_AGED_TRADES) {
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
      const deltas = agedSides.map((s) => mean(s.agesReceived) - mean(s.agesGiven))
      // Negative means the players coming in are younger than the players going out.
      prefersYouth = deltas.reduce((a, b) => a + b, 0) / deltas.length < 0
    }

    /*
     * Risk tolerance is derived through the EXISTING predicate rather than a fresh set of
     * thresholds, so a second definition of "high risk" cannot appear beside the first. It
     * stays null when the ratio it reads is null — the shipped default of "medium" would
     * otherwise describe every manager we know nothing about as an average one.
     */
    const risk =
      avgOverpay == null
        ? null
        : inferRiskTolerance({
            avg_overpay_ratio: avgOverpay,
            trades_sent: 0,
            trades_accepted: trades.size,
            leagues_played: leagues.size,
            prefers_youth: prefersYouth ?? false,
            prefers_picks: prefersPicks ?? false,
            risk_tolerance: 'medium',
            user_id: managerKey,
            updated_at: new Date(0),
          } satisfies ManagerTendency)

    rows.push({
      user_id: managerKey,
      leagues_played: leagues.size,
      trades_accepted: trades.size,
      avg_overpay_ratio: avgOverpay,
      prefers_youth: prefersYouth,
      prefers_picks: prefersPicks,
      risk_tolerance: risk,
      pricedTrades: logRatios.length,
    })
  }

  return rows.sort((a, b) => b.trades_accepted - a.trades_accepted)
}
