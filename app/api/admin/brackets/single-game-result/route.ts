import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { prisma } from "@/lib/prisma"
import { isOfficialTeamName } from "@/lib/playoffs/playoffBracketProjection"
import { readCfpSeeds } from "@/lib/playoffs/cfpSeeds"
import { readNbaCupField } from "@/lib/playoffs/nbaCupSeeds"

export const dynamic = "force-dynamic"

type Row = {
  id: string
  seriesNumber: number
  sourceSeriesHome: number | null
  sourceSeriesAway: number | null
  homeTeamName: string
  awayTeamName: string
  winnerTeamName: string | null
  status: string
  liveHomeScore: number | null
  liveAwayScore: number | null
}

function intScore(value: unknown): number | null {
  const score = Number(value)
  return Number.isInteger(score) && score >= 0 && score <= 300 ? score : null
}

/** Manual, audited result input for single-game CFP and NBA Cup brackets. */
export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId : ""
  const seriesNumber = Number(body?.seriesNumber)
  const homeScore = intScore(body?.homeScore)
  const awayScore = intScore(body?.awayScore)
  if (!challengeId || !Number.isInteger(seriesNumber) || seriesNumber < 1 ||
      homeScore == null || awayScore == null || homeScore === awayScore) {
    return NextResponse.json({ ok: false, error: "Challenge, game number, and unequal final scores are required." }, { status: 400 })
  }
  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { id: true, sport: true, seasonYear: true, series: {
      select: {
        id: true, seriesNumber: true, sourceSeriesHome: true, sourceSeriesAway: true,
        homeTeamName: true, awayTeamName: true, winnerTeamName: true,
        status: true, liveHomeScore: true, liveAwayScore: true,
      },
    } },
  }) as { id: string; sport: string; seasonYear: number; series: Row[] } | null
  if (!challenge || !["ncaaf", "nba_cup"].includes(challenge.sport)) {
    return NextResponse.json({ ok: false, error: "Single-game bracket pool not found." }, { status: 404 })
  }
  const field = challenge.sport === "ncaaf"
    ? await readCfpSeeds(challenge.seasonYear)
    : await readNbaCupField(challenge.seasonYear)
  if (!field) {
    return NextResponse.json({ ok: false, error: "Official tournament field has not been published." }, { status: 409 })
  }
  const byNumber = new Map(challenge.series.map((row) => [row.seriesNumber, row]))
  const game = byNumber.get(seriesNumber)
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 })

  const fromSource = (source: number | null, fallback: string): string =>
    source == null ? fallback : byNumber.get(source)?.winnerTeamName?.trim() || ""
  const home = fromSource(game.sourceSeriesHome, game.homeTeamName)
  const away = fromSource(game.sourceSeriesAway, game.awayTeamName)
  if (!isOfficialTeamName(home) || !isOfficialTeamName(away) || home === away) {
    return NextResponse.json({ ok: false, error: "Both official teams must be known before a final can be entered." }, { status: 409 })
  }
  const winner = homeScore > awayScore ? home : away
  if (game.status === "final") {
    if (game.winnerTeamName === winner && game.liveHomeScore === homeScore && game.liveAwayScore === awayScore) {
      return NextResponse.json({ ok: true, unchanged: true, winner })
    }
    return NextResponse.json({ ok: false, error: "This final is already recorded. Corrections require a separate audited review." }, { status: 409 })
  }
  const actor = resolveAdminAuditActor(gate.user)
  await (prisma as any).playoffBracketSeries.update({
    where: { id: game.id },
    data: {
      homeTeamName: home, awayTeamName: away, winnerTeamName: winner,
      status: "final", homeTeamWins: homeScore > awayScore ? 1 : 0,
      awayTeamWins: awayScore > homeScore ? 1 : 0,
      liveHomeScore: homeScore, liveAwayScore: awayScore,
      seriesSummary: `${winner} won ${homeScore}-${awayScore}`,
      liveStatus: "Final", lastSyncedAt: new Date(),
    },
  })
  await logAdminAudit({
    adminUserId: actor, action: "single_game_bracket_result.save",
    targetType: "playoff_bracket_series", targetId: game.id,
    details: {
      challengeId, sport: challenge.sport, seasonYear: challenge.seasonYear,
      seriesNumber, home, away, homeScore, awayScore, winner,
    },
  })
  return NextResponse.json({ ok: true, winner, seriesNumber })
}
