import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { getLeagueRole } from "@/lib/league/permissions"
import { prisma } from "@/lib/prisma"
import { requireEntitlement } from "@/lib/subscription/requireEntitlement"
import { buildIntegrityCoverage } from "@/lib/integrity/coverage"
import { resolveWriteAuthority } from "@/lib/league/write-authority"
import { readTradeAlertsEnabled, TRADE_ALERTS_KEY } from "@/lib/integrity/tradeAlerts"
import { HOLD_FLAGGED_TRADES_KEY, parseHoldFlaggedTradesMode, readHoldFlaggedTradesMode } from "@/lib/integrity/holdFlaggedTrades"
import { parseTankingPenaltyPolicyPatch, readTankingPenaltyPolicy, TANKING_PENALTIES_KEY } from "@/lib/integrity/tankingPenalties"

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
      holdFlaggedTrades: readHoldFlaggedTradesMode(league.settings) !== "off",
      holdFlaggedTradesMode: readHoldFlaggedTradesMode(league.settings),
      // Holding needs the trade to execute in AllFantasy; an imported league's trades go through on its host.
      holdFlaggedTradesSupported: resolveWriteAuthority(league.platform) === "NATIVE",
      // Penalties take an AllFantasy draft pick; an imported league's picks live on its host, so the
      // control is not offered there (lib/integrity/tankingPenaltyService.ts refuses it too).
      ...(resolveWriteAuthority(league.platform) === "NATIVE" ? { tankingPenalties: readTankingPenaltyPolicy(league.settings) } : {}),
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

  // Suspicious-trade alerts and "hold flagged trades": League.settings keys, merged inside a row lock
  // like other settings writes (lib/integrity/tradeAlerts.ts, lib/integrity/holdFlaggedTrades.ts).
  const settingsPatch: Record<string, unknown> = {}
  // Anti-tanking penalties (lib/integrity/tankingPenalties.ts): a partial edit, merged onto the current policy.
  let penaltyPatch: ReturnType<typeof parseTankingPenaltyPolicyPatch> = null
  if (body.tankingPenalties !== undefined) {
    penaltyPatch = parseTankingPenaltyPolicyPatch(body.tankingPenalties)
    if (!penaltyPatch) return NextResponse.json({ error: "tankingPenalties: enabled (true/false), penalty (forfeit_pick, lottery_odds, faab), pickAtStrike and pickRound (1-10), lotteryOddsCutPct (25, 50, 75, 100), faabPercent (10, 25, 50, 100)" }, { status: 400 })
  }
  if (typeof body.tradeAlertsEnabled === "boolean") settingsPatch[TRADE_ALERTS_KEY] = body.tradeAlertsEnabled
  // "Hold flagged trades": `off` / `severe` (the default) / `all`; the older on/off switch still works.
  const holdInput = body.holdFlaggedTradesMode !== undefined ? body.holdFlaggedTradesMode : body.holdFlaggedTrades
  if (holdInput !== undefined) {
    const mode = parseHoldFlaggedTradesMode(holdInput)
    if (!mode) return NextResponse.json({ error: "holdFlaggedTradesMode: off, severe or all" }, { status: 400 })
    settingsPatch[HOLD_FLAGGED_TRADES_KEY] = mode
  }
  // Validated above, before anything is written, so a refused request changes nothing.

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

  let leagueSettings: unknown
  if (Object.keys(settingsPatch).length > 0 || penaltyPatch) {
    leagueSettings = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
      const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
      const current = (row?.settings as Record<string, unknown> | null) ?? {}
      const next = {
        ...current,
        ...settingsPatch,
        ...(penaltyPatch ? { [TANKING_PENALTIES_KEY]: { ...readTankingPenaltyPolicy(current), ...penaltyPatch } } : {}),
      }
      await tx.league.update({ where: { id: leagueId }, data: { settings: next as Prisma.InputJsonValue } })
      return next
    })
  } else {
    leagueSettings = (await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }))?.settings
  }

  const platform = (await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } }))?.platform ?? null

  return NextResponse.json({
    settings: {
      ...updated,
      tradeAlertsEnabled: readTradeAlertsEnabled(leagueSettings),
      holdFlaggedTrades: readHoldFlaggedTradesMode(leagueSettings) !== "off",
      holdFlaggedTradesMode: readHoldFlaggedTradesMode(leagueSettings),
      holdFlaggedTradesSupported: resolveWriteAuthority(platform) === "NATIVE",
      ...(resolveWriteAuthority(platform) === "NATIVE" ? { tankingPenalties: readTankingPenaltyPolicy(leagueSettings) } : {}),
    },
  })
}
