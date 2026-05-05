/**
 * POST: Commissioner controls — start, pause, resume, reset_timer, undo_pick, force_autopick, complete, etc.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueActionGate } from '@/server/services/leagueActionGate'
import {
  pauseDraftSession,
  resumeDraftSession,
  resetTimer,
  undoLastPick,
  swapDraftManagers,
  completeDraftSession,
  resetDraftSession,
  buildSessionSnapshot,
  setTimerSeconds,
  startDraftSession,
} from '@/lib/live-draft-engine/DraftSessionService'
import { resolveAuctionWin } from '@/lib/live-draft-engine/auction/AuctionEngine'
import { runAuctionAutomationTick } from '@/lib/live-draft-engine/auction'
import { runKeeperAutomationTick } from '@/lib/live-draft-engine/keeper'
import { runSlowDraftAutomationTick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import { httpStatusForPickAuthorityCode, type PickAuthorityCode } from '@/lib/live-draft-engine/pickAuthorityCodes'
import { appendPickToRosterDraftSnapshot, finalizeRosterAssignments } from '@/lib/live-draft-engine/RosterAssignmentService'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { draftPoolRowMatchesEligiblePositions } from '@/lib/draft-room/draft-pool-eligible-positions'
import { getAllowedPositionsAndRosterSize } from '@/lib/live-draft-engine/RosterFitValidation'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { getLiveADP } from '@/lib/adp-data'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { prisma } from '@/lib/prisma'
import { getProviderStatus } from '@/lib/provider-config'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import {
  getLeagueMemberAppUserIds,
  notifyDraftIntelOnClockUrgent,
  notifyDraftIntelOrphanTeamPick,
  notifyDraftIntelPickConfirmation,
  notifyDraftIntelPlayerTaken,
  notifyDraftIntelPostDraftRecap,
  notifyDraftIntelQueueReady,
  notifyDraftIntelTierBreak,
  notifyDraftStartingSoon,
} from '@/lib/draft-notifications'
import {
  publishDraftIntelForUpcomingManagers,
  publishDraftIntelRecap,
  sendDraftIntelDm,
} from '@/lib/draft-intelligence'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'

export const dynamic = 'force-dynamic'

async function withViewerSession(
  leagueId: string,
  userId: string,
  snapshot: DraftSessionSnapshot | null,
): Promise<DraftSessionSnapshot | null> {
  if (!snapshot) return null
  const providerStatus = getProviderStatus()
  const [currentUserRosterId, orphanRosterIds, uiSettings] = await Promise.all([
    getCurrentUserRosterIdForLeague(leagueId, userId),
    getOrphanRosterIdsForLeague(leagueId),
    getDraftUISettingsForLeague(leagueId),
  ])
  return {
    ...snapshot,
    currentUserRosterId: currentUserRosterId ?? undefined,
    orphanRosterIds,
    aiManagerEnabled: uiSettings.orphanTeamAiManagerEnabled,
    orphanDrafterMode: uiSettings.orphanDrafterMode,
    orphanAiProviderAvailable: providerStatus.anyAi,
    orphanDrafterEffectiveMode:
      uiSettings.orphanDrafterMode === 'ai' && !providerStatus.anyAi ? 'cpu' : uiSettings.orphanDrafterMode,
  }
}

const ALLOWED_ACTIONS = [
  'start',
  'pause',
  'resume',
  'reset_timer',
  'undo_pick',
  'force_autopick',
  'complete',
  'set_timer_seconds',
  'skip_pick',
  'resolve_auction',
  'auction_tick',
  'slow_tick',
  'keeper_tick',
  'reset_draft',
  'swap_manager',
]

type AutoPickCandidate = {
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  byeWeek: number | null
}

type SubmitPickFailureCode = Awaited<ReturnType<typeof submitPick>>['code']

function httpStatusForSubmitPickFailure(code: SubmitPickFailureCode): number {
  if (!code) return 400
  if (code === 'ROSTER_CONFIGURATION_INCOMPLETE') return 409
  return httpStatusForPickAuthorityCode(code as PickAuthorityCode)
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

async function loadFallbackCandidates(leagueId: string, sport: string): Promise<Array<AutoPickCandidate & { adp: number | null }>> {
  const normalizedSport = String(sport || 'NFL').toUpperCase()
  if (normalizedSport === 'NFL') {
    const adp = await getLiveADP('redraft', 300).catch(() => [])
    return adp.map((entry) => ({
      playerName: String(entry.name ?? '').trim(),
      position: String(entry.position ?? '').trim(),
      team: entry.team ?? null,
      playerId: null,
      byeWeek: entry.bye ?? null,
      adp: entry.adp ?? null,
    }))
  }

  const pool = await getPlayerPoolForLeague(leagueId, normalizedSport as any, {
    limit: 300,
  }).catch(() => [])

  return pool.map((entry: any) => ({
    playerName: String(entry.full_name ?? entry.name ?? '').trim(),
    position: String(entry.position ?? '').trim(),
    team: entry.team_abbreviation ?? null,
    playerId: entry.external_source_id ?? entry.player_id ?? null,
    byeWeek: null,
    adp: null,
  }))
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const gate = await assertLeagueActionGate(leagueId, userId, 'draft_commissioner_control')
  if (!gate.ok) {
    return NextResponse.json({ error: gate.err.error, code: gate.err.code }, { status: gate.err.status })
  }

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action ?? '').toLowerCase()
  if (!ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Use one of: ${ALLOWED_ACTIONS.join(', ')}` },
      { status: 400 }
    )
  }
  try {
    if (action === 'start') {
      const started = await startDraftSession(leagueId)
      if (!started.ok) {
        if (started.reason === 'ROSTER_CONFIGURATION_INCOMPLETE') {
          return NextResponse.json(rosterConfigurationIncompleteBody({ leagueId }), { status: 409 })
        }
        return NextResponse.json({ error: 'Cannot start draft' }, { status: 400 })
      }
      void notifyDraftStartingSoon(leagueId)
      await runKeeperAutomationTick(leagueId).catch(() => {})
      await runSlowDraftAutomationTick(leagueId).catch(() => {})
      const snapshot = await buildSessionSnapshot(leagueId)
      if (!snapshot) return NextResponse.json({ error: 'Failed to build session' }, { status: 500 })
      void (async () => {
        const states = await publishDraftIntelForUpcomingManagers({
          leagueId,
          trigger: 'n_minus_5',
        }).catch(() => [])
        for (const result of states) {
          const state = result.state
          await sendDraftIntelDm(state).catch(() => null)
          if (state.status === 'active' && state.picksUntilUser === 5 && state.queue[0]) {
            await notifyDraftIntelQueueReady(leagueId, state.rosterId, {
              playerName: state.queue[0].playerName,
              availabilityProbability: state.queue[0].availabilityProbability,
            }).catch(() => null)
          }
          if (state.status === 'on_clock') {
            await notifyDraftIntelOnClockUrgent(leagueId, state.rosterId, {
              playerName: state.queue[0]?.playerName,
              pickLabel: snapshot.currentPick?.pickLabel,
            }).catch(() => null)
          }
        }
      })()
      const sessionSnapshot = await withViewerSession(leagueId, userId, snapshot)
      return NextResponse.json({ ok: true, action: 'start', session: sessionSnapshot })
    }

    const pauseControlAction = action === 'pause' || action === 'resume' || action === 'reset_timer'
    if (pauseControlAction) {
      const uiSettings = await getDraftUISettingsForLeague(leagueId)
      if (uiSettings.commissionerPauseControlsEnabled === false) {
        return NextResponse.json(
          {
            error: 'Commissioner pause controls are disabled in automation settings',
            code: 'COMMISSIONER_PAUSE_DISABLED',
          },
          { status: 400 }
        )
      }
    }

    if (action === 'pause') {
      const ok = await pauseDraftSession(leagueId, userId)
      if (!ok) return NextResponse.json({ error: 'Cannot pause draft' }, { status: 400 })
      const { notifyDraftPaused } = await import('@/lib/draft-notifications')
      notifyDraftPaused(leagueId).catch(() => {})
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({ ok: true, action: 'pause', session: await withViewerSession(leagueId, userId, snapshot) })
    }
    if (action === 'resume') {
      const ok = await resumeDraftSession(leagueId)
      if (!ok) return NextResponse.json({ error: 'Cannot resume draft' }, { status: 400 })
      const { notifyDraftResumed } = await import('@/lib/draft-notifications')
      notifyDraftResumed(leagueId).catch(() => {})
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({ ok: true, action: 'resume', session: await withViewerSession(leagueId, userId, snapshot) })
    }
    if (action === 'reset_timer') {
      const ok = await resetTimer(leagueId)
      if (!ok) return NextResponse.json({ error: 'Cannot reset timer' }, { status: 400 })
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({
        ok: true,
        action: 'reset_timer',
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'undo_pick') {
      // Slice 4 — required commissioner reason (1-500 chars). Stored in DraftPickAuditLog.
      const reasonRaw = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!reasonRaw) {
        return NextResponse.json(
          { error: 'reason required', code: 'UNDO_REASON_REQUIRED' },
          { status: 400 },
        )
      }
      if (reasonRaw.length > 500) {
        return NextResponse.json(
          { error: 'reason must be 500 characters or fewer', code: 'UNDO_REASON_TOO_LONG' },
          { status: 400 },
        )
      }
      const ok = await undoLastPick(leagueId, { reason: reasonRaw, actorUserId: userId })
      if (!ok) return NextResponse.json({ error: 'No pick to undo' }, { status: 400 })
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({ ok: true, action: 'undo_pick', session: await withViewerSession(leagueId, userId, snapshot) })
    }
    if (action === 'swap_manager') {
      // Slice 5 — swap two slots' managers. Affects future picks only; past DraftPick rows untouched.
      const fromSlot = Number(body.fromSlot ?? body.from_slot)
      const toSlot = Number(body.toSlot ?? body.to_slot)
      if (!Number.isInteger(fromSlot) || !Number.isInteger(toSlot)) {
        return NextResponse.json(
          { error: 'fromSlot and toSlot are required integers', code: 'SWAP_SLOT_NOT_FOUND' },
          { status: 400 },
        )
      }
      const result = await swapDraftManagers(leagueId, fromSlot, toSlot, userId)
      if (!result.ok) {
        const status =
          result.code === 'NO_SESSION'
            ? 404
            : result.code === 'INVALID_STATUS'
              ? 409
              : 400
        return NextResponse.json({ error: result.error, code: result.code }, { status })
      }
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({
        ok: true,
        action: 'swap_manager',
        fromRosterId: result.fromRosterId,
        toRosterId: result.toRosterId,
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'force_autopick') {
      const uiSettings = await getDraftUISettingsForLeague(leagueId)
      if (!uiSettings.commissionerForceAutoPickEnabled) {
        return NextResponse.json(
          {
            error: 'Commissioner force auto-pick is disabled in draft settings',
            code: 'COMMISSIONER_FORCE_AUTOPICK_DISABLED',
          },
          { status: 400 }
        )
      }
      const requestedPlayerName = String(body.playerName ?? body.player_name ?? '').trim()
      const requestedPosition = String(body.position ?? '').trim()

      const draftSession = await prisma.draftSession.findUnique({
        where: { leagueId },
        include: { picks: { orderBy: { overall: 'asc' } }, queues: true },
      })
      if (!draftSession || draftSession.status !== 'in_progress') {
        return NextResponse.json({ error: 'Draft not in progress' }, { status: 400 })
      }

      const slotOrder = (draftSession.slotOrder as { slot: number; rosterId: string; displayName: string }[]) ?? []
      const tradedPicks = Array.isArray(draftSession.tradedPicks)
        ? (draftSession.tradedPicks as {
            round: number
            originalRosterId: string
            previousOwnerName: string
            newRosterId: string
            newOwnerName: string
          }[])
        : []
      const teamCount = draftSession.teamCount
      const totalPicks = draftSession.rounds * teamCount
      const progressPicks = draftSession.picks.map((p) => ({
        overall: p.overall,
        playerName: p.playerName,
        position: p.position,
        pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
      }))
      const current = resolveCurrentOnTheClock({
        totalPicks,
        picks: progressPicks,
        teamCount,
        draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
        thirdRoundReversal: draftSession.thirdRoundReversal,
        slotOrder,
      })
      if (!current) return NextResponse.json({ error: 'No current pick' }, { status: 400 })

      const resolvedOwner = resolvePickOwner(current.round, current.slot, slotOrder, tradedPicks)
      const onClockRosterId = String(body.rosterId ?? resolvedOwner?.rosterId ?? current.rosterId ?? '').trim()
      if (!onClockRosterId) {
        return NextResponse.json({ error: 'Unable to resolve on-clock roster for force auto-pick.' }, { status: 400 })
      }

      const rosterRules = await getAllowedPositionsAndRosterSize(leagueId)
      const draftEligiblePositions = rosterRules?.draftEligiblePositions
      const draftedNames = new Set(
        draftSession.picks
          .filter((pick) => !isDraftPickRowEmpty(pick))
          .map((pick) => normalizeName(pick.playerName)),
      )
      const uniqueKey = (candidate: AutoPickCandidate) =>
        `${normalizeName(candidate.playerName)}|${String(candidate.position ?? '').trim().toUpperCase()}`
      const seenKeys = new Set<string>()
      const candidates: AutoPickCandidate[] = []
      let queueHadUnavailableEntries = false
      const pushCandidate = (candidate: AutoPickCandidate | null | undefined) => {
        if (!candidate?.playerName || !candidate.position) return
        if (draftedNames.has(normalizeName(candidate.playerName))) return
        if (
          draftEligiblePositions?.size &&
          !draftPoolRowMatchesEligiblePositions(candidate.position, draftEligiblePositions)
        ) {
          return
        }
        const key = uniqueKey(candidate)
        if (seenKeys.has(key)) return
        seenKeys.add(key)
        candidates.push(candidate)
      }

      if (requestedPlayerName && requestedPosition) {
        pushCandidate({
          playerName: requestedPlayerName,
          position: requestedPosition,
          team: body.team ?? null,
          playerId: body.playerId ?? body.player_id ?? null,
          byeWeek: body.byeWeek ?? body.bye_week ?? null,
        })
      }

      const onClockRoster = await prisma.roster.findUnique({
        where: { id: onClockRosterId },
        select: { platformUserId: true },
      })
      const queueUserId =
        onClockRoster?.platformUserId && !String(onClockRoster.platformUserId).startsWith('orphan-')
          ? String(onClockRoster.platformUserId)
          : null
      if (queueUserId) {
        const queueRow = draftSession.queues.find((q) => q.userId === queueUserId)
        const queued = Array.isArray(queueRow?.order)
          ? (queueRow.order as Array<{ playerName: string; position: string; team?: string | null; playerId?: string | null }>)
          : []
        for (const item of queued) {
          if (item?.playerName && draftedNames.has(normalizeName(String(item.playerName)))) {
            queueHadUnavailableEntries = true
            continue
          }
          pushCandidate({
            playerName: String(item.playerName ?? '').trim(),
            position: String(item.position ?? '').trim(),
            team: item.team ?? null,
            playerId: item.playerId ?? null,
            byeWeek: null,
          })
        }
      }

      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { sport: true },
      })
      const sport = String(league?.sport ?? draftSession.sportType ?? 'NFL').toUpperCase()
      const fallbackPool = await loadFallbackCandidates(leagueId, sport)
      const fallbackSorted = [...fallbackPool].sort((a, b) => {
        const adpA = a.adp ?? 999
        const adpB = b.adp ?? 999
        if (adpA !== adpB) return adpA - adpB
        return a.playerName.localeCompare(b.playerName)
      })
      for (const player of fallbackSorted) {
        pushCandidate({
          playerName: player.playerName,
          position: player.position,
          team: player.team,
          playerId: player.playerId,
          byeWeek: player.byeWeek,
        })
      }

      if (!candidates.length) {
        return NextResponse.json(
          { error: 'No eligible auto-pick candidate found for the current on-clock roster.' },
          { status: 400 }
        )
      }

      let result: Awaited<ReturnType<typeof submitPick>> | null = null
      let selectedCandidate: AutoPickCandidate | null = null
      const attempts = candidates.slice(0, 80)
      // Commit R — pass the resolved overall through to submitPick so the
      // Commit-M stale guard fires deterministically when a manager / cron
      // lands a pick between this route's session read and the commissioner
      // commit. Bail the candidate loop on a stale-overall / race-retry
      // (rather than thrashing the whole 80-candidate list against a
      // stale view) — same pattern as Commit Q's queue-first cron loop.
      const expectedOverall = draftSession.picks.length + 1
      for (const candidate of attempts) {
        const attempt = await submitPick({
          leagueId,
          playerName: candidate.playerName,
          position: candidate.position,
          team: candidate.team,
          playerId: candidate.playerId,
          byeWeek: candidate.byeWeek,
          rosterId: onClockRosterId,
          source: 'commissioner',
          expectedOverall,
        })
        if (attempt.success) {
          result = attempt
          selectedCandidate = candidate
          break
        }
        if (
          attempt.code === 'DRAFT_PICK_STALE_OVERALL' ||
          attempt.code === 'DRAFT_PICK_RACE_RETRY'
        ) {
          result = attempt
          break
        }
      }

      if (!result?.success || !selectedCandidate) {
        const status = httpStatusForSubmitPickFailure(result?.code)
        if (result?.code === 'ROSTER_CONFIGURATION_INCOMPLETE') {
          return NextResponse.json(
            rosterConfigurationIncompleteBody({
              leagueId,
              message: result?.error ?? 'Unable to auto-pick a valid player.',
            }),
            { status },
          )
        }
        return NextResponse.json(
          {
            error: result?.error ?? 'Unable to auto-pick a valid player.',
            ...(result?.code ? { code: result.code } : {}),
          },
          { status },
        )
      }
      if (result.snapshot?.rosterId) {
        void appendPickToRosterDraftSnapshot(leagueId, result.snapshot.rosterId, {
          playerName: selectedCandidate.playerName,
          position: selectedCandidate.position,
          team: selectedCandidate.team,
          playerId: selectedCandidate.playerId,
          byeWeek: selectedCandidate.byeWeek,
        }).catch(() => {})
      }
      const { notifyOnTheClockAfterPick, notifyAutoPickFired, notifyQueuePlayerUnavailable } = await import('@/lib/draft-notifications')
      if (queueHadUnavailableEntries) {
        void notifyQueuePlayerUnavailable(leagueId, onClockRosterId)
      }
      void notifyAutoPickFired(leagueId, onClockRosterId, selectedCandidate.playerName)
      void notifyDraftIntelPickConfirmation(leagueId, onClockRosterId, selectedCandidate.playerName).catch(() => {})
      void notifyDraftIntelOrphanTeamPick(leagueId, selectedCandidate.playerName).catch(() => {})
      void notifyOnTheClockAfterPick(leagueId)
      const snapshot = await buildSessionSnapshot(leagueId)
      void (async () => {
        const states = await publishDraftIntelForUpcomingManagers({
          leagueId,
          trigger: 'pick_update',
        }).catch(() => [])
        for (const result of states) {
          const state = result.state
          await sendDraftIntelDm(state).catch(() => null)
          if (result.previousState?.queue.some((entry) => entry.playerName === selectedCandidate.playerName)) {
            await notifyDraftIntelPlayerTaken(leagueId, state.rosterId, selectedCandidate.playerName).catch(() => null)
          }
          const previousTop = result.previousState?.queue.slice(0, 2).map((entry) => entry.playerName).join('|')
          const nextTop = state.queue.slice(0, 2).map((entry) => entry.playerName).join('|')
          if (previousTop && nextTop && previousTop !== nextTop) {
            await notifyDraftIntelTierBreak(
              leagueId,
              state.rosterId,
              state.queue.slice(0, 2).map((entry) => entry.playerName)
            ).catch(() => null)
          }
          if (state.status === 'active' && state.picksUntilUser === 5 && state.queue[0]) {
            await notifyDraftIntelQueueReady(leagueId, state.rosterId, {
              playerName: state.queue[0].playerName,
              availabilityProbability: state.queue[0].availabilityProbability,
            }).catch(() => null)
          }
          if (state.status === 'on_clock') {
            await notifyDraftIntelOnClockUrgent(leagueId, state.rosterId, {
              playerName: state.queue[0]?.playerName,
              pickLabel: snapshot?.currentPick?.pickLabel,
            }).catch(() => null)
          }
        }
      })()
      return NextResponse.json({
        ok: true,
        action: 'force_autopick',
        selectedPlayerName: selectedCandidate.playerName,
        selectedPosition: selectedCandidate.position,
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'complete') {
      const ok = await completeDraftSession(leagueId)
      if (!ok) return NextResponse.json({ error: 'Draft not complete or already completed' }, { status: 400 })
      await finalizeRosterAssignments(leagueId).catch(() => {})
      const snapshot = await buildSessionSnapshot(leagueId)
      void (async () => {
        const userIds = await getLeagueMemberAppUserIds(leagueId).catch(() => [])
        for (const memberUserId of userIds) {
          const state = await publishDraftIntelRecap({ leagueId, userId: memberUserId }).catch(() => null)
          if (!state?.recap) continue
          await sendDraftIntelDm(state).catch(() => null)
          await notifyDraftIntelPostDraftRecap(leagueId, state.rosterId, state.recap).catch(() => null)
        }
      })()
      return NextResponse.json({
        ok: true,
        action: 'complete',
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'set_timer_seconds') {
      // Commit R — reject obviously-bad timer values at the route layer with
      // a structured `COMMISSIONER_TIMER_OUT_OF_RANGE` code so the client can
      // render an inline validation error. The underlying
      // `setTimerSeconds` helper already clamps to [0, 86400] silently;
      // that's fine as a defense-in-depth floor but a UX-grade refusal here
      // is what stops the commissioner from accidentally setting a 0s timer
      // (which would make every pick auto-fire) or a multi-day timer (which
      // would freeze the draft).
      const TIMER_MIN_SECONDS = 5
      const TIMER_MAX_SECONDS = 86400 // 24h — same upper bound as the helper
      const rawSeconds = Number(body.seconds ?? body.timerSeconds ?? 90)
      if (!Number.isFinite(rawSeconds)) {
        return NextResponse.json(
          {
            error: 'Timer seconds must be a finite number.',
            code: 'COMMISSIONER_TIMER_INVALID',
          },
          { status: 400 },
        )
      }
      const seconds = Math.round(rawSeconds)
      if (seconds < TIMER_MIN_SECONDS || seconds > TIMER_MAX_SECONDS) {
        return NextResponse.json(
          {
            error: `Timer must be between ${TIMER_MIN_SECONDS} and ${TIMER_MAX_SECONDS} seconds.`,
            code: 'COMMISSIONER_TIMER_OUT_OF_RANGE',
          },
          { status: 400 },
        )
      }
      const resetCurrentTimer = Boolean(body.resetCurrentTimer ?? body.reset_current_timer ?? true)
      const ok = await setTimerSeconds(leagueId, seconds, { resetCurrentTimer })
      if (!ok) return NextResponse.json({ error: 'Failed to set timer' }, { status: 400 })
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({
        ok: true,
        action: 'set_timer_seconds',
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'skip_pick') {
      const draftConfig = await getDraftConfigForLeague(leagueId)
      const skipAllowed = String(draftConfig?.autopick_behavior ?? '').toLowerCase() === 'skip'
      if (!skipAllowed) {
        return NextResponse.json(
          {
            error: 'Skip pick is disabled by league auto-pick rules (set auto-pick behavior to skip).',
            code: 'COMMISSIONER_SKIP_DISABLED',
          },
          { status: 400 }
        )
      }
      // Commit R — pass expectedOverall so Commit-M race semantics apply
      // even on commissioner skip writes.
      const skipSession = await prisma.draftSession.findUnique({
        where: { leagueId },
        select: { picks: { select: { id: true } } },
      })
      const expectedOverall = (skipSession?.picks.length ?? 0) + 1
      const result = await submitPick({
        leagueId,
        playerName: '(Skipped)',
        position: 'SKIP',
        team: null,
        byeWeek: null,
        source: 'commissioner',
        expectedOverall,
      })
      if (!result.success) {
        const status = httpStatusForSubmitPickFailure(result.code)
        if (result.code === 'ROSTER_CONFIGURATION_INCOMPLETE') {
          return NextResponse.json(rosterConfigurationIncompleteBody({ leagueId, message: result.error }), {
            status,
          })
        }
        return NextResponse.json(
          { error: result.error, ...(result.code ? { code: result.code } : {}) },
          { status },
        )
      }
      const snapshot = await buildSessionSnapshot(leagueId)
      void (async () => {
        const states = await publishDraftIntelForUpcomingManagers({
          leagueId,
          trigger: 'pick_update',
        }).catch(() => [])
        for (const result of states) {
          await sendDraftIntelDm(result.state).catch(() => null)
        }
      })()
      return NextResponse.json({
        ok: true,
        action: 'skip_pick',
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'resolve_auction') {
      const result = await resolveAuctionWin(leagueId, { force: true, now: new Date() })
      if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })
      if (result.sold) {
        try {
          const { isSalaryCapLeague, getSalaryCapConfig } = await import('@/lib/salary-cap/SalaryCapLeagueConfig')
          const { assignStartupAuctionContract } = await import('@/lib/salary-cap/AuctionStartupService')
          if (await isSalaryCapLeague(leagueId)) {
            const draftSession = await prisma.draftSession.findUnique({ where: { leagueId } })
            if (draftSession) {
              const latestPick = await prisma.draftPick.findFirst({
                where: { sessionId: draftSession.id },
                orderBy: { overall: 'desc' },
                select: { id: true },
              })
              if (latestPick) {
                const config = await getSalaryCapConfig(leagueId)
                const contractYears = config?.contractMaxYears ?? 4
                const assign = await assignStartupAuctionContract(leagueId, latestPick.id, contractYears)
                if (!assign.ok) console.warn('[draft/controls] assignStartupAuctionContract:', assign.error)
              }
            }
          }
        } catch (e) {
          console.warn('[draft/controls] Salary cap assign startup contract non-fatal:', e)
        }
      }
      const snapshot = await buildSessionSnapshot(leagueId)
      if (snapshot?.status === 'completed') {
        await finalizeRosterAssignments(leagueId).catch(() => {})
        const { runSurvivorPostDraftBootstrap } = await import('@/lib/survivor/SurvivorDraftBootstrapService')
        await runSurvivorPostDraftBootstrap(leagueId).catch(() => {})
      }
      return NextResponse.json({
        ok: true,
        action: 'resolve_auction',
        sold: result.sold,
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'auction_tick') {
      const automation = await runAuctionAutomationTick(leagueId)
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({
        ok: true,
        action: 'auction_tick',
        changed: automation.changed,
        automationActions: automation.actions,
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'slow_tick') {
      const automation = await runSlowDraftAutomationTick(leagueId)
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({
        ok: true,
        action: 'slow_tick',
        changed: automation.changed,
        automationActions: automation.actions,
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'keeper_tick') {
      const automation = await runKeeperAutomationTick(leagueId)
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({
        ok: true,
        action: 'keeper_tick',
        changed: automation.changed,
        automationActions: automation.actions,
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
    if (action === 'reset_draft') {
      const ok = await resetDraftSession(leagueId)
      if (!ok) return NextResponse.json({ error: 'Cannot reset draft' }, { status: 400 })
      const snapshot = await buildSessionSnapshot(leagueId)
      return NextResponse.json({
        ok: true,
        action: 'reset_draft',
        session: await withViewerSession(leagueId, userId, snapshot),
      })
    }
  } catch (e) {
    console.error('[draft/controls POST]', e)
    return NextResponse.json({ error: (e as Error).message ?? 'Server error' }, { status: 500 })
  }

  return NextResponse.json({ error: 'Unhandled action' }, { status: 400 })
}
