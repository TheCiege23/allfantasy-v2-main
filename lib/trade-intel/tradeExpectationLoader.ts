import 'server-only'

import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getSeasonStatsBoard, scoreStatLine } from '@/lib/sports-data/sleeperMarketService'
import { getMarketValues } from '@/lib/trade-intel/marketValueService'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { buildTradeExpectation, type TradeExpectation } from '@/lib/trade-intel/tradeExpectation'
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

export async function loadTradeExpectation(
  sleeperLeagueId: string,
  trade: GradedTrade,
): Promise<TradeExpectation | null> {
  const context = await getLeagueContext(sleeperLeagueId).catch(() => null)
  if (!context) return null

  const priorSeason = priorSeasonOf(trade)

  const numQbs: 1 | 2 = context.variant.superflex ? 2 : 1

  const [marketValues, dynastyProcess, statsBoard, rosters] = await Promise.all([
    getMarketValues(context).catch(() => null),
    getDynastyProcessValues(numQbs).catch(() => null),
    getSeasonStatsBoard(priorSeason, true).catch(() => null),
    fetchLeagueRosters(sleeperLeagueId),
  ])

  // AF Value: blend the two independently-derived sources in rank space.
  // FantasyCalc is the reference scale because every existing consumer already
  // reads its units, and it is the source that also prices picks.
  let afValues: ReturnType<typeof buildAfValues> | null = null
  let afPickValues: ReturnType<typeof buildAfPickValues> | null = null
  if (marketValues) {
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
    afValues = built.size > 0 ? built : null

    // Picks get the same treatment, ranked among themselves rather than against
    // players — a 2026 2nd is not "the 140th most valuable player" in either feed.
    const pickSources: PickEntries[] = [
      { source: 'fantasycalc', byRound: marketValues.pickByRound },
    ]
    if (dynastyProcess) {
      pickSources.push({ source: 'dynastyprocess', byRound: dynastyProcess.pickByRound })
    }
    const builtPicks = buildAfPickValues(pickSources, 'fantasycalc')
    afPickValues = builtPicks.size > 0 ? builtPicks : null
  }

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
    const byPlayerId: Record<
      string,
      { points: number; games: number | null; mode: 'league-scored' | 'format-approx' }
    > = {}
    for (const [playerId, row] of Object.entries(statsBoard.players)) {
      const scored = scoreStatLine(row.stats, context.scoring.settings, context.scoring.format)
      const games = typeof row.stats.gp === 'number' ? row.stats.gp : null
      byPlayerId[playerId] = { points: scored.points, games, mode: scored.mode }
    }
    prior = { season: statsBoard.season, byPlayerId }
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

  return buildTradeExpectation({
    trade,
    context,
    marketValues,
    priorSeason: prior,
    rosteredByPosition,
    afValues,
    // Blended pick value when both sources priced the round; the single-source
    // value otherwise, so a DynastyProcess outage narrows confidence rather
    // than un-pricing every traded pick.
    pickValueLookup: (season, round) =>
      afPickValues?.get(`${season}:${round}`)?.value ??
      marketValues?.pickByRound[`${season}:${round}`] ??
      null,
  })
}
