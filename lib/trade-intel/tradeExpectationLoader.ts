import 'server-only'
import { prisma } from '@/lib/prisma'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'

import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getSeasonStatsBoard, scoreStatLine } from '@/lib/sports-data/sleeperMarketService'
import { getMarketValues } from '@/lib/trade-intel/marketValueService'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { buildTradeExpectation, withOneGrade, type TradeExpectation } from '@/lib/trade-intel/tradeExpectation'
import { createLeagueTradeGrader, gradeDeal, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
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
/*
 * One grader per league, briefly memoised: a history page asks for an expectation per trade, and the
 * chart behind every one of them is the same. Five minutes is well inside the chart's own freshness.
 */
const GRADER_TTL_MS = 5 * 60 * 1000
const graders = new Map<string, { at: number; grader: Promise<LeagueTradeGrader | null> }>()
function graderFor(leagueId: string): Promise<LeagueTradeGrader | null> {
  const hit = graders.get(leagueId)
  if (hit && Date.now() - hit.at < GRADER_TTL_MS) return hit.grader
  const grader = createLeagueTradeGrader({ leagueId }).catch(() => null)
  graders.set(leagueId, { at: Date.now(), grader })
  return grader
}

/**
 * THE grade for a completed two-sided trade, from side one's point of view, on today's league values
 * and WITHOUT roster need — the trade has happened, so need has no honest answer. A pick whose draft
 * has already been held no longer exists as a pick, so it withholds the letter rather than being
 * priced as though it were still to come.
 */
async function oneGradeForCompletedTrade(leagueId: string, trade: GradedTrade, season: number): Promise<TradeGradeView> {
  const [a] = trade.sides
  if (!a) return { graded: false, reason: 'the trade has no sides on record', basis: null }
  const side = (players: GradedTrade['sides'][number]['playersIn'], picks: GradedTrade['sides'][number]['picksIn']): GradeInputs => {
    const out: GradeInputs = { assets: players.map((p) => ({ kind: 'player' as const, name: p.name })), unpriceable: [] }
    for (const pick of picks) {
      const year = Number(pick.season)
      if (Number.isFinite(year) && year >= season && pick.round > 0) out.assets.push({ kind: 'pick', year, round: pick.round })
      else out.unpriceable.push(pick.label)
    }
    return out
  }
  return gradeDeal(await graderFor(leagueId), {
    give: side(a.playersOut, a.picksOut),
    get: side(a.playersIn, a.picksIn),
    viewerSide: false,
  })
}

function priorSeasonOf(trade: GradedTrade): string {
  const n = Number(trade.season)
  return Number.isFinite(n) ? String(n - 1) : trade.season
}

export async function loadTradeExpectation(
  sleeperLeagueId: string,
  trade: GradedTrade,
): Promise<TradeExpectation | null> {
  const [context, leagueRow] = await Promise.all([
    getLeagueContext(sleeperLeagueId).catch(() => null),
    prisma.league.findFirst({
      where: { platformLeagueId: sleeperLeagueId },
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
    }).catch(() => null),
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

  const [marketValues, dynastyProcess, statsBoard, rosters] = await Promise.all([
    historical ? Promise.resolve(null) : getMarketValues(context).catch(() => null),
    historical ? Promise.resolve(null) : getDynastyProcessValues(numQbs).catch(() => null),
    getSeasonStatsBoard(priorSeason, true).catch(() => null),
    historical ? Promise.resolve(null) : fetchLeagueRosters(sleeperLeagueId),
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
  if (!leagueRow?.id || expectation.evaluation.scope !== 'market-only' || trade.sides.length !== 2) return expectation
  const oneGrade = await oneGradeForCompletedTrade(leagueRow.id, trade, Number(context.season)).catch(() => null)
  return withOneGrade(expectation, oneGrade)
}
