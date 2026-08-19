/**
 * POST: Submit a pick. Validates duplicate, slot, then persists. Realtime: client should re-GET session after.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withTimedRoute } from '@/lib/logging/withTimedRoute'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, canSubmitPickForRoster, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import {
  DRAFT_PICK_NOT_ON_CLOCK,
  httpStatusForPickAuthorityCode,
  type PickAuthorityCode,
} from '@/lib/live-draft-engine/pickAuthorityCodes'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { appendPickToRosterDraftSnapshot } from '@/lib/live-draft-engine/RosterAssignmentService'
import {
  notifyDraftIntelOnClockUrgent,
  notifyDraftIntelPickConfirmation,
  notifyDraftIntelPlayerTaken,
  notifyDraftIntelQueueReady,
  notifyDraftIntelTierBreak,
  notifyOnTheClockAfterPick,
} from '@/lib/draft-notifications'
import { publishDraftIntelForUpcomingManagers, sendDraftIntelDm } from '@/lib/draft-intelligence'
import { assertLeagueActionGate } from '@/server/services/leagueActionGate'
import { ensureDraftingLifecycleForActiveSession } from '@/server/services/leagueLifecycleService'
import { logAction } from '@/server/services/auditService'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedDraftIntegrationService } from '@/lib/fantasy-os/sports-runtime/draftIntegration'
import { prisma } from '@/lib/prisma'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'

export const dynamic = 'force-dynamic'

type DraftPickSportsDecision = { featureGateEnabled: boolean; finalDecision: 'allowed'; reason: string; freshnessStatus: string; identityStatus: string; scheduleSnapshotVersion: string | null; evaluatedAt: string }

/**
 * Gated, evidence-only certified sports context for a draft pick. Certified facts are NOT Draft legality — this
 * NEVER blocks and NEVER touches idempotency/duplicate/ownership/clock authority (all owned by submitPick). Off
 * by default; wrapped so it can never fail the pick. Returns undefined when the gate is off or on any error.
 */
async function draftPickSportsEvidence(leagueId: string, playerId: unknown, playerName: string): Promise<DraftPickSportsDecision | undefined> {
  if (!isSportsDataEnabled('draft')) return undefined
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
    if (!league || String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') return undefined
    const rawId = typeof playerId === 'string' && playerId.trim() ? playerId.trim() : playerName
    const ref = { canonicalPlayerId: rawId, providerSleeperId: /^\d+$/.test(rawId) ? rawId : null }
    const guard = await new CertifiedDraftIntegrationService().evaluateDraftPickSafety({
      season: String(league.season ?? new Date().getFullYear()),
      week: String(weekFromLeagueSettingsForLineup(league.settings)),
      player: ref,
    })
    return { featureGateEnabled: true, finalDecision: 'allowed', reason: guard.reason, freshnessStatus: guard.freshnessStatus, identityStatus: guard.identityStatus, scheduleSnapshotVersion: guard.snapshotVersion, evaluatedAt: new Date().toISOString() }
  } catch {
    return undefined
  }
}

