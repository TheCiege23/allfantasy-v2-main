import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { getLeagueRole } from "@/lib/league/permissions"
import { prisma } from "@/lib/prisma"
import { requireEntitlement } from "@/lib/subscription/requireEntitlement"
import { buildIntegrityCoverage } from "@/lib/integrity/coverage"
import { readTradeAlertsEnabled, TRADE_ALERTS_KEY } from "@/lib/integrity/tradeAlerts"
import { HOLD_FLAGGED_TRADES_KEY, readHoldFlaggedTrades } from "@/lib/integrity/holdFlaggedTrades"

export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const ent = await requireEntitlement("commissioner_integrity_monitoring")
  if (ent instanceof NextResponse) return ent
  const userId = ent

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })

  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, platform: true, settings: true } })
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })

  const settings = await prisma.leagueIntegritySettings.upsert({
    where: { leagueId },
    create: { leagueId },
    update: {},
  })

  const [openFlags, recentDismissed, totalFlags, openCollusion, openTanking, nativeSeason] = await Promise.all([
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
    prisma.redraftSeason.findFirst({ where: { leagueId }, select: { id: true } }),
  ])

  const coverage = buildIntegrityCoverage({
    platform: league.platform,
    hasNativeRedraftSeason: Boolean(nativeSeason),
    tankingEnabled: settings.tankingMonitorEnabled,
    lastCollusionScanAt: settings.lastCollusionScanAt,
    lastTankingScanAt: settings.lastTankingScanAt,
  })

  return NextResponse.json({
    // `tradeAlertsEnabled` lives in League.settings (lib/integrity/tradeAlerts.ts), shown beside these.
    settings: {
      ...settings,
      tradeAlertsEnabled: readTradeAlertsEnabled(league.settings),
      holdFlaggedTrades: readHoldFlaggedTrades(league.settings),
    },
    openFlags,
    recentDismissed,
    canReview: league.userId === userId,
    coverage,
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

  // Suspicious-trade alerts and "hold flagged trades": League.settings keys, merged inside a row lock
  // like other settings writes (lib/integrity/tradeAlerts.ts, lib/integrity/holdFlaggedTrades.ts).
  const settingsPatch: Record<string, boolean> = {}
  if (typeof body.tradeAlertsEnabled === "boolean") settingsPatch[TRADE_ALERTS_KEY] = body.tradeAlertsEnabled
  if (typeof body.holdFlaggedTrades === "boolean") settingsPatch[HOLD_FLAGGED_TRADES_KEY] = body.holdFlaggedTrades
  let leagueSettings: unknown
  if (Object.keys(settingsPatch).length > 0) {
    leagueSettings = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
      const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
      const next = { ...((row?.settings as Record<string, unknown> | null) ?? {}), ...settingsPatch }
      await tx.league.update({ where: { id: leagueId }, data: { settings: next as Prisma.InputJsonValue } })
      return next
    })
  } else {
    leagueSettings = (await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }))?.settings
  }

  return NextResponse.json({
    settings: {
      ...updated,
      tradeAlertsEnabled: readTradeAlertsEnabled(leagueSettings),
      holdFlaggedTrades: readHoldFlaggedTrades(leagueSettings),
    },
  })
}
