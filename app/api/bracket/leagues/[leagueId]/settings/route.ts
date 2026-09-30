import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { leagueId } = params
    const body = await req.json()

    const league = await (prisma as any).bracketLeague.findUnique({
      where: { id: leagueId },
      select: { ownerId: true, scoringRules: true },
    })

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 })
    }

    const isOwner = league.ownerId === session.user.id

    let isCoCommissioner = false
    if (!isOwner) {
      const membership = await (prisma as any).bracketLeagueMember.findUnique({
        where: { leagueId_userId: { leagueId, userId: session.user.id } },
        select: { role: true },
      })
      isCoCommissioner = membership?.role === "CO_COMMISSIONER"
    }

    if (!isOwner && !isCoCommissioner) {
      return NextResponse.json({ error: "Only the commissioner or co-commissioner can update settings" }, { status: 403 })
    }

    const currentRules = (league.scoringRules || {}) as Record<string, any>

    const allowedFields = [
      "scoringMode",
      "entriesPerUserFree",
      "maxEntriesPerUser",
      "isPaidLeague",
      "allowCopyBracket",
      "pickVisibility",
      "insuranceEnabled",
      "insurancePerEntry",
      "upsetDeltaEnabled",
      "leverageBonusEnabled",
      "tiebreakerEnabled",
      "tiebreakerType",
      "roundPoints",
      "incompleteEntryPolicy",
      "bracketType",
      "challengeType",
      "sport",
    ]

    const updatedRules = { ...currentRules }
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updatedRules[field] = body[field]
      }
    }

    if (body.scoringMode) {
      updatedRules.mode = body.scoringMode
    }

    if (updatedRules.maxEntriesPerUser !== undefined) {
      updatedRules.maxEntriesPerUser = Math.min(25, Math.max(1, Number(updatedRules.maxEntriesPerUser)))
    }

    if (updatedRules.entriesPerUserFree !== undefined) {
      const maxEntries = Number(updatedRules.maxEntriesPerUser || 1)
      updatedRules.entriesPerUserFree = Math.min(maxEntries, Math.max(1, Number(updatedRules.entriesPerUserFree)))
    }

    if (updatedRules.pickVisibility !== undefined) {
      updatedRules.pickVisibility =
        updatedRules.pickVisibility === "hidden_until_lock" ? "hidden_until_lock" : "visible"
    }

    if (updatedRules.tiebreakerType !== undefined) {
      updatedRules.tiebreakerType =
        updatedRules.tiebreakerType === "championship_total_points" ? "championship_total_points" : "none"
    }

    if (updatedRules.incompleteEntryPolicy !== undefined) {
      updatedRules.incompleteEntryPolicy =
        updatedRules.incompleteEntryPolicy === "auto_favorite" ? "auto_favorite" : "invalid_incomplete"
    }

    if (updatedRules.bracketType !== undefined) {
      updatedRules.bracketType =
        updatedRules.bracketType === "mens_ncaa" ? "mens_ncaa" : "playoff_challenge"
      updatedRules.challengeType = updatedRules.bracketType
    }

    if (updatedRules.challengeType !== undefined) {
      updatedRules.challengeType =
        updatedRules.challengeType === "mens_ncaa" ? "mens_ncaa" : "playoff_challenge"
    }

    await (prisma as any).bracketLeague.update({
      where: { id: leagueId },
      data: { scoringRules: updatedRules },
    })

    return NextResponse.json({ ok: true, scoringRules: updatedRules })
  } catch (err: any) {
    console.error("PATCH /api/bracket/leagues/[leagueId]/settings error:", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
