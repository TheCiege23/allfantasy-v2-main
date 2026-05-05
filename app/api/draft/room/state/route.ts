import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseSessionKey, sessionKeyLive } from '@/lib/draft/session-key'
import { canAccessLeague } from '@/lib/draft/access'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'

export const dynamic = 'force-dynamic'

function mapLiveStatusToLegacy(value: unknown): 'waiting' | 'active' | 'paused' | 'complete' {
  const status = String(value ?? '').trim().toLowerCase()
  if (status === 'in_progress' || status === 'active' || status === 'live') return 'active'
  if (status === 'paused') return 'paused'
  if (status === 'completed' || status === 'complete' || status === 'post_draft') return 'complete'
  return 'waiting'
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessionId = req.nextUrl.searchParams?.get('sessionId')?.trim()
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  let parsed: { mode: 'mock' | 'live'; id: string }
  try {
    parsed = parseSessionKey(sessionId)
  } catch {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  if (parsed.mode === 'live') {
    const ok = await canAccessLeague(parsed.id, userId)
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const snapshot = await buildSessionSnapshot(parsed.id)
    if (!snapshot) {
      return NextResponse.json({ error: 'State not found' }, { status: 404 })
    }

    const pickOrder = snapshot.slotOrder.map((slot) => ({
      id: slot.rosterId,
      label: slot.displayName,
    }))

    const currentTeamIndex =
      snapshot.currentPick?.slot != null && Number.isFinite(snapshot.currentPick.slot)
        ? Math.max(0, Number(snapshot.currentPick.slot) - 1)
        : 0

    const state = {
      id: sessionKeyLive(parsed.id),
      mode: 'live',
      status: mapLiveStatusToLegacy(snapshot.status),
      leagueId: parsed.id,
      roomId: null,
      numTeams: snapshot.teamCount,
      numRounds: snapshot.rounds,
      timerSeconds: snapshot.timerSeconds ?? 0,
      currentPick: snapshot.currentPick?.overall ?? 1,
      currentRound: snapshot.currentPick?.round ?? 1,
      currentTeamIndex,
      timerEndsAt: snapshot.timer.timerEndAt ?? snapshot.timerEndAt,
      timerPaused: snapshot.timer.status === 'paused',
      pickOrder,
      // Slice 1/2 — read-consistency: surface typed draft flags to legacy state shape.
      thirdRoundReversal: snapshot.thirdRoundReversal,
      onClockTradeTimerBehavior: snapshot.onClockTradeTimerBehavior,
      inDraftPlayerTradesEnabled: snapshot.inDraftPlayerTradesEnabled,
      customRankingsEnabled: snapshot.customRankingsEnabled,
      updatedAt: snapshot.updatedAt,
    }

    const picks = await prisma.draftPick.findMany({
      where: { sessionId: snapshot.id },
      orderBy: { overall: 'asc' },
      select: {
        id: true,
        round: true,
        slot: true,
        overall: true,
        originalRosterId: true,
        rosterId: true,
        ownerUserId: true,
        playerId: true,
        playerName: true,
        position: true,
        team: true,
        tradedPickMeta: true,
        source: true,
        createdAt: true,
      },
    })

    const mappedPicks = picks.map((pick) => ({
      id: pick.id,
      round: pick.round,
      pickNumber: pick.slot,
      overallPick: pick.overall,
      originalOwnerId: pick.originalRosterId ?? pick.rosterId,
      currentOwnerId: pick.rosterId,
      pickedById: pick.ownerUserId ?? null,
      playerId: pick.playerId ?? null,
      playerName: pick.playerName,
      position: pick.position,
      team: pick.team ?? null,
      isTraded: Boolean(pick.tradedPickMeta) || (pick.originalRosterId != null && pick.originalRosterId !== pick.rosterId),
      autopicked: String(pick.source ?? 'user').toLowerCase() === 'auto',
      timestamp: pick.createdAt.toISOString(),
    }))

    return NextResponse.json({ state, picks: mappedPicks })
  }

  let state = await prisma.draftRoomStateRow.findUnique({ where: { id: sessionId } })

  if (!state) {
    return NextResponse.json({ error: 'State not found' }, { status: 404 })
  }

  const picks = await prisma.draftRoomPickRecord.findMany({
    where: { roomId: parsed.id },
    orderBy: { overallPick: 'asc' },
  })

  return NextResponse.json({ state, picks })
}

