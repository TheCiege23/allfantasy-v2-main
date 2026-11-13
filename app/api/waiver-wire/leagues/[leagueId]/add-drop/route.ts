import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { executeImmediateAddDrop } from "@/lib/waiver-wire/free-agent-service"
import { checkImmediateAddGate } from "@/lib/waiver-wire/immediateAddGate"
import { mapAddDropErrorCode, addDropErrorStatus, ADD_DROP_ERROR_COPY, type AddDropErrorCode } from "@/lib/waiver-wire/addDropErrors"
import { logAction } from "@/server/services/auditService"
import { invalidateIntelligence } from "@/lib/dashboard/intelligence-events"
import { resolveWriteAuthorityEnvelope } from "@/lib/league/write-authority-server"
import { LINEUP_WARNING_CODE, lineupWarningConfirmed, loadLineupFillWarning } from "@/lib/waiver-wire/lineup-fill-warning"

export const dynamic = "force-dynamic"

function errorResponse(code: AddDropErrorCode, message?: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, code, error: message ?? ADD_DROP_ERROR_COPY[code], ...(extra ?? {}) },
    { status: addDropErrorStatus(code) },
  )
}

/**
 * POST — immediate free-agent add/drop for NFL/NCAAF redraft.
 *
 * Only performs an immediate move when the league allows it (FCFS or instant-free-agent, a daily
 * free-agent unlock, or an offseason opened as first-come free agency). When the
 * player must be claimed through waivers, returns `WAIVER_REQUIRED` so the client routes to the
 * claim drawer instead. A drop that would leave a starting slot unfillable answers `LINEUP_WARNING`
 * once; the screen asks the manager, and a retry with `confirmLineupWarning: true` goes through.
 * Single-roster only — never runs the league-wide processor, so other teams'
 * pending claims are untouched and never exposed.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return errorResponse("UNAUTHORIZED")

  const leagueId = params.leagueId
  let roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } })
  if (!roster) {
    const coOwnerRosterId = await acceptedCoOwnerRosterId(leagueId, userId)
    if (coOwnerRosterId) roster = await prisma.roster.findFirst({ where: { leagueId, id: coOwnerRosterId }, select: { id: true } })
  }
  if (!roster) {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { leagueVariant: true } })
    if (league?.leagueVariant === 'survivor_guillotine') {
      const team = await prisma.leagueTeam.findFirst({ where: { leagueId, claimedByUserId: userId }, select: { externalId: true } })
      if (team) roster = await prisma.roster.findFirst({ where: { leagueId, id: team.externalId }, select: { id: true } })
    }
  }
  if (!roster) return errorResponse("UNAUTHORIZED", "You do not have a roster in this league.")

  const body = await req.json().catch(() => ({}))
  const addPlayerId = body.addPlayerId ?? body.add_player_id
  const dropPlayerId = body.dropPlayerId ?? body.drop_player_id ?? null
  if (!addPlayerId) return errorResponse("VALIDATION_FAILED", "addPlayerId is required.")

  // Every rule an instant add must pass (season phase incl. bbFaEnabled, league + roster gates, the
  // waiver-vs-free-agent decision and the after-drop hold) lives in lib/waiver-wire/immediateAddGate.ts,
  // shared with the waiver runtime's add_free_agent.
  const gate = await checkImmediateAddGate({ leagueId, rosterId: roster.id, userId, addPlayerId: String(addPlayerId), dropPlayerId })
  if (!gate.ok) {
    return NextResponse.json({ ok: false, code: gate.code, error: gate.error ?? (ADD_DROP_ERROR_COPY as Record<string, string>)[gate.code], ...(gate.extra ?? {}) }, { status: gate.status })
  }
  const phase = { firstComeAdds: gate.firstComeAdds }

  // A drop that leaves a starting slot unfillable is the manager's call, but they confirm it first.
  if (dropPlayerId && !lineupWarningConfirmed(body)) {
    const warning = await loadLineupFillWarning({ leagueId, rosterId: roster.id, addPlayerId: String(addPlayerId), dropPlayerId })
    if (warning) {
      return NextResponse.json({ ok: false, code: LINEUP_WARNING_CODE, error: warning.message, warning }, { status: 409 })
    }
  }

  try {
    const result = await executeImmediateAddDrop(
      leagueId,
      roster.id,
      { addPlayerId: String(addPlayerId), dropPlayerId },
      ...(phase.firstComeAdds ? [{ offseasonFreeAgency: true }] : []),
    )

    void logAction({
      leagueId,
      userId,
      actionType: "waiver_add_drop",
      entityType: "waiver",
      entityId: result.transaction.id,
      afterState: { addPlayerId: String(addPlayerId), dropPlayerId, rosterId: roster.id },
    }).catch(() => {})
    invalidateIntelligence({ leagueId, reason: "waiver_add_drop" })

    // On an imported (SHADOW) league this move changed the AllFantasy twin only — the real
    // roster on ESPN/Yahoo/Sleeper is untouched until the manager makes the move there.
    const writeAuthority = await resolveWriteAuthorityEnvelope(leagueId, "waiver_add_drop")
    return NextResponse.json({ ...result, writeAuthority })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Add/drop failed"
    const code = mapAddDropErrorCode(message, { hasDrop: Boolean(dropPlayerId) })
    return errorResponse(code, message)
  }
}
