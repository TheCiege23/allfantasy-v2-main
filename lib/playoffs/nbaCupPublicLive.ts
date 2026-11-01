import type { PlayoffChallengeView, PlayoffSeriesView } from "./types"
import { cupGameDetails } from "./nbaCupProgress"
import { cupGameDetail } from "./nbaCupBoard"

export type NbaCupPublicScore = { entryId: string; rank: number | null; totalScore: number; potentialTotal: number; correctPicks: number; resolvedPicks: number }
export type NbaCupPublicLive = { series: PlayoffSeriesView[]; scores: NbaCupPublicScore[]; syncedAt: string | null }

/** Explicit public projection: no picks, user IDs, names, invitations or complete entry objects. */
export function nbaCupPublicLive(view: PlayoffChallengeView): NbaCupPublicLive {
  return {
    series: view.series.map((game) => {
      const details = cupGameDetails(game)
      const board = cupGameDetail(game)
      return {
        id: game.id, round: game.round, roundIndex: game.roundIndex, seriesNumber: game.seriesNumber,
        conference: game.conference, homeSeed: game.homeSeed, awaySeed: game.awaySeed,
        homeTeamName: game.homeTeamName, awayTeamName: game.awayTeamName, winnerTeamName: game.winnerTeamName,
        bestOf: game.bestOf, status: game.status, startsAt: game.startsAt,
        gameLabel: game.gameLabel, location: game.location, venue: game.venue,
        liveHomeScore: game.liveHomeScore, liveAwayScore: game.liveAwayScore, liveStatus: game.liveStatus,
        seriesSummary: game.seriesSummary, lastSyncedAt: game.lastSyncedAt,
        nextSeriesNumber: game.nextSeriesNumber, nextSeriesSlot: game.nextSeriesSlot,
        sourceSeriesHome: game.sourceSeriesHome, sourceSeriesAway: game.sourceSeriesAway,
        providerGamesJson: { period: details.period, clock: details.clock, statusDetail: details.statusDetail,
          homeLeaders: details.homeLeaders, awayLeaders: details.awayLeaders,
          homeRegulationPoints: details.homeRegulationPoints, awayRegulationPoints: details.awayRegulationPoints,
          live: { detail: board.detail, period: board.period, clock: board.clock,
            homeLeader: board.homeLeader, awayLeader: board.awayLeader, homeLines: board.homeLines, awayLines: board.awayLines },
          teams: { homeAbbr: board.homeAbbr, awayAbbr: board.awayAbbr, homeColor: board.homeColor, awayColor: board.awayColor } },
      }
    }),
    // These numeric totals already appear on public pool standings. Drafts are excluded.
    scores: view.entries.filter((entry) => entry.isComplete).map((entry) => ({
      entryId: entry.id, rank: entry.rank ?? null, totalScore: entry.totalScore ?? 0,
      potentialTotal: entry.potentialTotal ?? 0, correctPicks: entry.correctPicks ?? 0, resolvedPicks: entry.resolvedPicks ?? 0,
    })),
    syncedAt: view.nbaCupLastSyncedAt ?? null,
  }
}
