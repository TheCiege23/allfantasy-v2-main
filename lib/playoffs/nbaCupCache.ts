import "server-only"
import { prisma } from "@/lib/prisma"
import type { NbaCupGame } from "./nbaCupTournament"

export const nbaCupCacheKey = (season: number) => `BRACKET:nba_cup:automatic:${season}`
export type NbaCupSnapshot = { games: NbaCupGame[]; checkedDates: Record<string, string>; cursor: number; syncedAt: string }

export async function readNbaCupSnapshot(season: number): Promise<NbaCupSnapshot | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: nbaCupCacheKey(season) }, select: { data: true } })
  const data = row?.data as NbaCupSnapshot | null
  return data && Array.isArray(data.games) ? data : null
}

/** Provider metadata stays on the persisted matchup; readers never fetch ESPN. */
export function nbaCupSeriesRows(games: NbaCupGame[]) {
  return games.filter((game) => game.seriesNumber != null).map((game) => ({
    seriesNumber: game.seriesNumber!, round: game.round,
    roundIndex: game.round === "cup_group_play" ? 0 : game.round === "cup_quarterfinals" ? 1 : game.round === "cup_semifinals" ? 2 : 3,
    conference: game.conference, homeSeed: 0, awaySeed: 0, bestOf: 1,
    homeTeamName: game.homeTeamName, awayTeamName: game.awayTeamName,
    startsAt: game.startsAt ? new Date(game.startsAt) : null, status: game.status,
    winnerTeamName: game.winnerTeamName, venue: game.venue,
    liveHomeScore: game.homeScore, liveAwayScore: game.awayScore,
    liveStatus: game.blocked ? "Schedule pending" : game.statusDetail || game.status,
    seriesSummary: game.winnerTeamName ? `${game.homeScore}–${game.awayScore}` : null,
    providerGamesJson: { provider: "espn_nba_cup", eventId: game.eventId, gameLabel: game.label, location: game.location,
      period: game.period ?? null, clock: game.clock ?? null, statusDetail: game.statusDetail ?? null,
      homeLeaders: game.homeLeaders ?? [], awayLeaders: game.awayLeaders ?? [],
      homeRegulationPoints: game.homeRegulationPoints ?? null, awayRegulationPoints: game.awayRegulationPoints ?? null },
  }))
}
