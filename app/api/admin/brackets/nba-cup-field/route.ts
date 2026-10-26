import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { prisma } from "@/lib/prisma"
import { cfpSeedCorrections } from "@/lib/playoffs/cfpSeeds"
import { applyCfpSeedCorrections } from "@/lib/playoffs/cfpSeedAdmin"
import { readNbaCupField, validateNbaCupField, writeNbaCupField } from "@/lib/playoffs/nbaCupSeeds"
import { applyPlayoffSeedsToChallenges } from "@/lib/playoffs/playoffSeeding"

export const dynamic = "force-dynamic"

function seasonFrom(value: unknown): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n >= 2024 && n <= 2100 ? n : null
}

/** An admin publishes the eight qualified knockout teams in conference seed order. */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const season = seasonFrom(new URL(request.url).searchParams.get("season"))
  if (season == null) return NextResponse.json({ ok: false, error: "Valid season required" }, { status: 400 })
  const [field, pools] = await Promise.all([
    readNbaCupField(season),
    (prisma as any).playoffBracketChallenge.count({ where: { sport: "nba_cup", seasonYear: season } }) as Promise<number>,
  ])
  return NextResponse.json({ ok: true, season, field, pools })
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const season = seasonFrom(body?.season)
  if (season == null) return NextResponse.json({ ok: false, error: "Valid season required" }, { status: 400 })
  const checked = validateNbaCupField(body)
  if (!checked.ok) return NextResponse.json({ ok: false, errors: checked.errors }, { status: 400 })

  const previous = await readNbaCupField(season)
  const before = previous ? [...previous.east, ...previous.west] : null
  const after = [...checked.east, ...checked.west]
  const corrections = cfpSeedCorrections(before, after)
  const pools = await (prisma as any).playoffBracketChallenge.findMany({
    where: { sport: "nba_cup", seasonYear: season }, select: { id: true },
  }) as Array<{ id: string }>
  const poolIds = pools.map((pool) => pool.id)
  if (corrections.length && poolIds.length) {
    const started = await (prisma as any).playoffBracketSeries.count({
      where: { challengeId: { in: poolIds }, status: { in: ["in_progress", "final"] } },
    })
    if (started > 0) {
      return NextResponse.json({ ok: false, error: "Knockout games have started; field corrections require audited support review." }, { status: 409 })
    }
  }

  const actor = resolveAdminAuditActor(gate.user)
  const field = await writeNbaCupField({ season, east: checked.east, west: checked.west, userId: actor })
  const corrected = corrections.length && poolIds.length
    ? await applyCfpSeedCorrections(poolIds, corrections)
    : { slotsRenamed: 0, picksRenamed: 0 }
  const sweep = await applyPlayoffSeedsToChallenges(poolIds)
  await logAdminAudit({
    adminUserId: actor, action: "nba_cup_field.save",
    targetType: "nba_cup_season", targetId: String(season),
    details: { previous: before, next: after, corrections, corrected, sweep, pools: poolIds.length },
  })
  return NextResponse.json({ ok: true, season, field, pools: poolIds.length, corrections, corrected, sweep })
}
