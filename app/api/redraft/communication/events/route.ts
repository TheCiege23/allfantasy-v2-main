import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'
import { persistNflRedraftCommunicationForEvent } from '@/lib/league-notifications/nflRedraftCommunicationPersistence'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const eventType = typeof body?.eventType === 'string' ? body.eventType.trim() : ''
  if (!leagueId || !eventType) {
    return NextResponse.json({ error: 'leagueId and eventType required' }, { status: 400 })
  }

  try {
    await assertCommissioner(leagueId, user.appUserId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const event = toCanonicalLeagueRuntimeEvent({
    leagueId,
    eventType,
    createdAt: typeof body?.occurredAtIso === 'string' ? body.occurredAtIso : undefined,
    actorUserId: typeof body?.actorUserId === 'string' ? body.actorUserId : user.appUserId,
    payload:
      body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : {},
  })
  const result = await persistNflRedraftCommunicationForEvent({
    event,
    actorUserId: user.appUserId,
    mirrorToDiscord: body?.mirrorToDiscord !== false,
    includeEmailPushPlaceholders: body?.includeEmailPushPlaceholders === true,
  })

  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: 400 })
  return NextResponse.json({
    status: 'ok',
    event: result.plan.event,
    category: result.plan.category,
    deliveryChannels: result.plan.deliveryChannels,
    created: result.created,
  })
}
