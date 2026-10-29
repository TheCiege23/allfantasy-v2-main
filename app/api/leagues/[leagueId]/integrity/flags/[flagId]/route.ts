import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { prisma } from "@/lib/prisma"
import { requireEntitlement } from "@/lib/subscription/requireEntitlement"

export const dynamic = "force-dynamic"

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; flagId: string }> }
) {
  const ent = await requireEntitlement("commissioner_integrity_monitoring")
  if (ent instanceof NextResponse) return ent
  const userId = ent

  const { leagueId, flagId } = await ctx.params
  if (!leagueId || !flagId) return NextResponse.json({ error: "Missing params" }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch (e) {
    const st = (e as Error & { status?: number }).status ?? 403
    return NextResponse.json({ error: "Forbidden" }, { status: st })
  }

  let body: { status?: string; commissionerNote?: string }
  try {
    body = (await req.json()) as { status?: string; commissionerNote?: string }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const status = body.status === "dismissed" || body.status === "escalated" ? body.status : null
  if (!status) return NextResponse.json({ error: "status must be dismissed or escalated" }, { status: 400 })

  const before = await prisma.integrityFlag.findFirst({ where: { id: flagId, leagueId }, select: { status: true, flagType: true } })

  const row = await prisma.integrityFlag.updateMany({
    where: { id: flagId, leagueId },
    data: {
      status,
      commissionerNote:
        typeof body.commissionerNote === "string" ? body.commissionerNote : undefined,
      commissionerUserId: userId,
      reviewedAt: new Date(),
    },
  })

  if (row.count === 0) {
    return NextResponse.json({ error: "Flag not found" }, { status: 404 })
  }

  // Anti-tanking penalties: CONFIRMING a tanking flag is a strike — a warning, then at the league's
  // threshold a lost draft pick (lib/integrity/tankingPenaltyService.ts). Only on the change to
  // escalated, so re-saving an escalated flag never takes a second pick.
  let penalties: unknown = undefined
  if (status === "escalated" && before?.flagType === "tanking" && before.status !== "escalated") {
    const { onTankingFlagConfirmed } = await import("@/lib/integrity/tankingPenaltyService")
    penalties = await onTankingFlagConfirmed(flagId, userId).catch((err) => {
      console.error("[integrity/flags] tanking penalty failed", err)
      return { error: "The flag was confirmed, but the penalty could not be applied. Try again from the league log." }
    })
  }

  const updated = await prisma.integrityFlag.findFirst({ where: { id: flagId, leagueId } })
  return NextResponse.json({ flag: updated, ...(penalties !== undefined ? { penalties } : {}) })
}
