import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { prisma } from "@/lib/prisma"
import {
  readSingleGameSchedule, validateSingleGameSchedule, writeSingleGameSchedule,
  type SingleGameSport,
} from "@/lib/playoffs/singleGameSchedule"

export const dynamic = "force-dynamic"

function parseSport(raw: unknown): SingleGameSport | null {
  return raw === "ncaaf" || raw === "nba_cup" ? raw : null
}
function parseSeason(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 2024 && n <= 2100 ? n : null
}

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const params = new URL(request.url).searchParams
  const sport = parseSport(params.get("sport"))
  const season = parseSeason(params.get("season"))
  if (!sport || season == null) return NextResponse.json({ ok: false, error: "Valid sport and season required." }, { status: 400 })
  return NextResponse.json({ ok: true, schedule: await readSingleGameSchedule(sport, season) })
}

/** One season schedule supplies the server-side pick locks in every matching pool. */
export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const sport = parseSport(body?.sport)
  const season = parseSeason(body?.season)
  if (!sport || season == null) return NextResponse.json({ ok: false, error: "Valid sport and season required." }, { status: 400 })
  const checked = validateSingleGameSchedule(sport, body?.games)
  if (!checked.ok) return NextResponse.json({ ok: false, errors: checked.errors }, { status: 400 })
  const previous = await readSingleGameSchedule(sport, season)
  if (previous && JSON.stringify(previous.games) === JSON.stringify(checked.games)) {
    return NextResponse.json({ ok: true, unchanged: true, schedule: previous })
  }
  const now = Date.now()
  if (checked.games.some((game) => new Date(game.startsAt).getTime() <= now)) {
    return NextResponse.json({ ok: false, error: "All published start times must still be in the future." }, { status: 409 })
  }
  const challenges = await (prisma as any).playoffBracketChallenge.findMany({
    where: { sport, seasonYear: season }, select: { id: true },
  }) as Array<{ id: string }>
  const ids = challenges.map((challenge) => challenge.id)
  if (ids.length) {
    const started = await (prisma as any).playoffBracketSeries.count({
      where: {
        challengeId: { in: ids },
        OR: [{ status: { in: ["in_progress", "final"] } }, { startsAt: { lte: new Date() } }],
      },
    })
    if (started) return NextResponse.json({ ok: false, error: "At least one game has started; this schedule cannot be replaced." }, { status: 409 })
  }
  const actor = resolveAdminAuditActor(gate.user)
  const schedule = await writeSingleGameSchedule({ sport, season, games: checked.games, userId: actor })
  let rowsUpdated = 0
  for (const game of checked.games) {
    const result = await (prisma as any).playoffBracketSeries.updateMany({
      where: { challengeId: { in: ids }, seriesNumber: game.seriesNumber },
      data: { startsAt: new Date(game.startsAt) },
    })
    rowsUpdated += result.count ?? 0
  }
  await logAdminAudit({
    adminUserId: actor, action: "single_game_bracket_schedule.save",
    targetType: "bracket_season", targetId: `${sport}:${season}`,
    details: { previous: previous?.games ?? null, games: checked.games, pools: ids.length, rowsUpdated },
  })
  return NextResponse.json({ ok: true, schedule, pools: ids.length, rowsUpdated })
}
