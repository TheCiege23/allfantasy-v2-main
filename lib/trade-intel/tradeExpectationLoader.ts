import 'server-only'
import { prisma } from '@/lib/prisma'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'

import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getSeasonStatsBoard, scoreStatLine } from '@/lib/sports-data/sleeperMarketService'
import { getMarketValues } from '@/lib/trade-intel/marketValueService'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { buildTradeExpectation, withOneGrade, type TradeExpectation } from '@/lib/trade-intel/tradeExpectation'
import { oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { fetchLeagueRosters } from '@/lib/trade-intel/sleeperTradeSync'
import { getDynastyProcessValues } from '@/lib/trade-intel/dynastyProcessSync'
import { buildAfPickValues, buildAfValues, type PickEntries, type SourceEntries } from '@/lib/trade-intel/afValue'

/**
 * I/O half of tradeExpectation. Everything it gathers is real:
 *  - league + scoring settings from the league itself
 *  - market values already parameterized by superflex/teams/PPR/dynasty
 *  - last completed season's ACTUAL stat lines, rescored with this league's weights
 *  - current rosters, for whether required starting slots can be filled
 *
 * Every fetch is individually optional. A failure removes one input and is
 * named in `missing`; it never fabricates a number and never throws the email.
 */

/** The season before the trade's — the last one that actually happened. */
function priorSeasonOf(trade: GradedTrade): string {
  const n = Number(trade.season)
  return Number.isFinite(n) ? String(n - 1) : trade.season
}

/**
 * League-scoped inputs shared by every trade in one read — see `tradeExpectationShared`.
 * Opaque on purpose: a caller creates one and passes it; only this module reads it.
 */
export type TradeExpectationShared = { readonly memo: Map<string, unknown> }

/**
 * One memo for a batch of `loadTradeExpectation` calls on the SAME league (a history of sixty trades).
 *
 * ⚠ EVERY INPUT BELOW IS LEAGUE- OR SEASON-SCOPED, NOT TRADE-SCOPED (2026-11-06). Without this, each
 * trade re-read the league context, the market chart, the DynastyProcess chart and a whole season's
 * stat board (multi-MB JSON out of `sportsDataCache`), re-scored that board with the league's weights,
 * re-blended the AF values, and made its OWN live Sleeper roster call — once per trade, sixty times for
 * a sixty-trade history. The values were the same every time; only the cost was multiplied.
 *
 * Scope it to ONE read. It is not a cache: nothing in it outlives the request that made it, so it never
 * serves a roster or a chart older than that read. A failed input is shared too — it fails once for the
 * batch instead of being retried per trade, and still reads as that input missing.
 */
export function tradeExpectationShared(): TradeExpectationShared {
  return { memo: new Map() }
}

function once<T>(shared: TradeExpectationShared | undefined, key: string, run: () => T): T {
  if (!shared) return run()
  if (shared.memo.has(key)) return shared.memo.get(key) as T
  const value = run()
  shared.memo.set(key, value)
  return value
}

type AfBlend = {
  afValues: ReturnType<typeof buildAfValues> | null
  afPickValues: ReturnType<typeof buildAfPickValues> | null
}

type MarketValuesOf = NonNullable<Awaited<ReturnType<typeof getMarketValues>>>
type DynastyValuesOf = Awaited<ReturnType<typeof getDynastyProcessValues>>

/** AF Value: blend the two independently-derived sources in rank space. */
function blendAfValues(marketValues: MarketValuesOf, dynastyProcess: DynastyValuesOf): AfBlend {
  // FantasyCalc is the reference scale because every existing consumer already
  // reads its units, and it is the source that also prices picks.
  const sources: SourceEntries[] = [
    {
      source: 'fantasycalc',
      entries: Object.entries(marketValues.bySleeperId).map(([sleeperId, e]) => ({
        sleeperId,
        value: e.value,
      })),
    },
  ]
  if (dynastyProcess) {
    sources.push({
      source: 'dynastyprocess',
      entries: Object.entries(dynastyProcess.bySleeperId).map(([sleeperId, value]) => ({
        sleeperId,
        value,
      })),
    })
  }
  const built = buildAfValues(sources, 'fantasycalc')

  // Picks get the same treatment, ranked among themselves rather than against
  // players — a 2026 2nd is not "the 140th most valuable player" in either feed.
  const pickSources: PickEntries[] = [
    { source: 'fantasycalc', byRound: marketValues.pickByRound },
  ]
  if (dynastyProcess) {
    pickSources.push({ source: 'dynastyprocess', byRound: dynastyProcess.pickByRound })
  }
  const builtPicks = buildAfPickValues(pickSources, 'fantasycalc')
  return {
    afValues: built.size > 0 ? built : null,
    afPickValues: builtPicks.size > 0 ? builtPicks : null,
  }
}

export async function loadTradeExpectation(
  sleeperLeagueId: string,
  trade: GradedTrade,
  opts: {
    /** Share league-scoped reads across a batch of trades on this league — see `tradeExpectationShared`. */
    shared?: TradeExpectationShared
    /**
     * The VIEWER'S copy of the league. One Sleeper league is one AF row per importer, and each row
     * carries its own settings and confirmed league type, so the letter depends on which row is read.
     * 🛑 Without it this read `findFirst({ platformLeagueId })` — an arbitrary importer's row — which
     * is how the grade email printed B (+24%) beside an app screen reading A (+25%) (2026-09-25).
     * Given and not a copy of this league: no row, so the grade withholds rather than borrow another.
     */
    afLeagueId?: string | null
  } = {},
): Promise<TradeExpectation | null> {
  const shared = opts.shared
  const [context, leagueRow] = await Promise.all([
    once(shared, `context:${sleeperLeagueId}`, () => getLeagueContext(sleeperLeagueId).catch(() => null)),
    once(shared, `row:${opts.afLeagueId ?? ''}:${sleeperLeagueId}`, () => prisma.league.findFirst({
      where: opts.afLeagueId
        ? { id: opts.afLeagueId, platformLeagueId: sleeperLeagueId }
        : { platformLeagueId: sleeperLeagueId },
      select: {
        id: true,
        leagueType: true,
        leagueVariant: true,
        isDynasty: true,
        keeperCount: true,
        keeperCostSystem: true,
        keeperRoundPenalty: true,
        settings: true,
        survivorMode: true,
        guillotineMode: true,
        bbTradesEnabled: true,
        zombieConfig: { select: { zombieTradeBlocked: true } },
        zombieLeague: {
          select: { teams: { select: { rosterId: true, status: true } } },
        },
        tournamentShellLeague: {
          select: {
            tournament: { select: { tradeEnabled: true } },
            round: { select: { tradeEnabledOverride: true } },
          },
        },
        legacyTournamentLeague: { select: { id: true } },
      },
    }).catch(() => null)),
  ])
  if (!context) return null

  const priorSeason = priorSeasonOf(trade)
  const historical = trade.season !== context.season
  const formatRules = leagueRow ? readFormatRules(leagueRow) : null

  let tradesEnabled: boolean | null = true
  if (!leagueRow || historical) {
    tradesEnabled = null
  } else if (leagueRow.survivorMode && leagueRow.guillotineMode) {
    // The supplied Survivor All-Stars rules say "NO TRADES".
    tradesEnabled = false
  } else if (formatRules?.concept === 'tournament') {
    const shell = leagueRow.tournamentShellLeague
    tradesEnabled = shell
      ? shell.round.tradeEnabledOverride ?? shell.tournament.tradeEnabled
      : null
  } else if (formatRules?.concept === 'zombie') {
    if (leagueRow.zombieConfig?.zombieTradeBlocked !== true) {
      tradesEnabled = true
    } else {
      const statusByRoster = new Map(
        (leagueRow.zombieLeague?.teams ?? []).map((team) => [team.rosterId, team.status]),
      )
      const participantStates = trade.sides.map((side) => statusByRoster.get(String(side.rosterId)))
      tradesEnabled = participantStates.some((status) => status == null)
        ? null
        : participantStates.every((status) => status !== 'Zombie')
    }
  } else if (formatRules?.concept === 'survivor' || formatRules?.concept === 'salary_cap') {
    // Provider acceptance does not prove the house timing rule or cap ledger was legal.
    tradesEnabled = null
  } else if (formatRules?.concept === 'pirate') {
    // Provider acceptance does not prove compliance with the house-wide
    // Thursday kickoff through Monday-final trade lock.
    tradesEnabled = null
  } else if (context.variant.bestBall) {
    tradesEnabled = leagueRow.bbTradesEnabled ?? null
  }

  const numQbs: 1 | 2 = context.variant.superflex ? 2 : 1

  /*
   * Keyed on the league id rather than on `context`: a batch shares one league, and `context` is the
   * memoised read of that id. `historical` decides only WHETHER a read happens, never its arguments.
   */
  const [marketValues, dynastyProcess, statsBoard, rosters] = await Promise.all([
    historical ? Promise.resolve(null) : once(shared, `market:${sleeperLeagueId}`, () => getMarketValues(context).catch(() => null)),
    historical ? Promise.resolve(null) : once(shared, `dynasty:${numQbs}`, () => getDynastyProcessValues(numQbs).catch(() => null)),
    once(shared, `stats:${priorSeason}`, () => getSeasonStatsBoard(priorSeason, true).catch(() => null)),
    historical ? Promise.resolve(null) : once(shared, `rosters:${sleeperLeagueId}`, () => fetchLeagueRosters(sleeperLeagueId)),
  ])

  // Built once per batch: both inputs are the memoised reads above, so the blend is the same every time.
  const { afValues, afPickValues }: AfBlend = marketValues
    ? once(shared, `af:${sleeperLeagueId}:${numQbs}`, () => blendAfValues(marketValues, dynastyProcess))
    : { afValues: null, afPickValues: null }

  // Rescore last season with the league's own weights. scoreStatLine reports
  // whether it truly used them or fell back to a format approximation, and we
  // pass that straight through rather than implying league accuracy we lack.
  let prior: Parameters<typeof buildTradeExpectation>[0]['priorSeason'] = null
  if (statsBoard) {
    // Mode is recorded PER PLAYER. A board-wide verdict was wrong in both
    // directions: it swept in kickers, IDP and other positions this league may
    // not score at all, then applied that pessimism to the handful of players
    // actually traded — labelling genuinely league-scored numbers as
    // approximations. buildTradeExpectation decides the mode from the assets in
    // the trade instead.
    // Once per league and season per batch: the board and the league's weights are both memoised above.
    prior = once(shared, `prior:${sleeperLeagueId}:${priorSeason}`, () => {
      const byPlayerId: Record<
        string,
        { points: number; games: number | null; mode: 'league-scored' | 'format-approx' }
      > = {}
      for (const [playerId, row] of Object.entries(statsBoard.players)) {
        const scored = scoreStatLine(row.stats, context.scoring.settings, context.scoring.format)
        const games = typeof row.stats.gp === 'number' ? row.stats.gp : null
        byPlayerId[playerId] = { points: scored.points, games, mode: scored.mode }
      }
      return { season: statsBoard.season, byPlayerId }
    })
  }

  // Roster composition by position, as rosters stand now.
  //
  // Positions come from the stat board, which only contains players who
  // actually recorded stats — a rookie or a fringe body is invisible there. An
  // unseen player would silently read as a missing starter, so any roster we
  // cannot mostly identify is dropped rather than reported wrong. "We didn't
  // check" beats "you have no QB" when he is simply a rookie.
  let rosteredByPosition: Record<number, Record<string, number>> | null = null
  if (rosters && statsBoard) {
    rosteredByPosition = {}
    for (const roster of rosters) {
      const ids = roster.players ?? []
      const counts: Record<string, number> = {}
      let identified = 0
      for (const playerId of ids) {
        const position = statsBoard.players[playerId]?.position
        if (!position) continue
        counts[position] = (counts[position] ?? 0) + 1
        identified += 1
      }
      if (ids.length === 0 || identified / ids.length < 0.8) continue
      rosteredByPosition[roster.roster_id] = counts
    }
    if (Object.keys(rosteredByPosition).length === 0) rosteredByPosition = null
  }

  const expectation = buildTradeExpectation({
    trade,
    context,
    marketValues,
    priorSeason: prior,
    rosteredByPosition,
    afValues,
    leagueConcept: formatRules?.concept ?? null,
    survivorMode: leagueRow?.survivorMode === true,
    guillotineMode: leagueRow?.guillotineMode === true,
    tradesEnabled,
    historical,
    // Blended pick value when both sources priced the round; the single-source
    // value otherwise, so a DynastyProcess outage narrows confidence rather
    // than un-pricing every traded pick.
    pickValueLookup: (season, round) =>
      afPickValues?.get(`${season}:${round}`)?.value ??
      marketValues?.pickByRound[`${season}:${round}`] ??
      null,
  })

  // The letter is THE grade (see `withOneGrade`); only a two-sided, market-only read is regraded.
  if (expectation.evaluation.scope !== 'market-only') return expectation
  const oneGrade = leagueRow?.id && trade.sides.length === 2
    ? await oneGradeForCompletedTrade(leagueRow.id, trade, Number(context.season)).catch(() => null)
    : null
  return withOneGrade(expectation, oneGrade)
}
