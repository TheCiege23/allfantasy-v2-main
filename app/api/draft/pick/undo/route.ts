import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseSessionKey } from '@/lib/draft/session-key'
import { slotIndexForOverallPick, roundForOverallPick } from '@/lib/draft/snake'
import { undoLastPick } from '@/lib/live-draft-engine/DraftSessionService'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  // Slice 4 — undo requires a commissioner reason (1-500 chars, stored in DraftPickAuditLog).
  const reasonRaw = typeof body?.reason === 'string' ? body.reason.trim() : ''
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

  let parsed: { mode: 'mock' | 'live'; id: string }
  try {
    parsed = parseSessionKey(sessionId)
  } catch {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  if (parsed.mode === 'mock') {
    const state = await prisma.draftRoomStateRow.findUnique({ where: { id: sessionId } })
    if (!state) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const room = await prisma.mockDraftRoom.findUnique({ where: { id: parsed.id } })
    if (room?.createdById !== userId) {
      return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
    }
    const where = { roomId: parsed.id }
    const last = await prisma.draftRoomPickRecord.findFirst({
      where,
      orderBy: { overallPick: 'desc' },
    })
    if (!last) {
      return NextResponse.json({ error: 'No picks to undo' }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.draftRoomPickRecord.delete({ where: { id: last.id } })
      const remaining = await tx.draftRoomPickRecord.count({ where })
      const nextOverall = Math.max(1, remaining + 1)
      const slot = slotIndexForOverallPick(nextOverall, state.numTeams)
      await tx.draftRoomStateRow.update({
        where: { id: sessionId },
        data: {
          status: remaining === 0 ? 'waiting' : 'active',
          currentPick: nextOverall,
          currentRound: roundForOverallPick(nextOverall, state.numTeams),
          currentTeamIndex: slot,
          updatedAt: new Date(),
        },
      })
    })

    return NextResponse.json({ success: true })
  }

  const league = await prisma.league.findFirst({
    where: { id: parsed.id, userId },
    select: { id: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }

  const undone = await undoLastPick(parsed.id, { reason: reasonRaw, actorUserId: userId })
  if (!undone) {
    return NextResponse.json({ error: 'No picks to undo' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
