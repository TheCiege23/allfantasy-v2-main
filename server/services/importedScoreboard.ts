import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueContextFor } from '@/lib/core-app/leagueContext'
import { resolveCurrentWeekForLeague } from '@/lib/core-app/currentWeek'
import { currentScheduledLeagueWeek, leagueWeekProgress } from '@/lib/core-app/leagueWeekProgress'
import { loadFinishedNflWeeks } from '@/lib/core-app/finishedNflWeeks'
import { rosterLabel } from '@/lib/core-app/managerName'
import { eliminationFormat } from '@/lib/core-app/railMatchupMode'
import { importedBoardGames } from '@/lib/matchup-center/importedScoreboard'
import type { NativeBoardGame } from '@/lib/matchup-center/nativeMatchupModel'

/**
 * An imported league's week of games for the Matchup tab's scoreboard.
 *
 * ⚠ THE WEEK IS PICKED EXACTLY AS `lib/core-app/matchup.ts` PICKS IT, so "My matchup" (which reads
 * through that loader since #4139) and the scoreboard beside it never show two different weeks: the
 * league's stated week pins the stored-week lookup, and with no week asked a finished slate rolls on
 * to the next scheduled one. Null when the league has no stored weeks, or no head-to-head at all
 * (an elimination league is scored against the field).
 */
export async function loadImportedScoreboard(params: {
  leagueId: string
  viewerUserId: string
  week?: number
}): Promise<{ season: number; week: number; games: NativeBoardGame[] } | null> {
  const lc = leagueContextFor(params.leagueId, params.viewerUserId)
  const league = await lc.league()
  const platformLeagueId = league?.platformLeagueId
  if (!league || !platformLeagueId || eliminationFormat(league)) return null

  const progress = leagueWeekProgress(league)
  const resolved = await resolveCurrentWeekForLeague(platformLeagueId, params.week ?? progress.currentWeek)
  if (!resolved) return null
  let { seasonYear, week } = resolved

  const finishedNfl =
    String(league.sport ?? '').toUpperCase() === 'NFL'
      ? await loadFinishedNflWeeks([{ season: seasonYear, week }]).catch(() => undefined)
      : undefined
  if (params.week == null && week === progress.currentWeek) {
    const stored = await prisma.weeklyMatchup
      .groupBy({ by: ['week'], where: { leagueId: platformLeagueId, seasonYear } })
      .then((g) => g.map((r) => r.week).sort((a, b) => a - b))
      .catch(() => [] as number[])
    const next = currentScheduledLeagueWeek(league, seasonYear, stored, finishedNfl)
    if (next != null) week = next
  }
  const finalProgress = finishedNfl ? leagueWeekProgress(league, finishedNfl) : progress

  const [rows, teams, mine] = await Promise.all([
    prisma.weeklyMatchup.findMany({
      where: { leagueId: platformLeagueId, seasonYear, week },
      select: { rosterId: true, matchupId: true, game: true, pointsFor: true },
    }),
    prisma.leagueTeam.findMany({ where: { leagueId: league.id }, select: { externalId: true, teamName: true, ownerName: true } }),
    lc.claimedTeam().catch(() => null),
  ])
  const byId = new Map(teams.map((t) => [String(t.externalId), t]))
  const games = importedBoardGames(rows, {
    nameOf: (id) => rosterLabel([byId.get(id)?.teamName, byId.get(id)?.ownerName], id),
    viewerRosterId: mine?.externalId ?? null,
    weekFinal: finalProgress.isFinal(seasonYear, week),
  })
  return { season: seasonYear, week, games }
}
