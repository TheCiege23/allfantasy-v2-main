import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { loadCollegeTeamIndex } from "@/lib/sport-teams/collegeTeamIndexStore"
import { resolveCollegeTeam } from "@/lib/sport-teams/collegeTeamIdentity"

export const dynamic = "force-dynamic"

/** Public scoreboard data only; no bracket, user, pick, or league data. */
export async function GET() {
  try {
    const now = Date.now()
    const [index, games] = await Promise.all([
      loadCollegeTeamIndex(),
      prisma.sportsGame.findMany({ where: { sport: "NCAAF", source: "espn", status: "in_progress", fetchedAt: { gte: new Date(now - 5 * 60_000), lte: new Date(now) }, startTime: { gte: new Date(now - 8 * 60 * 60_000), lte: new Date(now) } }, select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, startTime: true, fetchedAt: true } }),
    ])
    const scores = index ? games.flatMap((game) => {
      const home = resolveCollegeTeam(game.homeTeam, index)?.school
      const away = resolveCollegeTeam(game.awayTeam, index)?.school
      return home && away && game.startTime && game.homeScore != null && game.awayScore != null
        ? [{ home, away, homeScore: game.homeScore, awayScore: game.awayScore, startsAt: game.startTime.toISOString(), fetchedAt: game.fetchedAt.toISOString() }] : []
    }) : []
    return NextResponse.json({ scores }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Live scores unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
