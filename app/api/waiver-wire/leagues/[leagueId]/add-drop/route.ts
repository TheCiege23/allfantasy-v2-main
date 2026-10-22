import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getEffectiveLeagueWaiverSettings } from "@/lib/waiver-wire"
import { executeImmediateAddDrop } from "@/lib/waiver-wire/free-agent-service"
import {
  dailyScheduleImmediateAddRefusal,
  dailyUnlockImmediateAddRefusal,
  loadDailyTransactionPolicy,
} from "@/lib/waiver-wire/daily-schedule-gate"
import { isDailyFreeAgentUnlock } from "@/lib/waiver-wire/free-agent-unlock"
import { mapAddDropErrorCode, addDropErrorStatus, ADD_DROP_ERROR_COPY, type AddDropErrorCode } from "@/lib/waiver-wire/addDropErrors"
import { assertLeagueActionGate } from "@/server/services/leagueActionGate"
import { assertRosterTransactionsAllowed } from "@/lib/roster-legality/rosterTransactionGates"
import { logAction } from "@/server/services/auditService"
import { invalidateIntelligence } from "@/lib/dashboard/intelligence-events"
import { resolveWriteAuthorityEnvelope } from "@/lib/league/write-authority-server"
import { POST_DRAFT_ROSTER_LOCK_CODE } from "@/lib/league/postDraftRosterLock"

export const dynamic = "force-dynamic"

function errorResponse(code: AddDropErrorCode, message?: string) {
  return NextResponse.json({ ok: false, code, error: message ?? ADD_DROP_ERROR_COPY[code] }, { status: addDropErrorStatus(code) })
}

/**
 * POST — immediate free-agent add/drop for NFL/NCAAF redraft.
 *
 * Only performs an immediate move when the league allows it (FCFS or instant-free-agent). When the
 * player must be claimed through waivers, returns `WAIVER_REQUIRED` so the client routes to the
 * claim drawer instead. Single-roster only — never runs the league-wide processor, so other teams'
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

  // League + roster gates (locks, season state, legality).
  // An immediate add is a free-agent pickup, refused during the post-draft roster lock (claims are not).
  const gate = await assertLeagueActionGate(leagueId, userId, "waiver_claim_submit", { rosterMove: "free_agent_pickup" })
  if (!gate.ok) {
    if (gate.err.code === POST_DRAFT_ROSTER_LOCK_CODE) {
      return NextResponse.json(
        { ok: false, code: gate.err.code, error: gate.err.error, unlocksAt: "unlocksAt" in gate.err ? gate.err.unlocksAt ?? null : null },
        { status: gate.err.status },
      )
    }
    const code = mapAddDropErrorCode(gate.err.error ?? "", { hasDrop: Boolean(dropPlayerId) })
    return errorResponse(code === "VALIDATION_FAILED" ? "LEAGUE_NOT_ACTIVE" : code, gate.err.error)
  }
  const legality = await assertRosterTransactionsAllowed({ leagueId, rosterIds: [roster.id], userId, kind: "waiver_claim" })
  if (!legality.ok) {
    return errorResponse(mapAddDropErrorCode(legality.error ?? "", { hasDrop: Boolean(dropPlayerId) }), legality.error)
  }

  // Decide immediate-add vs waiver. A commissioner's per-day schedule (lib/waivers/dailyWaiverSchedule.ts)
  // decides when one is enabled: Locked day → refused; Free-agents day, or a "Waivers → Free agents"
  // day after its run cleared → first-come, except a player still in the after-drop waiver period;
  // any other waiver day → claim through waivers. Otherwise: FCFS or instant-free-agent leagues; or a
  // 'daily' free-agent-unlock league (the NBA/MLB/NHL default) for a player not on waivers — not in the
  // after-drop waiver period and not named by a pending claim. NFL ('after_waiver_run') is unchanged.
  const daily = await loadDailyTransactionPolicy(leagueId).catch(() => null)
  if (daily) {
    if (daily.policy.mode === "locked") return errorResponse("LEAGUE_NOT_ACTIVE", daily.policy.immediateRefusal ?? undefined)
    const refusal = await dailyScheduleImmediateAddRefusal(leagueId, daily, String(addPlayerId))
    if (refusal) return errorResponse("WAIVER_REQUIRED", refusal)
  } else {
    const settings = await getEffectiveLeagueWaiverSettings(leagueId)
    const immediateAllowed = settings.normalizedWaiverType === "fcfs" || settings.instantFaAfterClear === true
    if (!immediateAllowed) {
      if (!isDailyFreeAgentUnlock(settings.freeAgentUnlockBehavior)) {
        return errorResponse("WAIVER_REQUIRED", "This player must be claimed through waivers in this league.")
      }
      const refusal = await dailyUnlockImmediateAddRefusal(leagueId, String(addPlayerId)).catch(
        () => "This player must be claimed through waivers in this league.",
      )
      if (refusal) return errorResponse("WAIVER_REQUIRED", refusal)
    }
  }

  try {
    const result = await executeImmediateAddDrop(leagueId, roster.id, { addPlayerId: String(addPlayerId), dropPlayerId })

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
