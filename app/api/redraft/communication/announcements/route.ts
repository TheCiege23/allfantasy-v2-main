import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { createNflRedraftCommissionerAnnouncement } from '@/lib/league-notifications/nflRedraftCommunicationPersistence'

export const dynamic = 'force-dynamic'

const ANNOUNCEMENT_TYPES = new Set(['league', 'draft_reminder', 'waiver_reminder', 'playoff_reminder'])
type AnnouncementType = 'league' | 'draft_reminder' | 'waiver_reminder' | 'playoff_reminder'

export async function POST(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, user.appUserId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const announcementBody = typeof body?.body === 'string'
    ? body.body.trim()
    : typeof body?.message === 'string'
      ? body.message.trim()
      : ''
  if (!announcementBody) {
    return NextResponse.json({ error: 'Announcement body required' }, { status: 400 })
  }
  if (announcementBody.length > 2000) {
    return NextResponse.json({ error: 'Announcement body too long' }, { status: 400 })
  }

  const rawType = typeof body?.announcementType === 'string' ? body.announcementType.trim() : 'league'
  const announcementType: AnnouncementType = ANNOUNCEMENT_TYPES.has(rawType)
    ? rawType as AnnouncementType
    : 'league'
  const result = await createNflRedraftCommissionerAnnouncement({
    leagueId,
    actorUserId: user.appUserId,
    title: typeof body?.title === 'string' ? body.title : null,
    body: announcementBody,
    announcementType,
    pinned: body?.pinned === true,
    mirrorToDiscord: body?.mirrorToDiscord !== false,
  })

  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: 400 })

  return NextResponse.json({
    status: 'ok',
    leagueId,
    created: result.created,
    notificationCount: result.created.notifications,
    chatMessageId: result.created.chatMessageId,
  })
}
