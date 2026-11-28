/**
 * The commissioner's "Recalculate week" for a league that plays on AllFantasy.
 *
 * 🛑 THE BUTTON SCORED A SCHEDULE THE LEAGUE DOES NOT PLAY. `/scoring/process-week` ran
 * `processLeagueWeek`, which pairs teams with a round-robin it invents and writes side tables the
 * season never reads, then told every member "Scores and matchups have been processed for this week".
 * The league's real games (`RedraftMatchup`) and records were not touched.
 *
 * Here the button re-scores the league's own games for that week from the stats on file, the same two
 * calls the score sync makes, and refreshes the records.
 *
 * ⚠ A WEEK THE LEAGUE HAS NOT REACHED IS NOT SCORED: scoring marks a game as in play.
 *
 * ⚠ A FINAL WEEK IS NOT RE-SCORED. Every game of a sealed week is final and the records count it; a
 * manual re-score would re-read today's lineups for a week already played. A final score is changed on
 * purpose, one game at a time, with a score adjustment.
 */
import { prisma } from '@/lib/prisma'
import { runsOnAllFantasy } from '@/lib/league/switching/switchingLeague'
import { isSealedWeek } from './weekSealed'

export type CommissionerRecalcResult =
  | { kind: 'not_native_season' }
  | { kind: 'week_final'; week: number }
  | { kind: 'no_games'; week: number }
  | { kind: 'week_not_started'; week: number; currentWeek: number }
  | { kind: 'recalculated'; week: number; games: number; incomplete: number }

type Deps = {
  recalc?: (seasonId: string, week: number) => Promise<{ updated: number; incomplete: number }>
  updateStandings?: (seasonId: string, week: number) => Promise<unknown>
}

export async function recalcNativeLeagueWeek(
  args: { leagueId: string; seasonYear: number; week: number },
  deps: Deps = {},
): Promise<CommissionerRecalcResult> {
  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { platform: true, settings: true } })
  // Native leagues, and imported leagues made official here (rule 3: AllFantasy scoring is official).
  if (!league || !runsOnAllFantasy(league)) return { kind: 'not_native_season' }
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: args.leagueId, season: args.seasonYear },
    orderBy: { createdAt: 'desc' },
    select: { id: true, currentWeek: true },
  })
  if (!season) return { kind: 'not_native_season' }

  const games = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week: args.week },
    select: { status: true, awayRosterId: true },
  })
  if (games.length === 0) return { kind: 'no_games', week: args.week }
  // Scoring a week marks its games as in play: a week the league has not reached stays untouched.
  if (args.week > Math.max(1, season.currentWeek)) return { kind: 'week_not_started', week: args.week, currentWeek: season.currentWeek }
  if (isSealedWeek(games)) return { kind: 'week_final', week: args.week }

  const recalc = deps.recalc ?? (await import('./scoringEngine')).recalculateMatchupsForSeasonWeek
  const updateStandings = deps.updateStandings ?? (await import('./standingsEngine')).updateStandings
  const result = await recalc(season.id, args.week)
  // Records are a running total through a week: never roll them back to an earlier one.
  await updateStandings(season.id, Math.max(args.week, season.currentWeek))
  return { kind: 'recalculated', week: args.week, games: result.updated, incomplete: result.incomplete }
}
