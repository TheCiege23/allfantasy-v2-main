/**
 * PATCH: Set devy draft config (enabled, devyRounds). Commissioner only. Pre-draft only.
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
    return NextResponse.json({ error: 'Devy config cannot be changed after draft has started' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const enabled = Boolean(body.enabled)
  const devyRounds = Array.isArray(body.devyRounds)
    ? (body.devyRounds as number[]).filter((r) => typeof r === 'number' && r >= 1 && r <= (draft.rounds ?? 50))
    : []

  const devyConfig = { enabled, devyRounds }

  await prisma.draftSession.update({
    where: { id: draft.id },
    data: { devyConfig: devyConfig as any, version: { increment: 1 }, updatedAt: new Date() },
  })

  const snapshot = await buildSessionSnapshot(leagueId)
  return NextResponse.json({ ok: true, devyConfig, session: snapshot })
}
