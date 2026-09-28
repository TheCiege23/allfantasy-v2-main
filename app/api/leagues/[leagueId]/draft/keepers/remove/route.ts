/**
 * POST: Remove a keeper selection. Body: { rosterId, playerName } or { rosterId, roundCost }. Commissioner can remove any.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import type { KeeperConfig, KeeperSelection } from '@/lib/live-draft-engine/keeper/types'
import { isKeeperDeadlineLocked } from '@/lib/live-draft-engine/keeper/KeeperCarryover'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

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

  const body = await req.json().catch(() => ({}))
  const rosterId = body.rosterId ?? body.roster_id
  const playerName = body.playerName ?? body.player_name
  const roundCost = body.roundCost ?? body.round_cost

  if (!rosterId) {
    return NextResponse.json({ error: 'rosterId is required' }, { status: 400 })
  }
  if (playerName == null && roundCost == null) {
    return NextResponse.json({ error: 'Provide playerName or roundCost to remove' }, { status: 400 })
  }

  const currentUserRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  const isCommissioner = await assertCommissioner(leagueId, userId).then(() => true).catch(() => false)
  if (rosterId !== currentUserRosterId && !isCommissioner) {
    return NextResponse.json({ error: 'You can only remove keepers from your own roster' }, { status: 403 })
  }

  const draft = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!draft) return NextResponse.json({ error: 'No draft session' }, { status: 404 })
  if (draft.status !== 'pre_draft') {
    return NextResponse.json({ error: 'Keepers cannot be changed after draft has started' }, { status: 400 })
  }
  const config = (draft.keeperConfig ?? (draft as any).keeperConfig) as KeeperConfig | null
  const deadlineLocked = isKeeperDeadlineLocked(config)
  if (deadlineLocked && !isCommissioner) {
    return NextResponse.json({ error: 'Keeper deadline has passed. Commissioner override is required.' }, { status: 400 })
  }

  const existing = (draft.keeperSelections ?? (draft as any).keeperSelections) as KeeperSelection[] | undefined
  const list = Array.isArray(existing) ? existing : []

  const removeByPlayer =
    playerName != null
      ? list.filter(
          (s) =>
            s.rosterId !== rosterId ||
            s.playerName.trim().toLowerCase() !== String(playerName).trim().toLowerCase()
        )
      : list
  const nextSelections =
    roundCost != null
      ? removeByPlayer.filter((s) => !(s.rosterId === rosterId && s.roundCost === Number(roundCost)))
      : removeByPlayer

  if (nextSelections.length === list.length) {
    return NextResponse.json({ error: 'No matching keeper to remove' }, { status: 400 })
  }

  await prisma.draftSession.update({
    where: { id: draft.id },
    data: { keeperSelections: nextSelections as any, version: { increment: 1 }, updatedAt: new Date() },
  })

  const snapshot = await buildSessionSnapshot(leagueId)
  return NextResponse.json({ ok: true, keeper: (snapshot as any).keeper, session: snapshot })
}
