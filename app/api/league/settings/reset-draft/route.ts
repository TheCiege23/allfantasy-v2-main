import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { COMPLETED_DRAFT_SESSION_STATUS, CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { resetDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { logAction } from '@/server/services/auditService'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { leagueId?: string; confirmText?: string }
  try {
    body = (await req.json()) as { leagueId?: string; confirmText?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  const confirmText = typeof body.confirmText === 'string' ? body.confirmText.trim() : ''
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }
  if (confirmText !== 'RESET DRAFT') {
    return NextResponse.json({ error: 'Confirmation text must be RESET DRAFT' }, { status: 400 })
  }

  await requireCommissionerOnly(leagueId, userId)

  /*
   * 🛑 THIS ROUTE DELETED PICKS ON ITS OWN (2026-11-15) — on a completed draft too, whose rosters and season were
   * already built from them, and without returning auction budgets, removing NBA college rights, archiving the board
   * or moving the league's lifecycle back. It now resets through `resetDraftSession`, the same path the draft room's
   * reset uses, which refuses a completed draft and does all of that in one transaction.
   */
  const draftSession = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true, _count: { select: { picks: true } } },
  })

  const clearedPicks = draftSession?._count.picks ?? 0

  if (draftSession) {
    if (draftSession.status === COMPLETED_DRAFT_SESSION_STATUS) {
      return NextResponse.json(
        { error: 'This draft is complete. Its picks built the rosters and season, so it cannot be reset here.' },
        { status: 409 },
      )
    }
    const ok = await resetDraftSession(leagueId)
    if (!ok) {
      return NextResponse.json({ error: 'This draft cannot be reset.' }, { status: 409 })
    }
    await logAction({
      leagueId,
      userId,
      actionType: 'draft_reset',
      entityType: 'draft',
      entityId: draftSession.id,
      beforeState: { status: draftSession.status, picks: clearedPicks },
      afterState: { status: 'pre_draft', picks: 0 },
      metadata: { source: 'league/settings/reset-draft' },
    }).catch(() => {})
  }

  const existing = await prisma.leagueSettings.findUnique({ where: { leagueId } })
  let resetHistory: unknown[] = []
  if (existing?.resetHistory != null && Array.isArray(existing.resetHistory)) {
    resetHistory = [...existing.resetHistory]
  }
  resetHistory.push({
    resetAt: new Date().toISOString(),
    resetBy: userId,
    clearedPicks,
  })

  await prisma.leagueSettings.upsert({
    where: { leagueId },
    create: {
      leagueId,
      resetHistory: resetHistory as unknown as Prisma.InputJsonValue,
      updatedBy: userId,
    },
    update: {
      resetHistory: resetHistory as unknown as Prisma.InputJsonValue,
      updatedBy: userId,
    },
  })

  return NextResponse.json({ success: true, clearedPicks })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[reset-draft]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
