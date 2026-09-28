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
 *
 * ⚠ WEEKS ARE SEALED FOR THE TEAMS STILL PLAYING ONLY. The finalizer's coverage floor is measured
 * over every roster it is given, and an eliminated team's abandoned lineup — injured starters, a
 * player on a bye — can hold the whole league's week below the floor. `rosterIds` narrows it.
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
import { CHAMPIONSHIP_ROUND_WHERE, playoffRoundWeeks } from './playoffRoundWeeks'

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

  const rounds = await db.redraftPlayoffRound.findMany({
    where: { seasonId: season.id, roundNumber: CHAMPIONSHIP_ROUND_WHERE },
    orderBy: { roundNumber: 'asc' },
    select: {
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
          winnerRosterId: true,
          status: true,
          metadata: true,
        },
      },
    },
  })
  if (rounds.length === 0) return { ...result, outcome: 'no_bracket' }

  // The same "which round is live" rule the runtime's advance uses: the one marked active, else the
  // first with a matchup still to decide.
  const active =
    rounds.find((r) => r.status === 'active') ??
    rounds.find((r) => r.status !== 'completed' && r.matchups.some(isContested))
  if (!active) return { ...result, outcome: 'no_active_round' }

  const contested = active.matchups.filter(isContested)
  if (contested.length === 0 || contested.every(isScoredFinal)) {
    return { ...result, outcome: contested.length === 0 ? 'no_active_round' : 'already_scored', roundNumber: active.roundNumber }
  }

  const league = await db.league.findFirst({
    where: { id: season.leagueId },
    select: { playoffWeeksPerRound: true },
  })
  const weeks = playoffRoundWeeks({
    playoffStartWeek: season.playoffStartWeek,
    roundNumber: active.roundNumber,
    weeksPerRound: league?.playoffWeeksPerRound,
  })
  const withRound = { ...result, roundNumber: active.roundNumber, weeks }
  if (params.calendarWeek < weeks[0]) return { ...withRound, outcome: 'round_not_started' }

  /*
   * Keep the league's week pointer on the round being played, forward only. Nothing moved
   * `currentWeek` after the bracket was generated, so My Team and Matchup sat on the first
   * playoff week for the whole postseason.
   */
  const pointer = Math.min(Math.max(params.calendarWeek, weeks[0]), weeks[weeks.length - 1])
  if (season.currentWeek < pointer) {
    await db.redraftSeason.update({ where: { id: season.id }, data: { currentWeek: pointer } })
    withRound.currentWeekMovedTo = pointer
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
    else if (sealing.refusal) withRound.weekRefusals[week] = sealing.refusal
  }
  const roundSealed = weeks.every((w) => sealed.has(w))

  const totals = async (rosterId: string) => {
    let points = 0
    let allFinal = true
    for (const week of playedWeeks) {
      const summary = await scoreRoster({ leagueId: season.leagueId, rosterId, week, seasonYear: season.season })
      points += summary.points
      if (!summary.allFinal) allFinal = false
    }
    return { points: Math.round(points * 100) / 100, allFinal }
  }

  const scoredAt = (deps.now?.() ?? new Date()).toISOString()
  for (const matchup of contested) {
    const home = await totals(matchup.homeRosterId)
    const away = await totals(matchup.awayRosterId)
    const metadata = asRecord(matchup.metadata)

    if (roundSealed && home.allFinal && away.allFinal) {
      delete metadata.live
      await db.redraftPlayoffMatchup.update({
        where: { id: matchup.id },
        data: {
          homeScore: home.points,
          awayScore: away.points,
          status: 'final',
          metadata: { ...metadata, scoredWeeks: weeks, scoredAt } as Prisma.InputJsonObject,
        },
      })
      withRound.matchupsScored += 1
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
            live: { homeScore: home.points, awayScore: away.points, weeks: playedWeeks, updatedAt: scoredAt },
          } as Prisma.InputJsonObject,
        },
      })
      withRound.matchupsLive += 1
    }
  }

  return { ...withRound, outcome: withRound.matchupsLive === 0 ? 'scored' : 'live' }
}
