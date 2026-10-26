import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { prisma } from "@/lib/prisma"
import { isOfficialTeamName } from "@/lib/playoffs/playoffBracketProjection"
import { readCfpSeeds } from "@/lib/playoffs/cfpSeeds"
import { readNbaCupField } from "@/lib/playoffs/nbaCupSeeds"
import { readSingleGameSchedule } from "@/lib/playoffs/singleGameSchedule"

export const dynamic = "force-dynamic"

type Game = {
  id: string; seriesNumber: number; sourceSeriesHome: number | null; sourceSeriesAway: number | null
  homeTeamName: string; awayTeamName: string; winnerTeamName: string | null; status: string
  startsAt: Date | null; liveHomeScore: number | null; liveAwayScore: number | null
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const sport = body?.sport === "ncaaf" || body?.sport === "nba_cup" ? body.sport : null
  const season = Number(body?.season)
  const seriesNumber = Number(body?.seriesNumber)
  const homeScore = body?.homeScore == null ? NaN : Number(body.homeScore)
  const awayScore = body?.awayScore == null ? NaN : Number(body.awayScore)
  if (!sport || !Number.isInteger(season) || season < 2024 || season > 2100 ||
    !Number.isInteger(seriesNumber) || seriesNumber < 1 || seriesNumber > (sport === "ncaaf" ? 11 : 7) ||
    !Number.isInteger(homeScore) || !Number.isInteger(awayScore) ||
    homeScore < 0 || awayScore < 0 || homeScore > 300 || awayScore > 300 || homeScore === awayScore) {
    return NextResponse.json({ error: "Valid tournament, game number, and unequal final scores are required." }, { status: 400 })
  }
  const [field, schedule] = await Promise.all([
    sport === "ncaaf" ? readCfpSeeds(season) : readNbaCupField(season),
    readSingleGameSchedule(sport, season),
  ])
  const scheduled = schedule?.games.find((game) => game.seriesNumber === seriesNumber)
  if (!field || !scheduled || Date.parse(scheduled.startsAt) > Date.now()) {
    return NextResponse.json({ error: "Published teams and an already-started scheduled game are required." }, { status: 409 })
  }

  const challenges = await (prisma as any).playoffBracketChallenge.findMany({
    where: { sport, seasonYear: season, isTestMode: false },
    select: { id: true, series: { select: {
      id: true, seriesNumber: true, sourceSeriesHome: true, sourceSeriesAway: true,
      homeTeamName: true, awayTeamName: true, winnerTeamName: true, status: true,
      startsAt: true, liveHomeScore: true, liveAwayScore: true,
    } } },
  }) as Array<{ id: string; series: Game[] }>
  if (!challenges.length) return NextResponse.json({ error: "No league brackets exist for this tournament." }, { status: 409 })

  const updates: Array<{ id: string; challengeId: string; home: string; away: string; winner: string }> = []
  const identities = new Set<string>()
  for (const challenge of challenges) {
    const byNumber = new Map(challenge.series.map((row) => [row.seriesNumber, row]))
    const game = byNumber.get(seriesNumber)
    if (!game || !game.startsAt || game.startsAt.getTime() > Date.now()) {
      return NextResponse.json({ error: `League ${challenge.id} has no started game ${seriesNumber}; nothing was changed.` }, { status: 409 })
    }
    const home = game.sourceSeriesHome == null ? game.homeTeamName : byNumber.get(game.sourceSeriesHome)?.winnerTeamName ?? ""
    const away = game.sourceSeriesAway == null ? game.awayTeamName : byNumber.get(game.sourceSeriesAway)?.winnerTeamName ?? ""
    if (!isOfficialTeamName(home) || !isOfficialTeamName(away) || /^(CFP|EAST|WEST)\d+$/i.test(home) || /^(CFP|EAST|WEST)\d+$/i.test(away) || home === away) {
      return NextResponse.json({ error: `League ${challenge.id} is missing prior verified winners; nothing was changed.` }, { status: 409 })
    }
    identities.add(`${home}\u0000${away}`)
    const winner = homeScore > awayScore ? home : away
    if (game.status === "final") {
      if (game.winnerTeamName !== winner || game.liveHomeScore !== homeScore || game.liveAwayScore !== awayScore) {
        return NextResponse.json({ error: `League ${challenge.id} already has a different final; nothing was changed.` }, { status: 409 })
      }
      continue
    }
    updates.push({ id: game.id, challengeId: challenge.id, home, away, winner })
  }
  if (identities.size !== 1) {
    return NextResponse.json({ error: "League matchups disagree. Reconcile teams before publishing a universal result." }, { status: 409 })
  }
  await prisma.$transaction(async (tx) => {
    for (const game of updates) {
      await (tx as any).playoffBracketSeries.update({
        where: { id: game.id },
        data: {
          homeTeamName: game.home, awayTeamName: game.away, winnerTeamName: game.winner,
          status: "final", homeTeamWins: homeScore > awayScore ? 1 : 0,
          awayTeamWins: awayScore > homeScore ? 1 : 0,
          liveHomeScore: homeScore, liveAwayScore: awayScore, liveStatus: "Final",
          seriesSummary: `${game.winner} won ${homeScore}-${awayScore}`, lastSyncedAt: new Date(),
        },
      })
    }
  })
  const actor = resolveAdminAuditActor(gate.user)
  await logAdminAudit({
    adminUserId: actor, action: "season_bracket_result.publish",
    targetType: "bracket_season_game", targetId: `${sport}:${season}:${seriesNumber}`,
    details: { sport, season, seriesNumber, homeScore, awayScore, updatedPools: updates.length, totalPools: challenges.length },
  })
  return NextResponse.json({ ok: true, winner: updates[0]?.winner ?? "already recorded", updatedPools: updates.length, totalPools: challenges.length })
}
