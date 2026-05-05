/**
 * GET: Current user's draft queue for the league's session.
 * PUT: Save draft queue (order array).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import type { QueueEntry } from '@/lib/live-draft-engine/types'
import { loadDraftQueueForUser } from '@/lib/draft-room/loadDraftQueueForUser'
import { normalizeDraftQueueSizeLimit } from '@/lib/draft-defaults/DraftQueueLimitResolver'
import {
  dedupeQueueEntries,
  normalizeDraftedNameSet,
  normalizeQueueEntries,
  removeDraftedPlayersFromQueue,
} from '@/lib/draft-queue-engine'
import {
  mergeAiManageDraftQueuePreference,
  stripAiQueueMetadata,
} from '@/lib/live-draft-engine/draftQueueAiPreferences'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'

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

  const draftSession = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: {
      id: true,
      picks: {
        select: { playerName: true },
      },
    },
  })
  if (!draftSession) {
    return NextResponse.json({ error: 'No draft session' }, { status: 404 })
  }

  const { getDraftConfigForLeague } = await import('@/lib/draft-defaults/DraftRoomConfigResolver')
  const draftConfig = await getDraftConfigForLeague(leagueId)
  const queueSizeLimit = normalizeDraftQueueSizeLimit(draftConfig?.queue_size_limit)

  let normalized = dedupeQueueEntries(normalizeQueueEntries(queue, queueSizeLimit))
  normalized = stripAiQueueMetadata(normalized)

  if (typeof body.aiManageDraftQueueEnabled === 'boolean') {
    const entitlementResolver = new EntitlementResolver()
    const { hasAccess } = await entitlementResolver.resolveForUser(userId, 'pro_draft_ai')
    if (body.aiManageDraftQueueEnabled === true && !hasAccess) {
      return NextResponse.json(
        { error: 'AF Pro required to enable AI queue management.' },
        { status: 403 }
      )
    }
    const roster = await prisma.roster.findUnique({
      where: { leagueId_platformUserId: { leagueId, platformUserId: userId } },
      select: { id: true, settings: true },
    })
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

  const { draftPoolRowMatchesEligiblePositions } = await import('@/lib/draft-room/draft-pool-eligible-positions')
  const { getAllowedPositionsAndRosterSize } = await import('@/lib/live-draft-engine/RosterFitValidation')
  const rosterRules = await getAllowedPositionsAndRosterSize(leagueId)
  if (rosterRules?.draftEligiblePositions?.size) {
    const invalid = normalized.filter((e: { position: string }) => {
      const pos = (e.position ?? '').trim()
      return pos && !draftPoolRowMatchesEligiblePositions(pos, rosterRules!.draftEligiblePositions)
    })
    if (invalid.length > 0) {
      const positions = [...new Set(invalid.map((e: { position: string }) => (e.position || '').trim() || '?'))]
      return NextResponse.json(
        {
          error: `Queue contains players with positions not starter-eligible for this draft: ${positions.join(', ')}. Allowed positions: ${[...rosterRules.draftEligiblePositions].sort().join(', ')}.`,
        },
        { status: 400 }
      )
    }
  }

  const draftedNames = normalizeDraftedNameSet(draftSession.picks)
  const cleaned = removeDraftedPlayersFromQueue(normalized, draftedNames)

  await prisma.draftQueue.upsert({
    where: { sessionId_userId: { sessionId: draftSession.id, userId } },
    create: { sessionId: draftSession.id, userId, order: cleaned.queue as any },
    update: { order: cleaned.queue as any, updatedAt: new Date() },
  })

  return NextResponse.json({
    ok: true,
    leagueId,
    queue: cleaned.queue,
    removedUnavailable: cleaned.removedCount,
  })
}
