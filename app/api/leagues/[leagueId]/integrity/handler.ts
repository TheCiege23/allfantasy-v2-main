import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { prisma } from "@/lib/prisma"
import { requireEntitlement } from "@/lib/subscription/requireEntitlement"

export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const ent = await requireEntitlement("commissioner_integrity_monitoring")
  if (ent instanceof NextResponse) return ent
  const userId = ent

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch (e) {
    const st = (e as Error & { status?: number }).status ?? 403
    return NextResponse.json({ error: "Forbidden" }, { status: st })
  }

  const settings = await prisma.leagueIntegritySettings.upsert({
    where: { leagueId },
    create: { leagueId },
    update: {},
  })

  const [openFlags, recentDismissed, totalFlags, openCollusion, openTanking] = await Promise.all([
    prisma.integrityFlag.findMany({
      where: { leagueId, status: "open" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.integrityFlag.findMany({
      where: { leagueId, status: "dismissed" },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.integrityFlag.count({ where: { leagueId } }),
    prisma.integrityFlag.count({ where: { leagueId, status: "open", flagType: "collusion" } }),
    prisma.integrityFlag.count({ where: { leagueId, status: "open", flagType: "tanking" } }),
  ])

  return NextResponse.json({
    settings,
    openFlags,
    recentDismissed,
    stats: {
      totalFlagsAllTime: totalFlags,
      openCollusion,
      openTanking,
      lastCollusionScanAt: settings.lastCollusionScanAt?.toISOString() ?? null,
      lastTankingScanAt: settings.lastTankingScanAt?.toISOString() ?? null,
    },
  })
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const ent = await requireEntitlement("commissioner_integrity_monitoring")
  if (ent instanceof NextResponse) return ent
  const userId = ent

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch (e) {
    const st = (e as Error & { status?: number }).status ?? 403
    return NextResponse.json({ error: "Forbidden" }, { status: st })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const updated = await prisma.leagueIntegritySettings.upsert({
    where: { leagueId },
    create: {
      leagueId,
      ...(typeof body.collusionSensitivity === "string" ? { collusionSensitivity: body.collusionSensitivity } : {}),
      ...(typeof body.tankingMonitorEnabled === "boolean" ? { tankingMonitorEnabled: body.tankingMonitorEnabled } : {}),
      ...(typeof body.tankingSensitivity === "string" ? { tankingSensitivity: body.tankingSensitivity } : {}),
      ...(typeof body.tankingStartWeek === "number" ? { tankingStartWeek: body.tankingStartWeek } : {}),
      ...(typeof body.tankingIllegalLineupCheck === "boolean"
        ? { tankingIllegalLineupCheck: body.tankingIllegalLineupCheck }
        : {}),
      ...(typeof body.tankingBenchPatternCheck === "boolean"
        ? { tankingBenchPatternCheck: body.tankingBenchPatternCheck }
        : {}),
      ...(typeof body.tankingWaiverPatternCheck === "boolean"
        ? { tankingWaiverPatternCheck: body.tankingWaiverPatternCheck }
        : {}),
    },
    update: {
      ...(typeof body.collusionSensitivity === "string" ? { collusionSensitivity: body.collusionSensitivity } : {}),
      ...(typeof body.tankingMonitorEnabled === "boolean" ? { tankingMonitorEnabled: body.tankingMonitorEnabled } : {}),
      ...(typeof body.tankingSensitivity === "string" ? { tankingSensitivity: body.tankingSensitivity } : {}),
      ...(body.tankingStartWeek === null ? { tankingStartWeek: null } : {}),
      ...(typeof body.tankingStartWeek === "number" ? { tankingStartWeek: body.tankingStartWeek } : {}),
      ...(typeof body.tankingIllegalLineupCheck === "boolean"
        ? { tankingIllegalLineupCheck: body.tankingIllegalLineupCheck }
        : {}),
      ...(typeof body.tankingBenchPatternCheck === "boolean"
        ? { tankingBenchPatternCheck: body.tankingBenchPatternCheck }
        : {}),
      ...(typeof body.tankingWaiverPatternCheck === "boolean"
        ? { tankingWaiverPatternCheck: body.tankingWaiverPatternCheck }
        : {}),
    },
  })

  return NextResponse.json({ settings: updated })
}
