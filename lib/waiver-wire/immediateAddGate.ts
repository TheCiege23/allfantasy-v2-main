/**
 * THE RULES AN INSTANT FREE-AGENT ADD MUST PASS, IN ONE PLACE.
 *
 * Moved verbatim from the native add/drop route (`app/api/waiver-wire/leagues/[leagueId]/add-drop`) so
 * the waiver runtime's `add_free_agent` (`/api/redraft/waiver-runtime`) applies the SAME rules rather
 * than none: the season phase (including a Classic Best Ball league's `bbFaEnabled` switch), the league
 * action gate (post-draft roster lock, league locks), roster legality (an eliminated Guilly team), the
 * per-day schedule, waivers-then-free-agents, the after-drop waiver hold (which holds a Guilly chop's
 * released players), pending claims on the player, and the daily free-agent unlock.
 *
 * Returns the refusal as data — the add/drop error code, the message, the HTTP status — so each caller
 * answers in its own response shape with the same codes and words. `assertWaiverClaimEligibility` (the
 * availability / roster-limit / lock check) is NOT here: it runs inside the league waiver lock, where
 * each add path already calls it.
 */
import { prisma } from "@/lib/prisma"
import { getEffectiveLeagueWaiverSettings } from "@/lib/waiver-wire"
import {
  dailyScheduleImmediateAddRefusal,
  dailyUnlockImmediateAddRefusal,
  loadDailyTransactionPolicy,
  PENDING_CLAIM_ON_PLAYER_MESSAGE,
} from "@/lib/waiver-wire/daily-schedule-gate"
import { isDailyFreeAgentUnlock } from "@/lib/waiver-wire/free-agent-unlock"
import { mapAddDropErrorCode, addDropErrorStatus, type AddDropErrorCode } from "@/lib/waiver-wire/addDropErrors"
import { assertLeagueActionGate } from "@/server/services/leagueActionGate"
import { assertRosterTransactionsAllowed } from "@/lib/roster-legality/rosterTransactionGates"
import { POST_DRAFT_ROSTER_LOCK_CODE } from "@/lib/league/postDraftRosterLock"
import { loadWaiverPhasePolicy } from "@/lib/waiver-wire/season-phase-gate"
import { chopPendingAddFreezeMessage, guillotineChopPendingForWaivers } from "@/lib/guillotine/chopBeforeWaivers"
import {
  DROPPED_PLAYER_ON_WAIVERS_MESSAGE,
  loadDroppedPlayerHold,
  loadDroppedPlayerHoldPolicy,
} from "@/lib/waiver-wire/dropped-player-waivers"
import { afterRunRefusalMessage, loadAfterRunFreeAgencyState } from "@/lib/waiver-wire/after-run-free-agency"

type ImmediateAddGateRefusal = {
  ok: false
  /** An add/drop error code (lib/waiver-wire/addDropErrors.ts), or the post-draft lock's own code. */
  code: AddDropErrorCode | string
  /** Undefined = the code's default copy. */
  error?: string
  status: number
  extra?: Record<string, unknown>
}

type ImmediateAddGateResult = { ok: true; firstComeAdds: boolean } | ImmediateAddGateRefusal

function refuse(code: AddDropErrorCode, error?: string, extra?: Record<string, unknown>): ImmediateAddGateRefusal {
  return { ok: false, code, error, status: addDropErrorStatus(code), ...(extra ? { extra } : {}) }
}

