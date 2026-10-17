import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { updateClaim, cancelClaim } from "@/lib/waiver-wire"

function claimMutationErrorCode(message: string): string {
  const m = message.toLowerCase()
  if (m.includes("claim not found")) return "CLAIM_NOT_FOUND"
  if (m.includes("insufficient faab")) return "INSUFFICIENT_FAAB"
  if (m.includes("minimum faab") || m.includes("faab bid")) return "INVALID_FAAB"
  if (m.includes("drop player not on roster") || m.includes("invalid drop") || m.includes("undroppable")) return "INVALID_DROP"
  if (m.includes("no longer available") || m.includes("unavailable")) return "PLAYER_UNAVAILABLE"
  if (m.includes("locked")) return "PLAYER_LOCKED"
  if (m.includes("unauthorized")) return "UNAUTHORIZED"
  return "VALIDATION_FAILED"
}

function claimMutationError(message: string, status: number) {
  return NextResponse.json({ error: message, code: claimMutationErrorCode(message) }, { status })
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ leagueId: string; claimId: string }> }
) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const roster = await (prisma as any).roster.findFirst({
    where: { leagueId: params.leagueId, platformUserId: userId },
  })
  if (!roster) return NextResponse.json({ error: "Roster not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  try {
    const updated = await updateClaim(params.claimId, params.leagueId, roster.id, {
      addPlayerId: body.addPlayerId,
      dropPlayerId: body.dropPlayerId,
      faabBid: body.faabBid,
      priorityOrder: body.priorityOrder,
    })
    if (!updated) return claimMutationError("Claim not found or not pending", 404)
    return NextResponse.json({ claim: updated })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update claim"
    if (message.includes("locked")) {
      return claimMutationError(message, 423)
    }
    throw e
  }
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ leagueId: string; claimId: string }> }
) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const roster = await (prisma as any).roster.findFirst({
    where: { leagueId: params.leagueId, platformUserId: userId },
  })
  if (!roster) return NextResponse.json({ error: "Roster not found" }, { status: 404 })

  try {
    const ok = await cancelClaim(params.claimId, params.leagueId, roster.id)
    if (!ok) return claimMutationError("Claim not found or not pending", 404)
    return NextResponse.json({ status: "ok" })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to cancel claim"
    if (message.includes("locked")) {
      return claimMutationError(message, 423)
    }
    throw e
  }
}
