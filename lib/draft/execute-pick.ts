import { prisma } from '@/lib/prisma'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { parseSessionKey } from '@/lib/draft/session-key'
import { pickInRoundForOverall, roundForOverallPick } from '@/lib/draft/snake'
import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { canSubmitPickForRoster } from '@/lib/live-draft-engine/auth'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import { assertLegacyDraftRuntimeWriteAllowed } from '@/lib/draft/legacy-runtime-write-guard'

export async function executeDraftPick(args: {
  sessionId: string
  userId: string
  playerId: string | null
  playerName: string
  position: string
  team: string | null
  autopicked: boolean
}): Promise<{ ok: true; overallPick: number } | { ok: false; error: string; status?: number }> {
  const { sessionId, userId, playerId, playerName, position, team, autopicked } = args

  let parsed: { mode: 'mock' | 'live'; id: string }
  try {
    parsed = parseSessionKey(sessionId)
  } catch {
    return { ok: false, error: 'Invalid sessionId', status: 400 }
  }

  if (parsed.mode === 'live') {
    const snapshot = await buildSessionSnapshot(parsed.id)
    if (!snapshot || snapshot.status !== 'in_progress' || !snapshot.currentPick) {
      return { ok: false, error: 'Draft not active', status: 400 }
    }

    const canSubmit = await canSubmitPickForRoster(parsed.id, userId, snapshot.currentPick.rosterId)
    if (!canSubmit && !autopicked) {
      return { ok: false, error: 'Not your pick', status: 403 }
    }

    const submitted = await submitPick({
      leagueId: parsed.id,
      rosterId: snapshot.currentPick.rosterId,
      madeByUserId: autopicked ? null : userId,
      source: autopicked ? 'auto' : 'user',
      playerId,
      playerName,
      position,
      team,
    })

    if (!submitted.success) {
      return { ok: false, error: submitted.error ?? 'Failed to submit pick', status: 400 }
    }

    return { ok: true, overallPick: submitted.snapshot?.overall ?? snapshot.currentPick.overall }
  }

  assertLegacyDraftRuntimeWriteAllowed({
    route: 'lib/draft/execute-pick.ts',
    operation: 'create DraftRoomPickRecord + update DraftRoomStateRow',
    sessionId,
    mode: parsed.mode,
  })

  const state = await prisma.draftRoomStateRow.findUnique({ where: { id: sessionId } })
  if (!state || state.status === 'complete') {
    return { ok: false, error: 'Draft not active', status: 400 }
  }

  const numTeams = state.numTeams
  const pickOrder = state.pickOrder as Array<{ id: string; label?: string }> | null
  if (!pickOrder?.length) {
    return { ok: false, error: 'Invalid pick order', status: 500 }
  }

  const whereCount = parsed.mode === 'mock' ? { roomId: parsed.id } : { leagueId: parsed.id }
  const existing = await prisma.draftRoomPickRecord.count({ where: whereCount })
  const overallPick = existing + 1
  const totalPicks = numTeams * state.numRounds
  if (overallPick > totalPicks) {
    return { ok: false, error: 'Draft already complete', status: 400 }
  }

  const thirdRoundReversal = Boolean(
    (state as { thirdRoundReversal?: boolean | null }).thirdRoundReversal,
  )
  const slot =
    getSlotInRoundForOverall({
      overall: overallPick,
      teamCount: numTeams,
      draftType: 'snake',
      thirdRoundReversal,
    }) - 1
  const onClock = pickOrder[slot]?.id
  if (!onClock) {
    return { ok: false, error: 'Invalid slot', status: 500 }
  }

  const isCpu = onClock.startsWith('cpu-')

  if (!isCpu && onClock !== userId && !autopicked) {
    return { ok: false, error: 'Not your pick', status: 403 }
  }
  if (isCpu && !autopicked) {
    return { ok: false, error: 'CPU is on the clock', status: 400 }
  }

  const round = roundForOverallPick(overallPick, numTeams)
  const pickNumber = pickInRoundForOverall(overallPick, numTeams)
  const roomId = parsed.mode === 'mock' ? parsed.id : null

  await prisma.$transaction(async (tx) => {
    await tx.draftRoomPickRecord.create({
      data: {
        leagueId: null,
        roomId,
        round,
        pickNumber,
        overallPick,
        originalOwnerId: onClock,
        currentOwnerId: onClock,
        pickedById: isCpu ? null : userId,
        playerId,
        playerName,
        position,
        team,
        autopicked: Boolean(autopicked || isCpu),
      },
    })

    const done = overallPick >= totalPicks
    const nextOverall = overallPick + 1
    const nextSlot = done
      ? slot
      : getSlotInRoundForOverall({
          overall: nextOverall,
          teamCount: numTeams,
          draftType: 'snake',
          thirdRoundReversal,
        }) - 1
    const nextRound = done ? round : roundForOverallPick(nextOverall, numTeams)
    const ends = done ? null : new Date(Date.now() + state.timerSeconds * 1000)

    await tx.draftRoomStateRow.update({
      where: { id: sessionId },
      data: {
        status: done ? 'complete' : 'active',
        currentPick: done ? overallPick : nextOverall,
        currentRound: nextRound,
        currentTeamIndex: nextSlot,
        timerEndsAt: state.timerPaused ? state.timerEndsAt : ends,
        updatedAt: new Date(),
      },
    })

    if (parsed.mode === 'mock') {
      await tx.mockDraftRoom.update({
        where: { id: parsed.id },
        data: { status: done ? 'complete' : 'active' },
      })
    }
  })

  void Promise.resolve()
    .then(async () => {
      if (parsed.mode === 'mock' && roomId) {
        const room = await prisma.mockDraftRoom.findUnique({
          where: { id: roomId },
          select: { sport: true },
        })
        await recordAfLearningEvent({
          eventType: 'draft_pick_made',
          sport: normalizeToSupportedSport(room?.sport ?? undefined),
          leagueId: null,
          userId: isCpu ? null : userId,
          source: 'draft_execute_pick_mock',
          payload: {
            roomId,
            overallPick,
            round,
            pickNumber,
            playerId,
            position,
            autopicked: Boolean(autopicked || isCpu),
          },
        })
      }
    })
    .catch((e) => console.warn('[af-learning] draft_pick_made', e))

  const teamLabel = pickOrder[slot]?.label ?? onClock
  const sysMsg = `Pick ${round}.${String(pickNumber).padStart(2, '0')} — ${playerName} (${position}) selected by ${teamLabel}`

  await prisma.draftRoomChatMessage.create({
    data: {
      sessionKey: sessionId,
      leagueId: null,
      roomId,
      userId: null,
      authorDisplayName: 'System',
      message: sysMsg,
      type: 'system',
    },
  })

  return { ok: true, overallPick }
}