/** `rosterId` is the generic `Roster.id`; `userId` is the acting user (the league action gate checks them). */
export async function checkImmediateAddGate(input: {
  leagueId: string
  rosterId: string
  userId: string
  addPlayerId: string
  dropPlayerId: string | null
}): Promise<ImmediateAddGateResult> {
  const { leagueId, rosterId, userId, addPlayerId, dropPlayerId } = input

  // Season phase (lib/waiver-wire/season-phase-policy.ts): a closed offseason, rosters locked for the
  // playoffs, or a team out of the title bracket under the alive-only rule cannot add. An offseason
  // opened as first-come free agency lets the add through the lifecycle gate, as a first-come add.
  const phase = await loadWaiverPhasePolicy(leagueId, rosterId)
  if (!phase.immediateAddsAllowed) {
    return refuse("LEAGUE_NOT_ACTIVE", phase.reason ?? undefined, { phaseCode: phase.code })
  }

  // League + roster gates (locks, season state, legality).
  // An immediate add is a free-agent pickup, refused during the post-draft roster lock (claims are not).
  const gate = await assertLeagueActionGate(leagueId, userId, "waiver_claim_submit", {
    rosterMove: "free_agent_pickup",
    ...(phase.firstComeAdds ? { offseasonFreeAgency: true } : {}),
  })
  if (!gate.ok) {
    if (gate.err.code === POST_DRAFT_ROSTER_LOCK_CODE) {
      return {
        ok: false,
        code: gate.err.code,
        error: gate.err.error,
        status: gate.err.status,
        extra: { unlocksAt: "unlocksAt" in gate.err ? gate.err.unlocksAt ?? null : null },
      }
    }
    const code = mapAddDropErrorCode(gate.err.error ?? "", { hasDrop: Boolean(dropPlayerId) })
    return refuse(code === "VALIDATION_FAILED" ? "LEAGUE_NOT_ACTIVE" : code, gate.err.error)
  }
  const legality = await assertRosterTransactionsAllowed({ leagueId, rosterIds: [rosterId], userId, kind: "waiver_claim" })
  if (!legality.ok) {
    return refuse(mapAddDropErrorCode(legality.error ?? "", { hasDrop: Boolean(dropPlayerId) }), legality.error)
  }

  // Guilly: once a week's scoring is done and its chop has not landed, nobody adds a free agent — the
  // team about to be chopped cannot be named until the chop runs (stat corrections, tiebreaks), so the
  // freeze covers every team (owner's call, 2026-11-07). Waiver claims are still accepted and settle on
  // the first run after the chop (lib/guillotine/chopBeforeWaivers.ts holds that run). Same verdict the
  // waiver run uses, so the two can never disagree about whether a chop is pending.
  const chop = await guillotineChopPendingForWaivers(leagueId)
  if (chop.hold) {
    return refuse("ROSTER_LOCKED", chopPendingAddFreezeMessage(chop.week), { chopPendingWeek: chop.week })
  }

  // Decide immediate-add vs waiver. A commissioner's per-day schedule (lib/waivers/dailyWaiverSchedule.ts)
  // decides when one is enabled: Locked day → refused; Free-agents day, or a "Waivers → Free agents"
  // day after its run cleared → first-come, except a player still in the after-drop waiver period;
  // any other waiver day → claim through waivers. Otherwise: FCFS or instant-free-agent leagues; or a
  // 'daily' free-agent-unlock league (the NBA/MLB/NHL default) for a player not on waivers — not in the
  // after-drop waiver period and not named by a pending claim. NFL ('after_waiver_run') is unchanged.
  //
  // A player dropped inside the league's waiver period is on waivers whatever the path, so an
  // instant-free-agent league checks him too (lib/waiver-wire/dropped-player-waivers.ts); FCFS has no
  // waiver period. An offseason opened as first-come free agency skips all of this.
  const daily = phase.firstComeAdds ? null : await loadDailyTransactionPolicy(leagueId).catch(() => null)
  if (phase.firstComeAdds) {
    // First come, first served: no waiver type and no waiver period apply.
  } else if (daily) {
    if (daily.policy.mode === "locked") return refuse("LEAGUE_NOT_ACTIVE", daily.policy.immediateRefusal ?? undefined)
    const refusal = await dailyScheduleImmediateAddRefusal(leagueId, daily, addPlayerId)
    if (refusal) return refuse("WAIVER_REQUIRED", refusal)
  } else {
    const settings = await getEffectiveLeagueWaiverSettings(leagueId)
    // Sleeper-style "Waivers, then free agents" (lib/waiver-wire/after-run-free-agency.ts): the player
    // is an instant add only after a run has cleared and before his game starts; the hold and the
    // pending-claim checks below still apply. FCFS has no run to clear, so the mode changes nothing there.
    const afterRun = settings.freeAgencyMode === "after_run" && settings.normalizedWaiverType !== "fcfs"
    if (afterRun) {
      const state = await loadAfterRunFreeAgencyState(leagueId, addPlayerId, {
        processingDayOfWeek: settings.processingDayOfWeek,
        processingTimeUtc: settings.processingTimeUtc,
        processingDays: settings.processingDays,
      }).catch(() => "unknown" as const)
      if (state === "unknown") return refuse("WAIVER_REQUIRED", "This player must be claimed through waivers in this league.")
      const refusal = afterRunRefusalMessage(state)
      if (refusal) return refuse("WAIVER_REQUIRED", refusal, { freeAgencyReason: state.onWaivers ? state.reason : null })
    }
    const immediateAllowed = settings.normalizedWaiverType === "fcfs" || settings.instantFaAfterClear === true || afterRun
    if (immediateAllowed && settings.normalizedWaiverType !== "fcfs") {
      // Fails CLOSED like the daily path: an unreadable hold means a claim, never a free add.
      const hold = await loadDroppedPlayerHoldPolicy(leagueId, settings)
        .then((policy) => loadDroppedPlayerHold(leagueId, addPlayerId, policy))
        .catch(() => "unknown" as const)
      if (hold === "unknown") return refuse("WAIVER_REQUIRED", "This player must be claimed through waivers in this league.")
      if (hold) {
        return refuse("WAIVER_REQUIRED", DROPPED_PLAYER_ON_WAIVERS_MESSAGE, { onWaiversUntil: hold.until.toISOString() })
      }
      // Claims placed while he was on waivers run at the first waiver run after he clears; until that
      // run he is theirs to compete for, not a first-come add. Fails closed like the hold.
      const pending = await prisma.waiverClaim
        .findFirst({ where: { leagueId, addPlayerId: addPlayerId, status: "pending" }, select: { id: true } })
        .catch(() => "unknown" as const)
      if (pending === "unknown") return refuse("WAIVER_REQUIRED", "This player must be claimed through waivers in this league.")
      if (pending) return refuse("WAIVER_REQUIRED", PENDING_CLAIM_ON_PLAYER_MESSAGE)
    }
    if (!immediateAllowed) {
      if (!isDailyFreeAgentUnlock(settings.freeAgentUnlockBehavior)) {
        return refuse("WAIVER_REQUIRED", "This player must be claimed through waivers in this league.")
      }
      const refusal = await dailyUnlockImmediateAddRefusal(leagueId, addPlayerId).catch(
        () => "This player must be claimed through waivers in this league.",
      )
      if (refusal) return refuse("WAIVER_REQUIRED", refusal)
    }
  }

  return { ok: true, firstComeAdds: phase.firstComeAdds === true }
}
