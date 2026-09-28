import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { prisma } from "@/lib/prisma"
import { resetDraftSession } from "@/lib/live-draft-engine/DraftSessionService"

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const mode = body?.mode === "full" ? "full" : "soft"

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 })
  }

  const existingSettings = (league.settings as Record<string, unknown>) || {}
  const nowIso = new Date().toISOString()

  const result = await prisma.$transaction(async (tx) => {
    const [waiverClaims, waiverTransactions, waiverPickups, standingsReset] = await Promise.all([
      tx.waiverClaim.deleteMany({ where: { leagueId: params.leagueId } }),
      tx.waiverTransaction.deleteMany({ where: { leagueId: params.leagueId } }),
      tx.waiverPickup.deleteMany({ where: { leagueId: params.leagueId } }),
      tx.leagueTeam.updateMany({
        where: { leagueId: params.leagueId },
        data: {
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          currentRank: null,
          aiPowerScore: null,
          projectedWins: null,
          strengthNotes: null,
          riskNotes: null,
        },
      }),
    ])

    const extraResets =
      mode === "full"
        ? await Promise.all([
            tx.leagueChatMessage.deleteMany({ where: { leagueId: params.leagueId } }),
            tx.aiCommissionerAlert.deleteMany({ where: { leagueId: params.leagueId } }),
            tx.aiCommissionerActionLog.deleteMany({ where: { leagueId: params.leagueId } }),
          ])
        : null

    const updatedLeague = await tx.league.update({
      where: { id: params.leagueId },
      data: {
        settings: {
          ...existingSettings,
          commissionerLastResetAt: nowIso,
          commissionerLastResetBy: userId,
          commissionerLastResetMode: mode,
        },
        syncError: null,
      },
      select: { id: true },
    })

    return {
      waiverClaimsRemoved: waiverClaims.count,
      waiverTransactionsRemoved: waiverTransactions.count,
      waiverPickupsRemoved: waiverPickups.count,
      standingsRowsReset: standingsReset.count,
      chatMessagesRemoved: extraResets?.[0]?.count ?? 0,
      aiAlertsRemoved: extraResets?.[1]?.count ?? 0,
      aiActionLogsRemoved: extraResets?.[2]?.count ?? 0,
      leagueId: updatedLeague.id,
    }
  })

  const draftSessionReset = await resetDraftSession(params.leagueId, { allowCompleted: true }).catch(() => false)

  return NextResponse.json({
    ok: true,
    mode,
    draftSessionReset,
    ...result,
  })
}
