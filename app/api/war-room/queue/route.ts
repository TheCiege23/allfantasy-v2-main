import { draftQueueKeyForUser } from '@/lib/league/teamScopedKey'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserId, requireLeagueWarRoom } from '@/lib/war-room/war-room-api'
import { logAiRecommendation, replaceDraftQueueEntries } from '@/lib/war-room/war-room-persist'

export const dynamic = 'force-dynamic'

/**
 * POST /api/war-room/queue — replace `draft_queue_entries` for the user (see also `draft_queues` JSON table).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : undefined
  const draftSessionId = typeof body.draftSessionId === 'string' ? body.draftSessionId : ''
  const gate = await requireLeagueWarRoom(leagueId, auth.userId, 'core')
  if (!gate.ok) return gate.response

  if (!draftSessionId) {
    return NextResponse.json({ error: 'draftSessionId is required' }, { status: 400 })
  }

  const session = await prisma.draftSession.findFirst({
    where: { id: draftSessionId, leagueId: gate.ctx.leagueId },
    select: { id: true },
  })
  if (!session) {
    return NextResponse.json({ error: 'Draft session not found for this league' }, { status: 404 })
  }

  const raw = body.entries
  const entries: Array<{ playerId: string; playerName?: string | null; priority: number }> = []
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 1) {
      const row = raw[i] as Record<string, unknown>
      const playerId = typeof row.playerId === 'string' ? row.playerId : ''
      if (!playerId) continue
      entries.push({
        playerId,
        playerName: typeof row.playerName === 'string' ? row.playerName : null,
        priority: typeof row.priority === 'number' ? row.priority : i,
      })
    }
  }

  const replaced = await replaceDraftQueueEntries({
    draftSessionId: session.id,
    // The queue of the team this manager is on (lib/league/teamScopedKey.ts).
    userId: await draftQueueKeyForUser(gate.ctx.leagueId, auth.userId),
    entries,
  })

  const log = await logAiRecommendation({
    userId: auth.userId,
    leagueId: gate.ctx.leagueId,
    draftSessionId: session.id,
    feature: 'war_room_queue',
    inputJson: body as object,
    outputJson: { count: replaced.count } as object,
  })

  return NextResponse.json({
    ok: true,
    count: replaced.count,
    logId: log.id,
  })
}
