/**
 * Score the playoff round being played, from the same weekly stat rows the regular season uses.
 *
 * 🛑 NOTHING WROTE A PLAYOFF SCORE. `RedraftPlayoffMatchup.homeScore` / `awayScore` had four
 * writers — bracket create, next-round fill, advance, commissioner override — and none of them
 * set a score. `advanceNflRedraftPlayoffRound` decides a winner only from those two columns, so
 * every bracket that was ever generated would have sat at `MATCHUPS_INCOMPLETE` for good, with
 * the hourly postseason roller reporting a normal "held" on every run. No league could crown a
 * champion without a commissioner overriding every matchup by hand through an API with no UI.
 *
 * ⚠ SCORES ARE WRITTEN ONLY WHEN THE ROUND IS FINAL, AND THAT IS WHAT MAKES ADVANCING SAFE.
 * The advance runs hourly and reads nothing but the score columns — it does not look at status
 * or at whether the week is over. A live score in those columns would decide a round on Sunday
 * afternoon. So while the round is being played the running totals go to
 * `metadata.live`, and the columns are filled only after every week of the round has been sealed
 * by the week finalizer (games final, grace period passed, stat coverage met) and both teams'
 * rows are finalized. A tie on the sealed score is settled by seed inside the runtime; only two
 * equal seeds — impossible within one bracket — reach a human.
 *
 * ⚠ A ROUND CAN SPAN SEVERAL WEEKS. `League.playoffWeeksPerRound` was editable in the playoff
 * settings and read by nothing; the round's score is the sum of its weeks (`playoffRoundWeeks`).
 * The FINAL can be longer still — `championship_length` (2 for MLB/NHL) — so the bracket's last
 * round is passed in as `finalRoundNumber`, and the final is not written until its last week seals.
 *
 * ⚠ WEEKS ARE SEALED FOR THE TEAMS STILL PLAYING ONLY. The finalizer's coverage floor is measured
 * over every roster it is given, and an eliminated team's abandoned lineup — injured starters, a
 * player on a bye — can hold the whole league's week below the floor. `rosterIds` narrows it.
 *
 * ⚠ THE THIRD-PLACE GAME AND THE LOWER BRACKET ARE SCORED BY THE SAME RULE. The third-place game is a
 * matchup in the championship round's own row, so it is scored with the final over the same weeks.
 * The consolation bracket / toilet bowl (rounds at `100 + n`) used to be generated and never scored;
 * it is now its own group, scored over championship round `n`'s weeks and sealed separately.
 *
 * ⚠ SERIES MODE (lib/playoff-runtime/playoffSeries.ts): when `settings.playoff_series` makes a round a
 * best-of-N, each of its N weeks is one GAME, won by the higher points (a tie by the higher seed). A game
 * counts once its week is sealed and both teams' rows are final, in week order. The series is written
 * final the moment one team reaches ceil(N/2) wins — it can clinch before its last week — with
 * `metadata.series` carrying the games and the record; the score columns hold the points over the games
 * played (for display), and the advance decides the winner from the series, never from those points.
 * Until it clinches, the running series goes to `metadata.series` and the columns stay null, exactly as
 * a cumulative round's live totals do.
 *
 * ⚠ A HEAD-TO-HEAD CATEGORY LEAGUE'S ROUND IS DECIDED BY CATEGORY WINS, as its regular-season weeks are
 * (`updateMatchupScores`). The score columns used to hold the round's summed fantasy points — a number
 * a category league never plays for, so its title went to whoever happened to have more points. Now each
 * team's stats are added up over the round's weeks and the categories compared once
 * (`resolveCategoryMatchup`): the columns hold category wins, `metadata.categoryMatchup` the breakdown,
 * and a tie on wins goes to the seed like any tie. In series mode each week's GAME is that week's
 * categories. The category list is the one in force for the round's first week (`settingsForScoringWeek`).
 *
 * The score of each team is `scoreRosterForWeek`, the function the guillotine uses for a week
 * scored outside a head-to-head matchup: starter slots, best ball's optimal lineup, or the devy
 * engine, by the same rules as a regular-season matchup. Nothing is re-implemented here.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { finalizeWeekWithRefresh, type WeekFinalizerDeps } from '@/lib/redraft/weekFinalizer'
import { REDRAFT_SEASON_STATUS } from '@/lib/redraft/seasonStatus'
import { CHAMPIONSHIP_ROUND_WHERE, CONSOLATION_ROUND_OFFSET, playoffRoundWeeks, readChampionshipLength } from './playoffRoundWeeks'
import { readPlayoffSeriesLengths, resolvePlayoffSeries, seriesLengthForRound, type StoredPlayoffSeries } from './playoffSeries'
import { accumulateTeamTotals, resolveCategoryMatchup, type TeamStatTotals } from '@/lib/category-scoring'
import { resolveLeagueCategories, settingsForScoringWeek } from '@/lib/category-scoring/leagueScoringType'
import type { CategoryDefinition } from '@/lib/category-scoring/types'

export type PlayoffRoundScoreOutcome =
  /** The season is not in its playoffs (still regular season, or already complete). */
  | 'not_in_playoffs'
  /** In playoffs with no bracket rows — the postseason roller generates one. */
  | 'no_bracket'
  /** Every round is decided; the roller finalizes the season. */
  | 'no_active_round'
  /** The active round's first week has not arrived on the calendar yet. */
  | 'round_not_started'
  /** Running totals written to `metadata.live`; the round is not final yet. */
  | 'live'
  /** Final scores written; the roller advances the bracket on its next run. */
  | 'scored'
  /** The active round already carries final scores and is waiting on the roller. */
  | 'already_scored'

