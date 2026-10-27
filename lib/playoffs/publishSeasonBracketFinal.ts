import "server-only"
import { prisma } from "@/lib/prisma"
import { isOfficialTeamName } from "./playoffBracketProjection"
import { readCfpSeeds } from "./cfpSeeds"
import { readNbaCupField } from "./nbaCupSeeds"
import { readSingleGameSchedule, type SingleGameSport } from "./singleGameSchedule"

type Game = {
  id: string; seriesNumber: number; sourceSeriesHome: number | null; sourceSeriesAway: number | null
  homeTeamName: string; awayTeamName: string; winnerTeamName: string | null; status: string
  startsAt: Date | null; liveHomeScore: number | null; liveAwayScore: number | null
}
type Pool = { id: string; series: Game[] }
type Resolved = { id: string; challengeId: string; home: string; away: string; game: Game }
export type SeasonGameRead =
  | { ok: true; home: string; away: string; games: Resolved[]; scheduledAt: string }
  | { ok: false; error: string }

export async function readSeasonBracketGame(input: {
  sport: SingleGameSport; season: number; seriesNumber: number
}): Promise<SeasonGameRead> {
  const { sport, season, seriesNumber } = input
  const [field, schedule] = await Promise.all([
    sport === "ncaaf" ? readCfpSeeds(season) : readNbaCupField(season),
    readSingleGameSchedule(sport, season),
  ])
  const scheduled = schedule?.games.find((game) => game.seriesNumber === seriesNumber)
  if (!field || !scheduled || Date.parse(scheduled.startsAt) > Date.now()) {
    return { ok: false, error: "Published teams and an already-started scheduled game are required." }
  }
  const pools = await (prisma as any).playoffBracketChallenge.findMany({
    where: { sport, seasonYear: season, isTestMode: false },
    select: { id: true, series: { select: {
      id: true, seriesNumber: true, sourceSeriesHome: true, sourceSeriesAway: true,
      homeTeamName: true, awayTeamName: true, winnerTeamName: true, status: true,
      startsAt: true, liveHomeScore: true, liveAwayScore: true,
    } } },
  }) as Pool[]
  if (!pools.length) return { ok: false, error: "No league brackets exist for this tournament." }
  const games: Resolved[] = []
  const identities = new Set<string>()
  for (const pool of pools) {
    const byNumber = new Map(pool.series.map((row) => [row.seriesNumber, row]))
    const game = byNumber.get(seriesNumber)
    if (!game || !game.startsAt || game.startsAt.getTime() > Date.now() ||
      game.startsAt.toISOString() !== scheduled.startsAt) {
      return { ok: false, error: `League ${pool.id} has no matching started game ${seriesNumber}; nothing was changed.` }
    }
    const home = game.sourceSeriesHome == null ? game.homeTeamName : byNumber.get(game.sourceSeriesHome)?.winnerTeamName ?? ""
    const away = game.sourceSeriesAway == null ? game.awayTeamName : byNumber.get(game.sourceSeriesAway)?.winnerTeamName ?? ""
    if (!isOfficialTeamName(home) || !isOfficialTeamName(away) ||
      /^(CFP|EAST|WEST)\\d+$/i.test(home) || /^(CFP|EAST|WEST)\\d+$/i.test(away) || home === away) {
      return { ok: false, error: `League ${pool.id} is missing prior verified winners; nothing was changed.` }
    }
    identities.add(`${home}\\u0000${away}`)
    games.push({ id: game.id, challengeId: pool.id, home, away, game })
  }
  if (identities.size !== 1) return { ok: false, error: "League matchups disagree. Reconcile teams before publishing a universal result." }
  return { ok: true, home: games[0].home, away: games[0].away, games, scheduledAt: scheduled.startsAt }
}

export async function publishSeasonBracketFinal(input: {
  sport: SingleGameSport; season: number; seriesNumber: number
  homeScore: number; awayScore: number; expectedHome?: string; expectedAway?: string
}): Promise<{ ok: true; winner: string; updatedPools: number; totalPools: number } | { ok: false; error: string }> {
  const { sport, season, seriesNumber, homeScore, awayScore } = input
  if (!Number.isInteger(season) || season < 2024 || season > 2100 ||
    !Number.isInteger(seriesNumber) || seriesNumber < 1 || seriesNumber > (sport === "ncaaf" ? 11 : 7) ||
    !Number.isInteger(homeScore) || !Number.isInteger(awayScore) ||
    homeScore < 0 || awayScore < 0 || homeScore > 300 || awayScore > 300 || homeScore === awayScore) {
    return { ok: false, error: "Valid tournament, game number, and unequal final scores are required." }
  }
  const read = await readSeasonBracketGame({ sport, season, seriesNumber })
  if (!read.ok) return read
  if ((input.expectedHome && input.expectedHome !== read.home) || (input.expectedAway && input.expectedAway !== read.away)) {
    return { ok: false, error: "Matchup changed after provider verification; nothing was changed." }
  }
  const winner = homeScore > awayScore ? read.home : read.away
  for (const { game, challengeId } of read.games) {
    if (game.status === "final" &&
      (game.winnerTeamName !== winner || game.liveHomeScore !== homeScore || game.liveAwayScore !== awayScore)) {
      return { ok: false, error: `League ${challengeId} already has a different final; nothing was changed.` }
    }
  }
  const updates = read.games.filter(({ game }) => game.status !== "final")
  try {
    await prisma.$transaction(async (tx) => {
      for (const row of updates) {
        const written = await (tx as any).playoffBracketSeries.updateMany({
          where: { id: row.id, status: { not: "final" }, startsAt: new Date(read.scheduledAt) },
          data: {
            homeTeamName: row.home, awayTeamName: row.away, winnerTeamName: winner,
            status: "final", homeTeamWins: homeScore > awayScore ? 1 : 0,
            awayTeamWins: awayScore > homeScore ? 1 : 0,
            liveHomeScore: homeScore, liveAwayScore: awayScore, liveStatus: "Final",
            seriesSummary: `${winner} won ${homeScore}-${awayScore}`, lastSyncedAt: new Date(),
          },
        })
        if (written.count !== 1) throw new Error("Concurrent result update; nothing was changed.")
      }
    })
  } catch {
    return { ok: false, error: "Concurrent result update; nothing was changed." }
  }
  return { ok: true, winner, updatedPools: updates.length, totalPools: read.games.length }
}
