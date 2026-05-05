/**
 * Slice 4 — Commissioner-only audit log of draft pick actions (undo, edit, etc.).
 * Returns full reasons + metadata to commissioners; non-commissioners get 403.
 * GET /api/leagues/[leagueId]/draft/audit-log
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCommissioner } from '@/lib/commissioner/permissions'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await isCommissioner(leagueId, userId)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Commissioner only', code: 'AUDIT_LOG_COMMISSIONER_ONLY' },
      { status: 403 },
    )
  }

  const entries = await prisma.draftPickAuditLog.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      action: true,
      actorUserId: true,
      overallPickNumber: true,
      round: true,
      oldRosterId: true,
      newRosterId: true,
      oldPlayerId: true,
      oldPlayerName: true,
      newPlayerId: true,
      newPlayerName: true,
      reason: true,
      metadata: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    ok: true,
    entries: entries.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
  })
}
