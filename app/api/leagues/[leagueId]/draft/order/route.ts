/**
 * GET: Current draft order (slotOrder from session).
 * PATCH: Set draft order (commissioner only, pre_draft only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const draftSession = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { slotOrder: true, status: true, teamCount: true },
  })
  if (!draftSession) return NextResponse.json({ slotOrder: null, status: null }, { status: 200 })

  const slotOrder = (draftSession.slotOrder as unknown as SlotOrderEntry[]) ?? []
  return NextResponse.json({
    slotOrder,
    status: draftSession.status,
    teamCount: draftSession.teamCount,
  })
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await isCommissioner(leagueId, userId)
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const slotOrder = body.slotOrder as { slot: number; rosterId: string; displayName: string }[] | undefined
  if (!Array.isArray(slotOrder) || slotOrder.length === 0) {
    return NextResponse.json({ error: 'slotOrder must be a non-empty array of { slot, rosterId, displayName }' }, { status: 400 })
  }

  const draftSession = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true, teamCount: true },
  })
  if (!draftSession) return NextResponse.json({ error: 'No draft session' }, { status: 404 })
  if (draftSession.status !== 'pre_draft') {
    return NextResponse.json({ error: 'Draft order can only be set when status is pre_draft' }, { status: 400 })
  }

  const normalized = slotOrder.map((e, i) => ({
    slot: typeof e.slot === 'number' ? e.slot : i + 1,
    rosterId: String(e.rosterId ?? ''),
    displayName: String(e.displayName ?? `Team ${i + 1}`),
  }))

  await prisma.draftSession.update({
    where: { id: draftSession.id },
    data: {
      slotOrder: normalized as any,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true, slotOrder: normalized })
}
