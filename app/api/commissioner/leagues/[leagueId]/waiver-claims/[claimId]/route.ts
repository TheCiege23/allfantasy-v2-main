import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getLeagueRole } from "@/lib/league/permissions"
import { mergeCommissionerOverrides } from "@/lib/waiver-wire/commissioner-claim-override"
import { logAction } from "@/server/services/auditService"

/**
 * PATCH — commissioner / co-commissioner only: merge `commissionerOverrides` on a pending waiver claim.
 * Body: { bypassInsufficientFaab?, bypassWeeklyDropLimit?, note? }
 */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ leagueId: string; claimId: string }> }
) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { leagueId, claimId } = params
  const role = await getLeagueRole(leagueId, userId)
  if (role !== "commissioner" && role !== "co_commissioner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const claim = await (prisma as any).waiverClaim.findFirst({
    where: { id: claimId, leagueId, status: "pending" },
  })
  if (!claim) return NextResponse.json({ error: "Pending claim not found" }, { status: 404 })

  const patch: Parameters<typeof mergeCommissionerOverrides>[1] = { setByUserId: userId }
  if ("bypassInsufficientFaab" in body && typeof body.bypassInsufficientFaab === "boolean") {
    patch.bypassInsufficientFaab = body.bypassInsufficientFaab
  }
  if ("bypassWeeklyDropLimit" in body && typeof body.bypassWeeklyDropLimit === "boolean") {
    patch.bypassWeeklyDropLimit = body.bypassWeeklyDropLimit
  }
  if (typeof body.note === "string") patch.note = body.note

  const merged = mergeCommissionerOverrides(claim.metadata ?? null, patch)

  const updated = await (prisma as any).waiverClaim.update({
    where: { id: claimId },
    data: { metadata: merged },
  })

  void logAction({
    leagueId,
    userId,
    actionType: "waiver_claim_commissioner_override",
    entityType: "waiver",
    entityId: claimId,
    afterState: { commissionerOverrides: (merged as any).commissionerOverrides },
  }).catch(() => {})

  return NextResponse.json({ claim: updated })
}