export type PlayoffRoundScoreResult = {
  seasonId: string
  outcome: PlayoffRoundScoreOutcome
  roundNumber?: number
  weeks?: number[]
  matchupsScored: number
  matchupsLive: number
  /** The finalizer's own refusal for each week of the round that has not sealed. */
  weekRefusals: Record<number, string>
  /** Set when `RedraftSeason.currentWeek` was moved forward onto the round being played. */
  currentWeekMovedTo?: number
  /** The consolation bracket or toilet bowl, when the bracket has one (`LowerBracketScoreResult`). */
  lowerBracket?: LowerBracketScoreResult
}

export type PlayoffRoundScoreDeps = {
  prisma?: PrismaClient
  now?: () => Date
  scoreRoster?: typeof scoreRosterForWeek
  finalizeWeek?: typeof finalizeWeekWithRefresh
  syncWeekStats?: WeekFinalizerDeps['syncWeekStats']
}

type PlayoffMatchupRow = {
  id: string
  homeRosterId: string | null
  awayRosterId: string | null
  homeScore: number | null
  awayScore: number | null
  homeSeed?: number | null
  awaySeed?: number | null
  winnerRosterId: string | null
  status: string
  metadata: unknown
}

/** A matchup that two teams actually play: not a bye, not already decided. */
function isContested<T extends PlayoffMatchupRow>(m: T): m is T & { homeRosterId: string; awayRosterId: string } {
  return Boolean(m.homeRosterId && m.awayRosterId) && m.status !== 'bye' && !m.winnerRosterId
}

