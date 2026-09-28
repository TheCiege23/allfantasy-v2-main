/**
 * PATCH: Set C2C draft config (enabled, collegeRounds). Commissioner only. Pre-draft only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const draft = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!draft) return NextResponse.json({ error: 'No draft session' }, { status: 404 })
  if (draft.status !== 'pre_draft') {
    return NextResponse.json({ error: 'C2C config cannot be changed after draft has started' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const enabled = Boolean(body.enabled)
  const rounds = draft.rounds ?? 15
  const collegeRounds = Array.isArray(body.collegeRounds)
    ? (body.collegeRounds as number[]).filter((r) => typeof r === 'number' && r >= 1 && r <= rounds)
    : []

  const c2cConfig = { enabled, collegeRounds }

  await prisma.draftSession.update({
    where: { id: draft.id },
    data: { c2cConfig: c2cConfig as any, version: { increment: 1 }, updatedAt: new Date() },
  })

  const snapshot = await buildSessionSnapshot(leagueId)
  return NextResponse.json({ ok: true, c2cConfig, session: snapshot })
}
