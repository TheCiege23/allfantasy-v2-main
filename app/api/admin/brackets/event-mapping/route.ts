import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { prisma } from "@/lib/prisma"
import { readSingleGameSchedule, type SingleGameSport } from "@/lib/playoffs/singleGameSchedule"
import { readBracketEventMaps, validateBracketEventMaps, writeBracketEventMaps } from "@/lib/playoffs/bracketEventMaps"

export const dynamic = "force-dynamic"

function parseSport(raw: unknown): SingleGameSport | null {
  return raw === "ncaaf" || raw === "nba_cup" ? raw : null
}
function parseSeason(raw: unknown): number | null {
  const value = Number(raw)
  return Number.isInteger(value) && value >= 2024 && value <= 2100 ? value : null
}

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const params = new URL(request.url).searchParams
  const sport = parseSport(params.get("sport"))
  const season = parseSeason(params.get("season"))
  if (!sport || season == null) return NextResponse.json({ error: "Valid sport and season required." }, { status: 400 })
  return NextResponse.json({ ok: true, mapping: await readBracketEventMaps(sport, season) })
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const sport = parseSport(body?.sport)
  const season = parseSeason(body?.season)
  if (!sport || season == null) return NextResponse.json({ error: "Valid sport and season required." }, { status: 400 })
  const schedule = await readSingleGameSchedule(sport, season)
  if (!schedule) return NextResponse.json({ error: "Publish the complete schedule first." }, { status: 409 })
  const checked = validateBracketEventMaps(sport, body?.games)
  if (!checked.ok) return NextResponse.json({ errors: checked.errors }, { status: 400 })
  const previous = await readBracketEventMaps(sport, season)
  const oldIds = new Map(previous?.games.map((game) => [game.seriesNumber, game.eventId]) ?? [])
  const newIds = new Map(checked.games.map((game) => [game.seriesNumber, game.eventId]))
  const changed = schedule.games.map((game) => game.seriesNumber).filter((number) => oldIds.get(number) !== newIds.get(number))
  if (!changed.length) return NextResponse.json({ ok: true, unchanged: true, mapping: previous })
  const final = await (prisma as any).playoffBracketSeries.findFirst({
    where: { challenge: { sport, seasonYear: season, isTestMode: false }, seriesNumber: { in: changed }, status: "final" },
    select: { seriesNumber: true },
  }) as { seriesNumber: number } | null
  if (final) return NextResponse.json({ error: `Game ${final.seriesNumber} is final; its event ID is locked.` }, { status: 409 })
  const actor = resolveAdminAuditActor(gate.user)
  const mapping = await writeBracketEventMaps({ sport, season, games: checked.games, userId: actor })
  await logAdminAudit({
    adminUserId: actor, action: "season_bracket_event_map.save",
    targetType: "bracket_season", targetId: `${sport}:${season}`,
    details: { previous: previous?.games ?? [], games: mapping.games },
  })
  return NextResponse.json({ ok: true, mapping })
}