export const POST = withTimedRoute('draft_pick', async (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const playerName = body.playerName ?? body.player_name
  const position = body.position ?? ''
  const rosterId = body.rosterId ?? body.roster_id ?? null
  if (!String(playerName ?? '').trim() || !position) {
    console.info('[draft-pick-debug] pick route rejected: missing payload', {
      playerNamePresent: Boolean(String(playerName ?? '').trim()),
      positionPresent: Boolean(position),
      rosterId,
    })
    return NextResponse.json(
      { error: 'playerName and position required', code: 'DRAFT_PICK_INVALID_PAYLOAD' },
      { status: 400 },
    )
  }
  console.info('[draft-pick-debug] pick route received', {
    playerNamePresent: true,
    playerIdPresent: Boolean(body.playerId ?? body.player_id),
    source: String(body.source ?? 'user'),
    rosterId,
  })

  const preSubmitSnapshot = await buildSessionSnapshot(leagueId, new Date(), undefined, { skipRepair: true })
  if (!preSubmitSnapshot?.currentPick) {
    return NextResponse.json({ error: 'Draft is complete or not started' }, { status: 400 })
  }
  const expectedRosterId = preSubmitSnapshot.currentPick.rosterId

  const rawSource = String(body.source ?? 'user').toLowerCase()
  const source: 'user' | 'auto' | 'commissioner' | 'keeper' | 'devy' | 'college' | 'promoted_devy' =
    rawSource === 'auto' ||
    rawSource === 'commissioner' ||
    rawSource === 'keeper' ||
    rawSource === 'devy' ||
    rawSource === 'college' ||
    rawSource === 'promoted_devy'
      ? rawSource
      : 'user'

  // Determine the effective roster ID
  let effectiveRosterId = rosterId ?? expectedRosterId

  // Check if user is commissioner - if so, allow drafting for any roster
  const isComm = await isCommissioner(leagueId, userId)
  if (source === 'commissioner' && !isComm) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!isComm && effectiveRosterId !== expectedRosterId) {
    // Commit M — surface a structured code so the client can show an
    // inline "you're not on the clock" error instead of a generic 400.
    return NextResponse.json(
      { error: 'Invalid roster for current pick', code: DRAFT_PICK_NOT_ON_CLOCK },
      { status: httpStatusForPickAuthorityCode(DRAFT_PICK_NOT_ON_CLOCK) },
    )
  }
  const canSubmit = await canSubmitPickForRoster(leagueId, userId, effectiveRosterId)
  if (!canSubmit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await ensureDraftingLifecycleForActiveSession(leagueId, userId)

  const gate = await assertLeagueActionGate(leagueId, userId, 'draft_pick', {
    treatAsElevated: source === 'commissioner',
    lifecycle: { commissionerOverride: source === 'commissioner' },
  })
  if (!gate.ok) {
    return NextResponse.json({ error: gate.err.error, code: gate.err.code }, { status: gate.err.status })
  }

  const rawMeta = body.pickMetadata ?? body.pick_metadata
  const pickMetadata =
    rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta) ? (rawMeta as Record<string, unknown>) : null

  const rawImg =
    body.playerImageUrl ?? body.player_image_url ?? body.imageUrl ?? body.image_url ?? null
  const playerImageUrl =
    typeof rawImg === 'string' && rawImg.trim() ? rawImg.trim().slice(0, 2048) : null

  // Commit M — accept an `expectedOverall` from the client so the
  // authority can refuse stale submissions with `DRAFT_PICK_STALE_OVERALL`
  // (HTTP 409). Client recovery is the same as Commit J's session
  // mismatch path: refresh snapshot, resubmit with the new overall.
  const rawExpectedOverall = body.expectedOverall ?? body.expected_overall ?? null
  const expectedOverall =
    typeof rawExpectedOverall === 'number' && Number.isFinite(rawExpectedOverall) && rawExpectedOverall > 0
      ? Math.floor(rawExpectedOverall)
      : undefined

  const result = await submitPick({
    leagueId,
    playerName: String(playerName).trim(),
    position: String(position).trim(),
    team: body.team ?? null,
    byeWeek: body.byeWeek ?? body.bye_week ?? null,
    playerId: body.playerId ?? body.player_id ?? null,
    playerImageUrl,
    rosterId: effectiveRosterId,
    source,
    tradedPicks: body.tradedPicks ?? body.traded_picks ?? undefined,
    madeByUserId: userId,
    pickMetadata,
    assetType: body.assetType ?? body.asset_type ?? undefined,
    expectedOverall,
    commissionerOverride: source === 'commissioner' && isComm,
  })

  if (!result.success) {
    if (result.code === 'ROSTER_CONFIGURATION_INCOMPLETE') {
      return NextResponse.json(
        rosterConfigurationIncompleteBody({ leagueId, message: result.error }),
        { status: 409 },
      )
    }
    // Commit M — every authority-layer refusal carries a structured
    // PickAuthorityCode; route status comes from the central mapper so a
    // future code addition can't drift between routes.
    const status = result.code
      ? httpStatusForPickAuthorityCode(result.code as PickAuthorityCode)
      : 400
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status },
    )
  }

  // A network retry may repeat a request after its pick already committed.
  // Return authoritative state, but never duplicate audit, chat, notification,
  // roster-snapshot, or league-event side effects for that committed pick.
  if (result.idempotentReplay) {
    const replayedSession = await buildSessionSnapshot(leagueId, new Date(), undefined, { skipRepair: true })
    const replayedUserRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
    return NextResponse.json({
      ok: true,
      idempotentReplay: true,
      pick: result.snapshot,
      session: replayedSession != null
        ? { ...replayedSession, currentUserRosterId: replayedUserRosterId ?? undefined }
        : replayedSession,
    })
  }

  void logAction({
    leagueId,
    userId,
    actionType: 'draft_pick',
    entityType: 'draft',
    entityId: leagueId,
    afterState: {
      playerName: String(playerName).trim(),
      rosterId: effectiveRosterId,
      source,
      pick: result.snapshot ?? null,
    },
  }).catch(() => {})

  void import('@/lib/ai/events/recordAiEvent')
    .then(({ recordAiEvent }) =>
      import('@/lib/ai/events/aiEventTypes').then(({ AI_EVENT_TYPES }) => {
        const snap = result.snapshot as { overall?: number; round?: number } | null | undefined
        recordAiEvent({
          eventType: source === 'auto' ? AI_EVENT_TYPES.AUTO_PICK_MADE : AI_EVENT_TYPES.DRAFT_PICK_MADE,
          userId,
          leagueId,
          season: new Date().getFullYear(),
          payload: {
            playerName: String(playerName).trim(),
            position: String(position).trim(),
            rosterId: effectiveRosterId,
            source,
            playerId: body.playerId ?? body.player_id ?? null,
            overallPick: snap?.overall,
            round: snap?.round,
            isRookie: Boolean(pickMetadata && (pickMetadata as { isRookie?: boolean }).isRookie),
          },
          dedupeKey: snap?.overall != null ? `draft:${leagueId}:${snap.overall}` : null,
        })
      }),
    )
    .catch(() => {})

  void import('@/lib/league-events/publisher')
    .then(({ publishLeagueFanoutEvent }) =>
      publishLeagueFanoutEvent({
        leagueId,
        eventType: 'draft_pick',
        title: 'Draft pick',
        message: `${String(playerName).trim()} (${String(position).trim()}) was drafted.`,
        category: 'draft_alerts',
        visibility: 'all_members',
        actorUserId: userId,
        meta: { rosterId: effectiveRosterId, source },
        dedupeKey: result.snapshot?.rosterId
          ? `draftpick:${leagueId}:${effectiveRosterId}:${String(playerName).trim()}`
          : `draftpick:${leagueId}:${Date.now()}`,
        skipNotifications: true,
      }),
    )
    .catch(() => {})

  void notifyOnTheClockAfterPick(leagueId)
  void notifyDraftIntelPickConfirmation(leagueId, effectiveRosterId, String(playerName).trim()).catch(() => {})

  try {
    if (result.snapshot?.rosterId) {
      await appendPickToRosterDraftSnapshot(
        leagueId,
        result.snapshot.rosterId,
        {
          playerName: String(playerName).trim(),
          position: String(position).trim(),
          team: body.team ?? null,
          playerId: body.playerId ?? null,
          byeWeek: body.byeWeek ?? null,
        }
      ).catch(() => {})
    }
  } catch (_) {}

  const updated = await buildSessionSnapshot(leagueId, new Date(), undefined, { skipRepair: true })
  const currentUserRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  // Evidence-only certified sports context for the committed pick (never affects the authoritative result above).
  const sportsDataDecision = await draftPickSportsEvidence(leagueId, body.playerId ?? body.player_id, String(playerName).trim())
  void (async () => {
    const states = await publishDraftIntelForUpcomingManagers({
      leagueId,
      trigger: 'pick_update',
    }).catch(() => [])
    for (const result of states) {
      const state = result.state
      await sendDraftIntelDm(state).catch(() => null)
      if (result.previousState?.queue.some((entry) => entry.playerName === String(playerName).trim())) {
        await notifyDraftIntelPlayerTaken(leagueId, state.rosterId, String(playerName).trim()).catch(() => null)
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
    session:
      updated != null
        ? {
            ...updated,
            currentUserRosterId: currentUserRosterId ?? undefined,
          }
        : updated,
    ...(sportsDataDecision ? { sportsDataDecision } : {}),
  })
})
