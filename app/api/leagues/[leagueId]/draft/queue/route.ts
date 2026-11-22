/**
 * GET: Current user's draft queue for the league's session.
 * PUT: Save draft queue (order array).
 */

import { draftQueueKeyForUser } from '@/lib/league/teamScopedKey'
import { actingTeamRefusal, requestedRosterIdFrom, resolveActingRoster } from '@/lib/league/viewerTeams'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { loadDraftQueueForUser } from '@/lib/draft-room/loadDraftQueueForUser'
import { mergeAiManageDraftQueuePreference } from '@/lib/live-draft-engine/draftQueueAiPreferences'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { persistDraftQueue, prepareDraftQueueSave } from '@/lib/draft-room/saveDraftQueue'

export const dynamic = 'force-dynamic'

export async function GET(
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

  const { queue, removedUnavailable } = await loadDraftQueueForUser(leagueId, userId)
  return NextResponse.json({
    leagueId,
    queue,
    removedUnavailable,
  })
}

export async function PUT(
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
  const queue = Array.isArray(body.queue) ? body.queue : body.order
  if (!Array.isArray(queue)) {
    return NextResponse.json({ error: 'queue (array) required' }, { status: 400 })
  }

  /*
   * The whole hygiene chain — size limit, dedupe, eligible positions, drafted players — lives in
   * lib/draft-room/saveDraftQueue.ts, shared with a confirmed Chimmy queue card. Checked BEFORE the
   * AF Pro preference write below, so a refused queue changes nothing at all.
   */
  const prepared = await prepareDraftQueueSave(leagueId, queue)
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status })

  if (typeof body.aiManageDraftQueueEnabled === 'boolean') {
    const entitlementResolver = new EntitlementResolver()
    const { hasAccess } = await entitlementResolver.resolveForUser(userId, 'pro_draft_ai')
    if (body.aiManageDraftQueueEnabled === true && !hasAccess) {
      return NextResponse.json(
        { error: 'AF Pro required to enable Chimmy queue management.' },
        { status: 403 }
      )
    }
    // The preference is stored on a team: the manager's own, or the named one of several.
    const acting = await resolveActingRoster(leagueId, userId, requestedRosterIdFrom(req, body), { allowCoOwner: false })
    if (!acting.ok && acting.code !== 'NO_TEAM') return actingTeamRefusal(acting)
    const roster = acting.ok
      ? await prisma.roster.findFirst({ where: { id: acting.rosterId, leagueId }, select: { id: true, settings: true } })
      : null
    if (roster) {
      await prisma.roster.update({
        where: { id: roster.id },
        data: {
          settings: mergeAiManageDraftQueuePreference(
            roster.settings,
            body.aiManageDraftQueueEnabled
          ) as never,
        },
      })
    }
  }

  // Saved to the queue of the team the room is about for this manager.
  await persistDraftQueue(await draftQueueKeyForUser(leagueId, userId), prepared.prepared)

  return NextResponse.json({
    ok: true,
    leagueId,
    queue: prepared.prepared.queue,
    removedUnavailable: prepared.prepared.removedCount,
  })
}
