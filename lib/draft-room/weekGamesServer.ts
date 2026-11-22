/**
 * Server only: this week's NBA / NHL / MLB games from Postgres (`SportsGame`). Kept apart from
 * `weekGames.ts` so the roster panel's formatting helpers never pull the database client into the
 * browser bundle. Import it only from server code (the API route).
 */
import { prisma } from '@/lib/prisma'
import { scheduleSport } from './proTeamKey'
import { summarizeWeekGames, WEEK_GAMES_WINDOW_DAYS, type WeekGamesByTeam } from './weekGames'

/** Server: this week's games for one sport, from Postgres. Empty for football and unknown sports. */
export async function loadWeekGames(sport: string, now: Date = new Date()): Promise<WeekGamesByTeam> {
  const s = scheduleSport(sport)
  if (!s) return {}
  const rows = await prisma.sportsGame.findMany({
    where: {
      sport: s,
      startTime: { gte: now, lt: new Date(now.getTime() + WEEK_GAMES_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
    },
    select: { homeTeam: true, awayTeam: true, startTime: true },
    orderBy: { startTime: 'asc' },
    take: 2000,
  })
  return summarizeWeekGames(rows, s, now)
}