function isScoredFinal(m: PlayoffMatchupRow): boolean {
  return m.status === 'final' && m.homeScore != null && m.awayScore != null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

type PlayoffRoundRow = { roundNumber: number; status: string; matchups: PlayoffMatchupRow[] }

const ROUND_SELECT = {
  roundNumber: true,
  status: true,
  matchups: {
    orderBy: { matchupNumber: 'asc' },
    select: {
      id: true,
      homeRosterId: true,
      awayRosterId: true,
      homeScore: true,
      awayScore: true,
      homeSeed: true,
      awaySeed: true,
      winnerRosterId: true,
      status: true,
      metadata: true,
    },
  },
} as const

/**
 * The categories a head-to-head category league plays this week for, or null for a points league (and
 * for roto, which has no head-to-head games). The same reading `updateMatchupScores` makes.
 */
function headToHeadCategories(settings: unknown, seasonYear: number, week: number): readonly CategoryDefinition[] | null {
  const scoring = settingsForScoringWeek(settings as Record<string, any> | null, seasonYear, week)
  const mode = scoring?.scoring_mode ?? scoring?.scoringSettings?.scoringMode ?? 'points'
  if (mode !== 'h2h_category') return null
  const categories = resolveLeagueCategories(scoring, scoring?.category_preset_id ?? scoring?.scoringSettings?.categoryPresetId)
  if (!categories) throw new Error('Category scoring requires a supported native category preset.')
  return categories
}

/** The same "which round is live" rule the runtime's advance uses: the one marked active, else the first with a matchup still to decide. */
function activeRoundOf(rounds: PlayoffRoundRow[]): PlayoffRoundRow | undefined {
  return rounds.find((r) => r.status === 'active') ?? rounds.find((r) => r.status !== 'completed' && r.matchups.some(isContested))
}

type GroupScore = {
  outcome: Exclude<PlayoffRoundScoreOutcome, 'not_in_playoffs' | 'no_bracket'>
  roundNumber?: number
  weeks?: number[]
  matchupsScored: number
  matchupsLive: number
  weekRefusals: Record<number, string>
}

/**
 * The lower bracket (consolation or toilet bowl), scored on its own. Its rounds are stored at
 * `100 + n`, where `n` is the championship round it is played alongside, so its weeks are that
 * round's weeks — and its final is the championship's, `championship_length` included.
 */
export type LowerBracketScoreResult = GroupScore

export async function scoreActivePlayoffRound(
  params: { seasonId: string; calendarWeek: number },
  deps: PlayoffRoundScoreDeps = {},
): Promise<PlayoffRoundScoreResult> {
  const db = deps.prisma ?? (defaultPrisma as unknown as PrismaClient)
  const scoreRoster = deps.scoreRoster ?? scoreRosterForWeek
  const finalizeWeek = deps.finalizeWeek ?? finalizeWeekWithRefresh
  const result: PlayoffRoundScoreResult = {
    seasonId: params.seasonId,
    outcome: 'not_in_playoffs',
    matchupsScored: 0,
    matchupsLive: 0,
    weekRefusals: {},
  }

  const season = await db.redraftSeason.findFirst({
    where: { id: params.seasonId },
    select: { id: true, leagueId: true, season: true, status: true, currentWeek: true, playoffStartWeek: true },
  })
  if (!season || season.status !== REDRAFT_SEASON_STATUS.PLAYOFFS) return result

  const rounds = (await db.redraftPlayoffRound.findMany({
    where: { seasonId: season.id, roundNumber: CHAMPIONSHIP_ROUND_WHERE },
    orderBy: { roundNumber: 'asc' },
    select: ROUND_SELECT,
  })) as PlayoffRoundRow[]
  if (rounds.length === 0) return { ...result, outcome: 'no_bracket' }
  // Every championship round is generated up front, so the highest one IS the final.
  const finalRoundNumber = rounds[rounds.length - 1].roundNumber

  let leagueRead: Promise<{ playoffWeeksPerRound: number | null; settings: unknown } | null> | null = null
  const league = () =>
    (leagueRead ??= db.league.findFirst({
      where: { id: season.leagueId },
      select: { playoffWeeksPerRound: true, settings: true },
    }) as Promise<{ playoffWeeksPerRound: number | null; settings: unknown } | null>)

  let pointer = season.currentWeek
  const scoreGroup = async (active: PlayoffRoundRow | undefined, roundNumber: (r: PlayoffRoundRow) => number): Promise<GroupScore> => {
    const group: GroupScore = { outcome: 'no_active_round', matchupsScored: 0, matchupsLive: 0, weekRefusals: {} }
    if (!active) return group
    const contested = active.matchups.filter(isContested)
    if (contested.length === 0 || contested.every(isScoredFinal)) {
      return { ...group, outcome: contested.length === 0 ? 'no_active_round' : 'already_scored', roundNumber: active.roundNumber }
    }
    const leagueRow = await league()
    const seriesLengths = readPlayoffSeriesLengths(leagueRow?.settings)
    const weeks = playoffRoundWeeks({
      playoffStartWeek: season.playoffStartWeek,
      roundNumber: roundNumber(active),
      weeksPerRound: leagueRow?.playoffWeeksPerRound,
      finalRoundNumber,
      championshipLength: readChampionshipLength(leagueRow?.settings),
      seriesLengths,
    })
    const bestOf = seriesLengthForRound(seriesLengths, roundNumber(active))
    const categories = headToHeadCategories(leagueRow?.settings, season.season, weeks[0])
    group.roundNumber = active.roundNumber
    group.weeks = weeks
    if (params.calendarWeek < weeks[0]) return { ...group, outcome: 'round_not_started' }

    /*
     * Keep the league's week pointer on the round being played, forward only. Nothing moved
     * `currentWeek` after the bracket was generated, so My Team and Matchup sat on the first
     * playoff week for the whole postseason.
     */
    const target = Math.min(Math.max(params.calendarWeek, weeks[0]), weeks[weeks.length - 1])
    if (pointer < target) {
      await db.redraftSeason.update({ where: { id: season.id }, data: { currentWeek: target } })
      pointer = target
      result.currentWeekMovedTo = target
    }

    const rosterIds = [...new Set(contested.flatMap((m) => [m.homeRosterId, m.awayRosterId]))]
    const playedWeeks = weeks.filter((w) => w <= params.calendarWeek)
    const sealed = new Set<number>()
    for (const week of playedWeeks) {
      const sealing = await finalizeWeek(
        { seasonId: season.id, week, rosterIds },
        { prisma: db, now: deps.now, syncWeekStats: deps.syncWeekStats },
      )
      if (sealing.finalized || sealing.alreadyFinal) sealed.add(week)
      else if (sealing.refusal) group.weekRefusals[week] = sealing.refusal
    }
    const roundSealed = weeks.every((w) => sealed.has(w))

    const totals = async (rosterId: string) => {
      let points = 0
      let allFinal = true
      const weekStats: TeamStatTotals[] = []
      for (const week of playedWeeks) {
        const summary = await scoreRoster({ leagueId: season.leagueId, rosterId, week, seasonYear: season.season })
        points += summary.points
        weekStats.push(summary.statTotals ?? {})
        if (!summary.allFinal) allFinal = false
      }
      return { points: Math.round(points * 100) / 100, allFinal, stats: accumulateTeamTotals(weekStats) }
    }
    /** The two scores a matchup is decided on: category wins in a category league, else points. */
    const decide = (home: { points: number; stats: TeamStatTotals }, away: { points: number; stats: TeamStatTotals }) => {
      if (!categories) return { homeScore: home.points, awayScore: away.points, categoryMatchup: null }
      const result = resolveCategoryMatchup(home.stats, away.stats, categories)
      return {
        homeScore: result.aWins,
        awayScore: result.bWins,
        categoryMatchup: { homeWins: result.aWins, awayWins: result.bWins, ties: result.ties, categories: result.categories },
      }
    }

    const scoredAt = (deps.now?.() ?? new Date()).toISOString()

    if (bestOf > 1) {
      // Series mode: one game per week. A week's game counts once that week is sealed and both teams'
      // rows are final; games count in week order, so a later week never jumps an unsettled earlier one.
      const weekly = async (rosterId: string) => {
        const rows: Array<{ week: number; points: number; allFinal: boolean; stats: TeamStatTotals }> = []
        for (const week of playedWeeks) {
          const summary = await scoreRoster({ leagueId: season.leagueId, rosterId, week, seasonYear: season.season })
          rows.push({ week, points: Math.round(summary.points * 100) / 100, allFinal: summary.allFinal, stats: summary.statTotals ?? {} })
        }
        return rows
      }
      for (const matchup of contested) {
        const home = await weekly(matchup.homeRosterId)
        const away = await weekly(matchup.awayRosterId)
        const games: Array<{ week: number; homePoints: number; awayPoints: number }> = []
        const liveGames: Array<{ week: number; homePoints: number; awayPoints: number }> = []
        let settled = true
        home.forEach((h, i) => {
          const a = away[i]
          // A category league's game is that week's categories: the "points" are category wins.
          const decided = decide(h, a)
          const game = { week: h.week, homePoints: decided.homeScore, awayPoints: decided.awayScore }
          if (settled && sealed.has(h.week) && h.allFinal && a.allFinal) games.push(game)
          else {
            settled = false
            liveGames.push(game)
          }
        })
        const series = resolvePlayoffSeries({
          bestOf,
          homeRosterId: matchup.homeRosterId,
          awayRosterId: matchup.awayRosterId,
          homeSeed: matchup.homeSeed,
          awaySeed: matchup.awaySeed,
          games,
        })
        const metadata = asRecord(matchup.metadata)
        const stored: StoredPlayoffSeries = {
          bestOf: series.bestOf,
          winsNeeded: series.winsNeeded,
          homeWins: series.homeWins,
          awayWins: series.awayWins,
          games: series.games.map((g) => ({
            week: g.week,
            homePoints: g.homePoints,
            awayPoints: g.awayPoints,
            winnerRosterId: g.winnerRosterId,
            ...(g.decidedBySeed ? { decidedBySeed: true } : {}),
          })),
          winnerRosterId: series.winnerRosterId,
          clinchedWeek: series.clinchedWeek,
        }
        const sum = (xs: Array<{ homePoints: number; awayPoints: number }>, side: 'homePoints' | 'awayPoints') =>
          Math.round(xs.reduce((t, g) => t + g[side], 0) * 100) / 100

        if (series.winnerRosterId) {
          delete metadata.live
          const counted = series.games
          await db.redraftPlayoffMatchup.update({
            where: { id: matchup.id },
            data: {
              homeScore: sum(counted, 'homePoints'),
              awayScore: sum(counted, 'awayPoints'),
              status: 'final',
              metadata: {
                ...metadata,
                series: stored,
                scoredWeeks: counted.map((g) => g.week),
                scoredAt,
              } as Prisma.InputJsonObject,
            },
          })
          group.matchupsScored += 1
        } else {
          // Not clinched: the record so far and the games being played, never the score columns.
          const all = [...games, ...liveGames]
          await db.redraftPlayoffMatchup.update({
            where: { id: matchup.id },
            data: {
              metadata: {
                ...metadata,
                series: {
                  ...stored,
                  games: [...stored.games, ...liveGames.map((g) => ({ ...g, winnerRosterId: null, live: true }))],
                },
                live: { homeScore: sum(all, 'homePoints'), awayScore: sum(all, 'awayPoints'), weeks: playedWeeks, updatedAt: scoredAt },
              } as Prisma.InputJsonObject,
            },
          })
          group.matchupsLive += 1
        }
      }
      return { ...group, outcome: group.matchupsLive === 0 ? 'scored' : 'live' }
    }

    for (const matchup of contested) {
      const home = await totals(matchup.homeRosterId)
      const away = await totals(matchup.awayRosterId)
      const metadata = asRecord(matchup.metadata)

      const { homeScore, awayScore, categoryMatchup } = decide(home, away)
      if (categoryMatchup) metadata.categoryMatchup = categoryMatchup

      if (roundSealed && home.allFinal && away.allFinal) {
        delete metadata.live
        await db.redraftPlayoffMatchup.update({
          where: { id: matchup.id },
          data: {
            homeScore,
            awayScore,
            status: 'final',
            metadata: { ...metadata, scoredWeeks: weeks, scoredAt } as Prisma.InputJsonObject,
          },
        })
        group.matchupsScored += 1
      } else {
        // ⚠ STATUS IS LEFT ALONE WHILE LIVE. The column is CHECK-constrained to scheduled /
        // in_progress / final / bye / cancelled, so the runtime's 'active' is refused (23514) — the
        // first real-database season run died here. Writing in_progress instead would move the failure,
        // not remove it: the runtime reads in_progress back as 'active', and the round advance writes
        // every matchup's status back inside one transaction, so the whole advance would refuse.
        // Only 'final' is written, and only when the round is final.
        await db.redraftPlayoffMatchup.update({
          where: { id: matchup.id },
          data: {
            metadata: {
              ...metadata,
              live: { homeScore, awayScore, weeks: playedWeeks, updatedAt: scoredAt },
            } as Prisma.InputJsonObject,
          },
        })
        group.matchupsLive += 1
      }
    }
    return { ...group, outcome: group.matchupsLive === 0 ? 'scored' : 'live' }
  }

  // The title bracket: the round being played, with the third-place game that shares the final's row.
  const title = await scoreGroup(activeRoundOf(rounds), (r) => r.roundNumber)

  /*
   * ⚠ THE LOWER BRACKET IS SEALED AND SCORED SEPARATELY, AFTER THE TITLE BRACKET. Its teams missed the
   * playoffs and are the likeliest to leave a lineup abandoned; sealing them in the same call would let
   * that lineup's coverage hold the title round's week below the floor. Its own round is chosen by its
   * own status, so a lower round that lags (its week refused) is still scored on a later run.
   */
  const lowerRows = ((await db.redraftPlayoffRound.findMany({
    where: { seasonId: season.id, roundNumber: { gte: CONSOLATION_ROUND_OFFSET } },
    orderBy: { roundNumber: 'asc' },
    select: ROUND_SELECT,
  })) as PlayoffRoundRow[] | null ?? []).filter((r) => r.roundNumber >= CONSOLATION_ROUND_OFFSET)
  const lower = lowerRows.length
    ? await scoreGroup(activeRoundOf(lowerRows), (r) => r.roundNumber - CONSOLATION_ROUND_OFFSET)
    : null

  return {
    ...result,
    outcome: title.outcome,
    roundNumber: title.roundNumber,
    weeks: title.weeks,
    matchupsScored: title.matchupsScored,
    matchupsLive: title.matchupsLive,
    weekRefusals: title.weekRefusals,
    ...(lower ? { lowerBracket: lower } : {}),
  }
}
