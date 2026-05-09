/**
 * POST: Submit pick from queue when timer has expired (slow draft / async).
 * Called when user is on the clock, timer is expired, and they have autopick from queue enabled.
 * Submits first available player from their queue.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import {
  DRAFT_PICK_NOT_ON_CLOCK,
  httpStatusForPickAuthorityCode,
  type PickAuthorityCode,
} from '@/lib/live-draft-engine/pickAuthorityCodes'
import { appendPickToRosterDraftSnapshot } from '@/lib/live-draft-engine/RosterAssignmentService'
import { prisma } from '@/lib/prisma'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { resolveBestAvailableAutopickCandidate } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import {
  notifyDraftIntelOnClockUrgent,
  notifyDraftIntelPickConfirmation,
  notifyDraftIntelPlayerTaken,
  notifyDraftIntelQueueReady,
  notifyDraftIntelTierBreak,
} from '@/lib/draft-notifications'
import { publishDraftIntelForUpcomingManagers, sendDraftIntelDm } from '@/lib/draft-intelligence'

type AutoPickCandidate = {
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  byeWeek: number | null
  reason: string
  strategy: 'queue-first' | 'need-based' | 'bpa' | 'ai-powered'
}

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  if (!rosterId) return NextResponse.json({ error: 'No roster for this league' }, { status: 403 })

  const draftSession = await prisma.draftSession.findUnique({
    where: { leagueId },
    include: { picks: { orderBy: { overall: 'asc' } }, queues: true },
  })
  if (!draftSession || draftSession.status !== 'in_progress') {
    return NextResponse.json({ error: 'Draft not in progress' }, { status: 400 })
  }
  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  if (!uiSettings.autoPickEnabled) {
    return NextResponse.json({ error: 'Auto-pick is disabled by the commissioner' }, { status: 400 })
  }

  const { resolveCurrentOnTheClock } = await import('@/lib/live-draft-engine/CurrentOnTheClockResolver')
  const { resolvePickOwner } = await import('@/lib/live-draft-engine/PickOwnershipResolver')
  const slotOrder = (draftSession.slotOrder as { slot: number; rosterId: string; displayName: string }[]) ?? []
  const tradedPicks = Array.isArray(draftSession.tradedPicks) ? (draftSession.tradedPicks as { round: number; originalRosterId: string; previousOwnerName: string; newRosterId: string; newOwnerName: string }[]) : []
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
  const onClockRosterId = resolvedOwner?.rosterId ?? current.rosterId
  if (rosterId !== onClockRosterId) {
    // Commit M — same structured code as the manual-pick route so
    // clients can render a consistent inline error on lockout.
    return NextResponse.json(
      { error: 'You are not on the clock', code: DRAFT_PICK_NOT_ON_CLOCK },
      { status: httpStatusForPickAuthorityCode(DRAFT_PICK_NOT_ON_CLOCK) },
    )
  }

  const queueRow = draftSession.queues.find((q) => q.userId === userId)
  const order = (queueRow?.order as Array<{ playerName: string; position: string; team?: string | null; playerId?: string | null }>) ?? []
  const draftedNames = new Set(
    draftSession.picks
      .filter((p) => !isDraftPickRowEmpty(p))
      .map((p) => p.playerName.trim().toLowerCase()),
  )
  const availableInQueue = order.filter(
    (e) => e.playerName && !draftedNames.has(e.playerName.trim().toLowerCase())
  )
  const queueHadUnavailableEntries = order.length > 0 && availableInQueue.length < order.length

  const { filterEntriesByDraftEligiblePositions } = await import('@/lib/draft-room/draft-pool-eligible-positions')
  const { getAllowedPositionsAndRosterSize } = await import('@/lib/live-draft-engine/RosterFitValidation')
  const rosterRules = await getAllowedPositionsAndRosterSize(leagueId)
  const draftEligiblePositions = rosterRules?.draftEligiblePositions
  const eligibleInQueue = filterEntriesByDraftEligiblePositions(availableInQueue, draftEligiblePositions)
  const firstAvailable = eligibleInQueue[0]

  const draftConfig = await getDraftConfigForLeague(leagueId)
  const autopickBehavior = String(draftConfig?.autopick_behavior ?? 'queue-first').toLowerCase()

  let selected: AutoPickCandidate | null =
    firstAvailable?.playerName && firstAvailable?.position
      ? {
          playerName: firstAvailable.playerName.trim(),
          position: firstAvailable.position.trim(),
          team: firstAvailable.team ?? null,
          playerId: firstAvailable.playerId ?? null,
          byeWeek: null,
          reason: 'First available player from your queue.',
          strategy: 'queue-first',
        }
      : null

  if (!selected) {
    if (autopickBehavior === 'skip') {
      if (queueHadUnavailableEntries) {
        const { notifyQueuePlayerUnavailable } = await import('@/lib/draft-notifications')
        void notifyQueuePlayerUnavailable(leagueId, rosterId)
      }
      return NextResponse.json(
        { error: 'Auto-pick behavior is configured to skip when no queue player is available.' },
        { status: 400 }
      )
    }

    // Try AI-powered pick if user has AI subscription
    try {
      const { tryAiOpponentAutopickForExpiredTimer } = await import('@/lib/ai/opponents/liveDraftAiAutopick')
      const aiResult = await tryAiOpponentAutopickForExpiredTimer(leagueId, rosterId)
      if (aiResult.ok) {
        selected = {
          playerName: aiResult.pick.playerName,
          position: aiResult.pick.position,
          team: aiResult.pick.team ?? null,
          playerId: aiResult.pick.playerId ?? null,
          byeWeek: aiResult.pick.byeWeek ?? null,
          reason: aiResult.pick.reason || 'AI-powered pick (subscription)',
          strategy: 'ai-powered',
        }
      }
    } catch (err) {
      // AI pick failed, fall through to BPA
    }

    // Fall back to BPA if AI pick wasn't used
    if (!selected) {
      const resolved = await resolveBestAvailableAutopickCandidate(leagueId, rosterId)
      if (!resolved) {
        return NextResponse.json(
          {
            error: draftEligiblePositions?.size
              ? 'No eligible fallback players available for auto-pick. Add queue players or make a manual pick.'
              : 'No fallback players available for auto-pick. Add queue players or make a manual pick.',
          },
          { status: 400 }
        )
      }
      selected = resolved
    }
  }

  if (!selected?.playerName || !selected.position) {
    return NextResponse.json(
      { error: 'Unable to resolve auto-pick candidate. Try manual pick.' },
      { status: 400 }
    )
  }

  // Commit Q — pass the resolved overall so submitPick can refuse with
  // DRAFT_PICK_STALE_OVERALL (Commit M) when another writer landed a
  // pick between this route's session read and the transactional commit.
  // The route already short-reads the same DraftSession `picks` snapshot
  // used to compute `current`, so `picks.length + 1` is the correct
  // expectedOverall for the candidate we just resolved.
  const expectedOverall = draftSession.picks.length + 1

  const result = await submitPick({
    leagueId,
    playerName: selected.playerName.trim(),
    position: selected.position.trim(),
    team: selected.team ?? null,
    playerId: selected.playerId ?? null,
    byeWeek: selected.byeWeek ?? null,
    rosterId,
    source: 'auto',
    expectedOverall,
  })

  if (!result.success) {
    // Commit M — propagate authority codes (race / stale / not-live)
    // through the autopick path with the same status mapping as the
    // manual-pick route.
    const status =
      result.code === 'ROSTER_CONFIGURATION_INCOMPLETE'
        ? 409
        : result.code
          ? httpStatusForPickAuthorityCode(result.code as PickAuthorityCode)
          : 400
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status },
    )
  }

  const { notifyAutoPickFired, notifyOnTheClockAfterPick, notifyQueuePlayerUnavailable } = await import('@/lib/draft-notifications')
  if (queueHadUnavailableEntries) {
    void notifyQueuePlayerUnavailable(leagueId, rosterId)
  }
  void notifyAutoPickFired(leagueId, rosterId, selected.playerName.trim())
  void notifyDraftIntelPickConfirmation(leagueId, rosterId, selected.playerName.trim()).catch(() => {})
  void notifyOnTheClockAfterPick(leagueId)

  try {
    const snapshot = await buildSessionSnapshot(leagueId, new Date(), userId)
    if (snapshot?.currentPick && result.snapshot) {
      await appendPickToRosterDraftSnapshot(leagueId, rosterId, {
        playerName: selected.playerName.trim(),
        position: selected.position.trim(),
        team: selected.team ?? null,
        playerId: selected.playerId ?? null,
        byeWeek: selected.byeWeek ?? null,
      }).catch(() => {})
    }
  } catch (_) {}

  const updated = await buildSessionSnapshot(leagueId, new Date(), userId)
  void (async () => {
    const states = await publishDraftIntelForUpcomingManagers({
      leagueId,
      trigger: 'pick_update',
    }).catch(() => [])
    for (const result of states) {
      const state = result.state
      await sendDraftIntelDm(state).catch(() => null)
      if (result.previousState?.queue.some((entry) => entry.playerName === selected.playerName.trim())) {
        await notifyDraftIntelPlayerTaken(leagueId, state.rosterId, selected.playerName.trim()).catch(() => null)
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
          pickLabel: updated?.currentPick?.pickLabel,
        }).catch(() => null)
      }
    }
  })()
  return NextResponse.json({
    ok: true,
    pick: result.snapshot,
    submittedPlayerName: selected.playerName.trim(),
    strategy: selected.strategy,
    explanation: selected.reason,
    session: updated,
  })
}
