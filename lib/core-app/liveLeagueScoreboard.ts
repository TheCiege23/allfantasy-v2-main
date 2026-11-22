import { prisma } from '@/lib/prisma'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import { getLeagueScoreboard, type ScoreboardGame } from './leagueScoreboard'
import { latestProjectionWeek } from './playerProjections'

/**
 * The rest of the held league's games this week, for Live scores (`/core/live?league=`).
 *
 * ⚠ NOT A NEW READ PATH. This is `getLeagueScoreboard` — the same Postgres read (WeeklyMatchup,
 * LeagueTeam, Roster) League Home and the schedule draw their league scoreboard from — for the week
 * the viewer's own matchup is in. No provider is called; a league with nothing stored has no games.
 *
 * Your own game is left out: it is already the scoreboard card above. Null when the board cannot be
 * read (no platform id, a read failure): the section then says nothing rather than "no other games".
 */
export type LiveLeagueGames = {
  week: number
  /** Nothing in the week has been scored, so every number is a projection. */
  allUnplayed: boolean
  games: ScoreboardGame[]
}

export async function getLiveLeagueGames(args: {
  leagueId: string
  userId: string
  seasonYear: number
  week: number
}): Promise<LiveLeagueGames | null> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { id: true, platformLeagueId: true, settings: true },
  })
  if (!league) return null
  const yours = await prisma.leagueTeam.findFirst({
    where: { leagueId: league.id, claimedByUserId: args.userId },
    select: { externalId: true },
  })
  const board = await getLeagueScoreboard({
    leagueId: league.id,
    platformLeagueId: league.platformLeagueId,
    seasonYear: args.seasonYear,
    week: args.week,
    yourRosterId: yours?.externalId ?? null,
    scoringSettings: extractScoringSettings(league.settings),
    projectionWeek: await latestProjectionWeek().catch(() => null),
  })
  if (!board) return null
  return {
    week: board.week,
    allUnplayed: board.allUnplayed,
    games: otherGames(board.games),
  }
}

/** Every paired game except the viewer's own — that one is the scoreboard card already on screen. */
export function otherGames(games: ScoreboardGame[]): ScoreboardGame[] {
  return games.filter((g) => g.teams.length >= 2 && !g.teams.some((t) => t.isYou))
}
